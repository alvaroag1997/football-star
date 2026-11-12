import { pool, tx } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';

// SOLO los grupos del usuario (alimenta el desplegable de grupos de toda la app)
export const GET = handle(async (req) => {
  const me = await requireUser(req);
  const { rows } = await pool.query(
    `SELECT g.id, g.name, gp.role,
            (SELECT count(*) FROM group_players x WHERE x.group_id = g.id AND x.is_active)::int AS players
       FROM group_players gp
       JOIN groups g ON g.id = gp.group_id
      WHERE gp.player_id = $1 AND gp.is_active AND g.is_active
      ORDER BY g.name`,
    [me.playerId]
  );
  return Response.json(rows);
});

// Cualquier usuario puede crear un grupo y pasa a ser su admin (owner).
export const POST = handle(async (req) => {
  const me = await requireUser(req);
  const { name } = await readBody(req);
  if (typeof name !== 'string' || !name.trim()) throw new HttpError(400, 'name es obligatorio');
  if (name.trim().length > 60) throw new HttpError(400, 'El nombre es demasiado largo');

  const out = await tx(async (c) => {
    const g = await c.query('INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING id, name', [name.trim(), me.playerId]);
    await c.query(
      `INSERT INTO group_players (group_id, player_id, stars, role)
       SELECT $1, id, level, 'owner' FROM players WHERE id = $2`,
      [g.rows[0].id, me.playerId]
    );
    return { ...g.rows[0], role: 'owner', players: 1 };
  });
  return Response.json(out, { status: 201 });
});
