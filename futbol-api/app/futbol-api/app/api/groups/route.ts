import { pool } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireAdmin } from '@/lib/auth';

// Lista de grupos del admin (alimenta el desplegable de "Crear Partido")
export const GET = handle(async (req) => {
  const adminId = requireAdmin(req);
  const { rows } = await pool.query(
    `SELECT g.id, g.name,
            (SELECT count(*) FROM group_players gp WHERE gp.group_id = g.id AND gp.is_active)::int AS players
       FROM groups g
      WHERE g.admin_id = $1 AND g.is_active
      ORDER BY g.name`,
    [adminId]
  );
  return Response.json(rows);
});

export const POST = handle(async (req) => {
  const adminId = requireAdmin(req);
  const { name } = await readBody(req);
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'name es obligatorio');
  const { rows } = await pool.query(
    'INSERT INTO groups (admin_id, name) VALUES ($1, $2) RETURNING id, name',
    [adminId, name.trim()]
  );
  return Response.json(rows[0], { status: 201 });
});
