import { pool, tx } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireAdmin } from '@/lib/auth';
import {
  assertGroup, loadConvocados, startersFor, fromAssignment, finishDueMatches,
} from '@/lib/queries';
import { balanceTeams, toSnapshotRows } from '@/lib/teamBalancer';

// Lista de partidos. Por defecto solo los pendientes (vista principal).
// ?status=pending|cancelled  ·  ?groupId=...
// Los finalizados van por /api/history.
export const GET = handle(async (req) => {
  const adminId = requireAdmin(req);
  const url = new URL(req.url);
  const status = url.searchParams.get('status') ?? 'pending';
  if (!['pending', 'cancelled'].includes(status)) throw new HttpError(400, 'status inválido (usa /api/history para finalizados)');
  const groupId = url.searchParams.get('groupId');

  await finishDueMatches(pool); // transición perezosa por si el cron aún no ha corrido
  const { rows } = await pool.query(
    `SELECT m.id, m.group_id AS "groupId", g.name AS "groupName", m.scheduled_at AS "scheduledAt",
            m.location, m.format, m.starters_per_side AS "startersPerSide", m.status,
            m.balance_stats AS "balanceStats",
            (SELECT count(*) FROM match_players x WHERE x.match_id = m.id)::int AS "playersCount"
       FROM matches m JOIN groups g ON g.id = m.group_id
      WHERE g.admin_id = $1 AND m.status = $2 AND ($3::uuid IS NULL OR m.group_id = $3)
      ORDER BY m.scheduled_at`,
    [adminId, status, groupId]
  );
  return Response.json(rows);
});

// Crear partido.
// Body: { groupId, scheduledAt, location?, format, playerIds: string[],
//         assignment?: { A: string[], B: string[] } }
// Con "assignment" se guarda el reparto ya visto en la previsualización;
// sin él se balancea aquí.
export const POST = handle(async (req) => {
  const adminId = requireAdmin(req);
  const b = await readBody(req);
  const startersPerSide = startersFor(b.format);
  const when = new Date(b.scheduledAt);
  if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
    throw new HttpError(400, 'scheduledAt debe ser una fecha y hora futuras (ISO 8601)');
  }

  const out = await tx(async (c) => {
    await assertGroup(c, adminId, b.groupId);
    const players = await loadConvocados(c, b.groupId, b.playerIds);
    const result = b.assignment
      ? fromAssignment(players, b.assignment, startersPerSide)
      : balanceTeams(players, { startersPerSide });

    const balanceStats = {
      sumA: result.teamA.sum, sumB: result.teamB.sum,
      meanA: result.teamA.mean, meanB: result.teamB.mean,
      diffSum: result.stats.diffSum, diffMean: result.stats.diffMean,
    };
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
           (match_id, player_id, name_snapshot, stars_snapshot, photo_snapshot, team, is_starter)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [matchId, r.playerId, r.name, r.stars, r.photo, r.team, r.isStarter]
      );
    }
    return { id: matchId, scheduledAt: when.toISOString(), teams: result, balanceStats };
  });
  return Response.json(out, { status: 201 });
});
