import { pool } from '@/lib/db';
import { handle } from '@/lib/http';
import { requireAdmin } from '@/lib/auth';
import { finishDueMatches } from '@/lib/queries';

// Pestaña "Historial": partidos finalizados con equipos, resultado y MVP.
// Todo sale de los snapshots, así que los jugadores eliminados siguen apareciendo.
// ?groupId=... para filtrar por grupo.
export const GET = handle(async (req) => {
  const adminId = requireAdmin(req);
  const groupId = new URL(req.url).searchParams.get('groupId');
  await finishDueMatches(pool);

  const { rows } = await pool.query(
    `SELECT m.id, m.group_id AS "groupId", g.name AS "groupName",
            m.scheduled_at AS "scheduledAt", m.location, m.format,
            m.starters_per_side AS "startersPerSide",
            m.score_a AS "scoreA", m.score_b AS "scoreB",
            (m.score_a IS NULL) AS "needsResult",
            m.balance_stats AS "balanceStats",
            mvp.name_snapshot AS "mvpName", mvp.photo_snapshot AS "mvpPhoto",
            COALESCE((
              SELECT json_agg(json_build_object(
                       'entryId', x.id, 'name', x.name_snapshot, 'stars', x.stars_snapshot::float8,
                       'photo', x.photo_snapshot, 'team', x.team, 'isStarter', x.is_starter,
                       'pos', x.pos_snapshot, 'nick', x.nick_snapshot)
                     ORDER BY x.team, x.is_starter DESC, x.stars_snapshot DESC)
                FROM match_players x WHERE x.match_id = m.id
            ), '[]'::json) AS roster
       FROM matches m
       JOIN groups g ON g.id = m.group_id
       LEFT JOIN match_players mvp ON mvp.id = m.mvp_entry_id
      WHERE g.admin_id = $1 AND m.status = 'finished'
        AND ($2::uuid IS NULL OR m.group_id = $2)
      ORDER BY m.scheduled_at DESC
      LIMIT 100`,
    [adminId, groupId]
  );
  return Response.json(rows);
});
