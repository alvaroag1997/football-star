import { pool } from '@/lib/db';
import { handle } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { finishDueMatches } from '@/lib/queries';

// Pestaña "Historial": partidos finalizados con equipos, resultado y MVP.
// Todo sale de los snapshots, así que los jugadores eliminados siguen apareciendo.
// ?groupId=... para filtrar por grupo. Solo partidos de TUS grupos; las estrellas solo para admin/co-admins.
export const GET = handle(async (req) => {
  const me = await requireUser(req);
  const groupId = new URL(req.url).searchParams.get('groupId');
  await finishDueMatches(pool);

  const { rows } = await pool.query(
    `SELECT m.id, m.group_id AS "groupId", g.name AS "groupName",
            m.scheduled_at AS "scheduledAt", m.location, m.format,
            m.starters_per_side AS "startersPerSide",
            m.score_a AS "scoreA", m.score_b AS "scoreB",
            (m.score_a IS NULL) AS "needsResult",
            CASE WHEN gp.role IN ('owner', 'co_admin') THEN m.balance_stats END AS "balanceStats",
            mvp.name_snapshot AS "mvpName", mvp.photo_snapshot AS "mvpPhoto",
            COALESCE((
              SELECT json_agg(json_build_object(
                       'entryId', x.id, 'name', x.name_snapshot,
                       'stars', CASE WHEN gp.role IN ('owner', 'co_admin') THEN x.stars_snapshot::float8 ELSE 0 END,
                       'photo', x.photo_snapshot, 'team', x.team, 'isStarter', x.is_starter,
                       'pos', x.pos_snapshot, 'nick', x.nick_snapshot)
                     ORDER BY x.team, x.is_starter DESC, x.stars_snapshot DESC)
                FROM match_players x WHERE x.match_id = m.id
            ), '[]'::json) AS roster
       FROM matches m
       JOIN groups g ON g.id = m.group_id AND g.is_active
       JOIN group_players gp ON gp.group_id = g.id AND gp.player_id = $1 AND gp.is_active
       LEFT JOIN match_players mvp ON mvp.id = m.mvp_entry_id
      WHERE m.status = 'finished'
        AND ($2::uuid IS NULL OR m.group_id = $2)
      ORDER BY m.scheduled_at DESC
      LIMIT 100`,
    [me.playerId, groupId]
  );
  return Response.json(rows);
});
