import { pool, tx } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import {
  assertGroup, assertUuid, loadConvocados, startersFor, fromAssignment, finishDueMatches, systemMessage,
  parseGuest, guestKey, isGuestKey, MIN_PLAYERS, type Convocado,
} from '@/lib/queries';
import { balanceTeams, toSnapshotRows } from '@/lib/teamBalancer';
import { statsOf, matchWhen } from '@/lib/matches';
import { notify } from '@/lib/notify';

// Lista de partidos de TUS grupos. Por defecto solo los pendientes (vista principal).
// ?status=pending|cancelled  ·  ?groupId=...
// Los finalizados van por /api/history.
export const GET = handle(async (req) => {
  const me = await requireUser(req);
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'pending';
  if (!['pending', 'cancelled'].includes(status)) throw new HttpError(400, 'status inválido (usa /api/history para finalizados)');
  const groupId = url.searchParams.get('groupId');

  await finishDueMatches(pool); // transición perezosa por si el cron aún no ha corrido
  const { rows } = await pool.query(
    `SELECT m.id, m.group_id AS "groupId", g.name AS "groupName", m.scheduled_at AS "scheduledAt",
            m.location, m.format, m.starters_per_side AS "startersPerSide", m.status,
            CASE WHEN gp.role IN ('owner', 'co_admin') THEN m.balance_stats END AS "balanceStats",
            (SELECT count(*) FROM match_players x WHERE x.match_id = m.id)::int AS "playersCount",
            (SELECT count(*) FROM match_players x WHERE x.match_id = m.id AND x.is_guest)::int AS "guestsCount",
            m.notes, m.updated_at AS "updatedAt",
            (COALESCE(m.updated_at, m.created_at) > gp.last_seen_matches_at) AS "isNew"
       FROM matches m
       JOIN groups g ON g.id = m.group_id AND g.is_active
       JOIN group_players gp ON gp.group_id = g.id AND gp.player_id = $1 AND gp.is_active
      WHERE m.status = $2 AND ($3::uuid IS NULL OR m.group_id = $3)
      ORDER BY m.scheduled_at`,
    [me.playerId, status, groupId]
  );
  return Response.json(rows);
});

// Crear partido (admin o co-admin del grupo).
// Body: { groupId, scheduledAt, location?, notes?, format, playerIds: string[],
//         guests?: [{ name, stars?, pos? }], assignment?: { A: string[], B: string[] }, pollId? }
// Mínimo 10 jugadores entre convocados e invitados (5 contra 5).
// Con "assignment" se guarda el reparto ya visto en la previsualización; sin él se balancea aquí.
// Con "pollId" (botón "Crear Partido con Confirmados") la encuesta queda enlazada y cerrada, y se
// publica un mensaje automático en el chat con el enlace al partido.
export const POST = handle(async (req) => {
  const me = await requireUser(req);
  const b = await readBody(req);
  const startersPerSide = startersFor(b.format);
  const when = new Date(b.scheduledAt);
  if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
    throw new HttpError(400, 'La fecha y hora del partido deben ser posteriores al momento actual');
  }

  const guests = (Array.isArray(b.guests) ? b.guests : []).map(parseGuest);
  const memberCount = Array.isArray(b.playerIds) ? b.playerIds.length : 0;
  if (memberCount + guests.length < MIN_PLAYERS) {
    throw new HttpError(400, `No son suficientes jugadores para crear un partido (mínimo ${MIN_PLAYERS})`);
  }
  const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 500) : null;

  const out = await tx(async (c) => {
    const g = await assertGroup(c, me.playerId, b.groupId, 'manager');
    const members = memberCount ? await loadConvocados(c, b.groupId, b.playerIds) : [];
    // Invitados externos: entran en el reparto con un id temporal y se guardan con player_id NULL
    const players: Convocado[] = [
      ...members,
      ...guests.map((x, i) => ({ id: guestKey(i), name: x.name, stars: x.stars, pos: x.pos, photo: null, nick: null, isGuest: true })),
    ];

    let pollId: string | null = null;
    if (b.pollId) {
      pollId = assertUuid(b.pollId, 'pollId');
      const p = await c.query('SELECT group_id, match_id FROM polls WHERE id = $1 FOR UPDATE', [pollId]);
      if (!p.rowCount || p.rows[0].group_id !== b.groupId) throw new HttpError(400, 'La encuesta no pertenece a este grupo');
      if (p.rows[0].match_id) throw new HttpError(409, 'Ya se creó un partido desde esta encuesta');
    }

    const result = b.assignment
      ? fromAssignment(players, b.assignment, startersPerSide)
      : balanceTeams(players, { startersPerSide });

    const balanceStats = statsOf(result);
    const m = await c.query(
      `INSERT INTO matches (group_id, scheduled_at, location, notes, format, starters_per_side, balance_stats)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [b.groupId, when.toISOString(), b.location ?? null, notes, b.format, startersPerSide, JSON.stringify(balanceStats)]
    );
    const matchId: string = m.rows[0].id;

    // SNAPSHOT: se congelan nombre, estrellas y foto en este momento.
    for (const r of toSnapshotRows(result)) {
      await c.query(
        `INSERT INTO match_players
           (match_id, player_id, name_snapshot, stars_snapshot, photo_snapshot, team, is_starter,
            pos_snapshot, nick_snapshot, is_guest)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [matchId, isGuestKey(r.playerId) ? null : r.playerId, r.name, r.stars, r.photo, r.team, r.isStarter,
         r.pos, r.nick, isGuestKey(r.playerId)]
      );
    }

    if (pollId) await c.query(`UPDATE polls SET match_id = $2, status = 'closed' WHERE id = $1`, [pollId, matchId]);

    const fecha = matchWhen(when);
    await systemMessage(
      c, b.groupId,
      `⚽ Partido creado: ${fecha}${b.location ? ` · ${b.location}` : ''} · ${players.length} convocados` +
        `${guests.length ? ` (${guests.length} invitados)` : ''}. ¡Ya están los equipos!`,
      { event: 'match_created', matchId, pollId }
    );
    // El creador ya lo ha visto
    await c.query('UPDATE group_players SET last_seen_matches_at = now() WHERE group_id = $1 AND player_id = $2', [b.groupId, me.playerId]);
    await notify(c, {
      groupId: b.groupId, type: 'match_created', recipients: 'members', exclude: me.playerId,
      title: `⚽ Nuevo partido en ${g.name}`, body: `${fecha}${b.location ? ` · ${b.location}` : ''}`, data: { matchId },
    });

    return { id: matchId, scheduledAt: when.toISOString(), teams: result, balanceStats };
  });
  return Response.json(out, { status: 201 });
});
