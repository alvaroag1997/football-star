import { pool } from '@/lib/db';
import { handle } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup } from '@/lib/queries';

/**
 * "Añadir jugador de otro grupo": SOLO jugadores activos que están activos en OTROS grupos
 * del usuario y que no están ya en este. Los huérfanos (sin grupo) nunca aparecen.
 * GET /api/players?groupId=<grupo destino>
 */
export const GET = handle(async (req) => {
  const me = await requireUser(req);
  const groupId = new URL(req.url).searchParams.get('groupId');
  await assertGroup(pool, me.playerId, groupId, 'manager');
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.nick, p.pos, (p.auth_user_id IS NOT NULL) AS "hasAccount",
            array_agg(DISTINCT g.name ORDER BY g.name) AS "fromGroups"
       FROM group_players mine
       JOIN groups g         ON g.id = mine.group_id AND g.is_active AND g.id <> $2
       JOIN group_players gp ON gp.group_id = g.id AND gp.is_active
       JOIN players p        ON p.id = gp.player_id AND p.is_active
      WHERE mine.player_id = $1 AND mine.is_active
        AND NOT EXISTS (SELECT 1 FROM group_players t WHERE t.group_id = $2 AND t.player_id = p.id AND t.is_active)
      GROUP BY p.id
      ORDER BY p.name`,
    [me.playerId, groupId]
  );
  return Response.json(rows);
});
