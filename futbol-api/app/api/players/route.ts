import { pool } from '@/lib/db';
import { handle } from '@/lib/http';
import { requireAdmin } from '@/lib/auth';

// Todas las personas activas del admin (para reutilizar un jugador en otro grupo).
export const GET = handle(async (req) => {
  const adminId = requireAdmin(req);
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.photo_url AS "photoUrl",
            COALESCE((SELECT json_agg(gp.group_id) FROM group_players gp
                       WHERE gp.player_id = p.id AND gp.is_active), '[]'::json) AS "groupIds"
       FROM players p
      WHERE p.admin_id = $1 AND p.is_active
      ORDER BY p.name`,
    [adminId]
  );
  return Response.json(rows);
});
