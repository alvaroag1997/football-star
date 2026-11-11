import { pool } from '@/lib/db';
import { handle, HttpError } from '@/lib/http';
import { requireAdmin } from '@/lib/auth';
import { assertGroup, finishDueMatches } from '@/lib/queries';

// Estadísticas de los jugadores de un grupo, calculadas con los partidos finalizados que tienen resultado:
// partidos jugados (pj), victorias (w) y veces MVP. Sirve para el ranking y los ajustes de estrellas sugeridos.
export const GET = handle(async (req) => {
  const adminId = requireAdmin(req);
  const groupId = new URL(req.url).searchParams.get('groupId');
  if (!groupId) throw new HttpError(400, 'groupId es obligatorio');
  await assertGroup(pool, adminId, groupId);
  await finishDueMatches(pool);

  const { rows } = await pool.query(
    `SELECT p.id AS "playerId", p.name, p.nick, p.pos, gp.stars::float8 AS stars,
            count(*) FILTER (WHERE m.score_a IS NOT NULL)::int AS pj,
            count(*) FILTER (WHERE m.score_a IS NOT NULL AND (
                 (mp.team = 'A' AND m.score_a > m.score_b) OR (mp.team = 'B' AND m.score_b > m.score_a)))::int AS w,
            count(*) FILTER (WHERE m.mvp_entry_id = mp.id)::int AS mvp
       FROM group_players gp
       JOIN players p ON p.id = gp.player_id
       LEFT JOIN match_players mp ON mp.player_id = p.id
       LEFT JOIN matches m ON m.id = mp.match_id AND m.group_id = gp.group_id AND m.status = 'finished'
      WHERE gp.group_id = $1 AND gp.is_active AND p.is_active
      GROUP BY p.id, gp.stars
      ORDER BY p.name`,
    [groupId]
  );
  return Response.json(rows);
});
