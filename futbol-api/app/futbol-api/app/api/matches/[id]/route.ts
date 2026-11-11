import { pool } from '@/lib/db';
import { handle, HttpError } from '@/lib/http';
import { requireAdmin } from '@/lib/auth';
import { finishDueMatches } from '@/lib/queries';

// Detalle de un partido con su convocatoria (siempre desde los snapshots).
export const GET = handle(async (req, { params }) => {
  const adminId = requireAdmin(req);
  const { id } = await params;
  await finishDueMatches(pool);

  const m = await pool.query(
    `SELECT m.id, m.group_id AS "groupId", g.name AS "groupName", m.scheduled_at AS "scheduledAt",
            m.location, m.format, m.starters_per_side AS "startersPerSide", m.status,
            m.score_a AS "scoreA", m.score_b AS "scoreB", m.mvp_entry_id AS "mvpEntryId",
            m.balance_stats AS "balanceStats",
            (m.status = 'finished' AND m.score_a IS NULL) AS "needsResult"
       FROM matches m JOIN groups g ON g.id = m.group_id
      WHERE m.id = $1 AND g.admin_id = $2`,
    [id, adminId]
  );
  if (!m.rows.length) throw new HttpError(404, 'Partido no encontrado');

  const roster = await pool.query(
    `SELECT id AS "entryId", player_id AS "playerId", name_snapshot AS name,
            stars_snapshot::float8 AS stars, photo_snapshot AS photo, team, is_starter AS "isStarter"
       FROM match_players WHERE match_id = $1
      ORDER BY team, is_starter DESC, stars_snapshot DESC`,
    [id]
  );
  return Response.json({ ...m.rows[0], roster: roster.rows });
});
