import { pool, tx } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import {
  assertGroup, assertUuid, loadConvocados, startersFor, fromAssignment, finishDueMatches, systemMessage,
} from '@/lib/queries';
import { balanceTeams, toSnapshotRows } from '@/lib/teamBalancer';
import { statsOf } from '@/lib/matches';

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
            (SELECT count(*) FROM match_players x WHERE x.match_id = m.id)::int AS "playersCount"
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
// Body: { groupId, scheduledAt, location?, format, playerIds: string[],
//         assignment?: { A: string[], B: string[] }, pollId? }
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

  const out = await tx(async (c) => {
    await assertGroup(c, me.playerId, b.groupId, 'manager');
    const players = await loadConvocados(c, b.groupId, b.playerIds);

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
      `INSERT INTO matches (group_id, scheduled_at, location, format, starters_per_side, balance_stats)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [b.groupId, when.toISOString(), b.location ?? null, b.format, startersPerSide, JSON.stringify(balanceStats)]
    );
    const matchId: string = m.rows[0].id;

    // SNAPSHOT: se congelan nombre, estrellas y foto en este momento.
    for (const r of toSnapshotRows(result)) {
      await c.query(
        `INSERT INTO match_players
           (match_id, player_id, name_snapshot, stars_snapshot, photo_snapshot, team, is_starter,
            pos_snapshot, nick_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [matchId, r.playerId, r.name, r.stars, r.photo, r.team, r.isStarter, r.pos, r.nick]
      );
    }

    if (pollId) await c.query(`UPDATE polls SET match_id = $2, status = 'closed' WHERE id = $1`, [pollId, matchId]);

    const fecha = new Intl.DateTimeFormat('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
      timeZone: process.env.APP_TIMEZONE || 'Europe/Madrid',
    }).format(when);
    await systemMessage(
      c, b.groupId,
      `⚽ Partido creado: ${fecha}${b.location ? ` · ${b.location}` : ''} · ${players.length} convocados. ¡Ya están los equipos!`,
      { event: 'match_created', matchId, pollId }
    );

    return { id: matchId, scheduledAt: when.toISOString(), teams: result, balanceStats };
  });
  return Response.json(out, { status: 201 });
});
