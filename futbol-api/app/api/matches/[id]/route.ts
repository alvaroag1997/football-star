import { pool, tx } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertUuid, finishDueMatches, parseGuest, parsePos, startersFor } from '@/lib/queries';
import { loadDetail, loadEntries, lockPending, matchWhen, statsOf } from '@/lib/matches';
import { evaluateSplit } from '@/lib/teamBalancer';
import { systemMessage } from '@/lib/queries';
import { notify } from '@/lib/notify';

// Detalle de un partido con su convocatoria (siempre desde los snapshots). Solo miembros del grupo.
export const GET = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { id } = await params;
  await finishDueMatches(pool);
  return Response.json(await loadDetail(pool, me.playerId, assertUuid(id)));
});

type RosterItem = {
  entryId?: string; playerId?: string; guest?: { name: string; pos?: string };
  team: 'A' | 'B'; isStarter: boolean; stars: number;
};

/**
 * EDITAR PARTIDO (admin o co-admin, solo partidos pendientes que aún no han empezado).
 * Se envía el estado completo deseado y el servidor guarda las diferencias:
 * {
 *   scheduledAt, location, notes, format,
 *   roster: [{ entryId (ya convocado) | playerId (miembro nuevo) | guest: { name, pos } (invitado nuevo),
 *              team: 'A' | 'B', isStarter, stars }]
 * }
 * Los que no aparezcan en roster salen de la convocatoria. Después se publica un resumen en el
 * chat ("⚠️ El admin ha actualizado el partido…") y se avisa a los convocados (y a los que salen).
 */
export const PUT = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { id } = await params;
  const b = await readBody(req);
  const matchId = assertUuid(id);

  const when = new Date(b.scheduledAt);
  if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
    throw new HttpError(400, 'La fecha y hora del partido deben ser posteriores al momento actual');
  }
  const startersPerSide = startersFor(b.format);
  const location = typeof b.location === 'string' && b.location.trim() ? b.location.trim().slice(0, 200) : null;
  const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 500) : null;
  if (!Array.isArray(b.roster) || b.roster.length < 2) throw new HttpError(400, 'La convocatoria necesita al menos 2 jugadores');
  const roster: RosterItem[] = b.roster.map((r: any) => {
    const stars = Number(r?.stars);
    if (r?.team !== 'A' && r?.team !== 'B') throw new HttpError(400, 'Cada jugador debe ir al Equipo A o al B');
    if (!Number.isFinite(stars) || stars < 0 || stars > 10) throw new HttpError(400, 'Las estrellas van de 0 a 10');
    return { entryId: r.entryId, playerId: r.playerId, guest: r.guest, team: r.team, isStarter: !!r.isStarter, stars: Math.round(stars * 2) / 2 };
  });
  if (!roster.some((r) => r.team === 'A') || !roster.some((r) => r.team === 'B')) {
    throw new HttpError(400, 'Cada equipo necesita al menos un jugador');
  }

  const result = await tx(async (c) => {
    await lockPending(c, me.playerId, matchId);
    const cur = (await c.query(
      `SELECT m.group_id AS "groupId", g.name AS "groupName", m.scheduled_at AS "scheduledAt", m.location, m.notes, m.format
         FROM matches m JOIN groups g ON g.id = m.group_id WHERE m.id = $1`,
      [matchId]
    )).rows[0];
    const entries = await loadEntries(c, matchId);
    const byEntry = new Map(entries.map((e) => [e.id, e]));

    // --- validar la convocatoria pedida
    const keep = roster.filter((r) => r.entryId);
    const keepIds = new Set<string>();
    for (const r of keep) {
      if (!byEntry.has(r.entryId as string)) throw new HttpError(400, 'Hay jugadores que no pertenecen a este partido');
      if (keepIds.has(r.entryId as string)) throw new HttpError(400, 'Hay jugadores repetidos');
      keepIds.add(r.entryId as string);
    }
    const newMembers = roster.filter((r) => !r.entryId && r.playerId);
    const newGuests = roster.filter((r) => !r.entryId && !r.playerId && r.guest).map((r) => ({ r, g: parseGuest({ ...r.guest, stars: 3 }) }));
    if (keep.length + newMembers.length + newGuests.length !== roster.length) throw new HttpError(400, 'roster no es válido');

    const already = new Set(entries.filter((e) => keepIds.has(e.id) && e.playerId).map((e) => e.playerId));
    const memberIds = newMembers.map((r) => assertUuid(r.playerId, 'playerId'));
    if (memberIds.some((pid) => already.has(pid)) || new Set(memberIds).size !== memberIds.length) {
      throw new HttpError(400, 'Ese jugador ya está convocado');
    }
    const memberRows = memberIds.length
      ? (await c.query(
          `SELECT p.id, p.display_name AS name, p.nick, p.pos, p.photo_url AS photo
             FROM group_players gp JOIN players p ON p.id = gp.player_id
            WHERE gp.group_id = $1 AND gp.is_active AND p.is_active AND p.id = ANY($2::uuid[])`,
          [cur.groupId, memberIds]
        )).rows
      : [];
    if (memberRows.length !== memberIds.length) throw new HttpError(400, 'Algún jugador no pertenece a este grupo');
    const memberById = new Map(memberRows.map((m) => [m.id, m]));

    // --- escribir: bajas, cambios, altas
    const removed = entries.filter((e) => !keepIds.has(e.id));
    if (removed.length) await c.query('DELETE FROM match_players WHERE id = ANY($1::uuid[])', [removed.map((e) => e.id)]);

    let teamsChanged = false;
    for (const r of keep) {
      const e = byEntry.get(r.entryId as string)!;
      if (e.team !== r.team || e.isStarter !== r.isStarter || Number(e.stars) !== r.stars) teamsChanged = true;
      await c.query('UPDATE match_players SET team = $2::team_side, is_starter = $3, stars_snapshot = $4 WHERE id = $1',
        [e.id, r.team, r.isStarter, r.stars]);
    }
    const added: string[] = [];
    for (const r of newMembers) {
      const m = memberById.get(r.playerId as string)!;
      added.push(m.name);
      await c.query(
        `INSERT INTO match_players (match_id, player_id, name_snapshot, stars_snapshot, photo_snapshot, team, is_starter, pos_snapshot, nick_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6::team_side, $7, $8, $9)`,
        [matchId, m.id, m.name, r.stars, m.photo, r.team, r.isStarter, m.pos, m.nick]
      );
    }
    for (const { r, g } of newGuests) {
      added.push(`${g.name} (invitado)`);
      await c.query(
        `INSERT INTO match_players (match_id, player_id, name_snapshot, stars_snapshot, photo_snapshot, team, is_starter, pos_snapshot, nick_snapshot, is_guest)
         VALUES ($1, NULL, $2, $3, NULL, $4::team_side, $5, $6, NULL, TRUE)`,
        [matchId, g.name, r.stars, r.team, r.isStarter, parsePos(r.guest?.pos)]
      );
    }

    // --- estadísticas de equilibrio con el reparto final
    const final = await loadEntries(c, matchId);
    const asP = (e: (typeof final)[number]) => ({ id: e.id, name: e.name, stars: Number(e.stars), pos: e.pos });
    const stats = statsOf(evaluateSplit(final.filter((e) => e.team === 'A').map(asP), final.filter((e) => e.team === 'B').map(asP), startersPerSide));
    await c.query(
      `UPDATE matches SET scheduled_at = $2, location = $3, notes = $4, format = $5, starters_per_side = $6,
              balance_stats = $7, updated_at = now()
        WHERE id = $1`,
      [matchId, when.toISOString(), location, notes, b.format, startersPerSide, JSON.stringify(stats)]
    );

    // --- resumen de cambios para el chat y los avisos
    const changes: string[] = [];
    const oldWhen = new Date(cur.scheduledAt);
    if (oldWhen.getTime() !== when.getTime()) {
      const tz = process.env.APP_TIMEZONE || 'Europe/Madrid';
      const dayKey = (d: Date) => new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeZone: tz }).format(d);
      const hour = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(when);
      changes.push(dayKey(oldWhen) === dayKey(when) ? `nueva hora ${hour}h` : `nueva fecha ${matchWhen(when)}`);
    }
    if ((cur.location ?? null) !== location) changes.push(location ? `nuevo lugar: ${location}` : 'lugar por confirmar');
    if (cur.format !== b.format) changes.push(`ahora es ${b.format}`);
    if (added.length) changes.push(`se ${added.length === 1 ? 'suma' : 'suman'} ${added.join(', ')}`);
    if (removed.length) changes.push(`${removed.length === 1 ? 'sale' : 'salen'} ${removed.map((e) => e.name).join(', ')}`);
    if (teamsChanged && !added.length && !removed.length) changes.push('equipos actualizados');
    if ((cur.notes ?? null) !== notes) changes.push('notas actualizadas');

    // Quien edita ya ha visto el cambio (no le sale como "Nuevo")
    await c.query('UPDATE group_players SET last_seen_matches_at = now() WHERE group_id = $1 AND player_id = $2', [cur.groupId, me.playerId]);

    if (changes.length) {
      const day = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', timeZone: process.env.APP_TIMEZONE || 'Europe/Madrid' }).format(oldWhen);
      const text = `⚠️ El admin ha actualizado el partido del ${day}: ${changes.join(' · ')}`;
      await systemMessage(c, cur.groupId, text, { event: 'match_updated', matchId });
      const recipients = [
        ...final.map((e) => e.playerId),
        ...removed.map((e) => e.playerId),
      ].filter((x): x is string => !!x);
      await notify(c, {
        groupId: cur.groupId, type: 'match_updated', recipients, exclude: me.playerId,
        title: `⚠️ Cambios en el partido del ${day}`, body: changes.join(' · '), data: { matchId },
      });
    }
    return { changes };
  });

  const detail = await loadDetail(pool, me.playerId, matchId);
  return Response.json({ ...detail, changes: result.changes });
});
