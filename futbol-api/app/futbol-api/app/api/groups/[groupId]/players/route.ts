import { pool, tx } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireAdmin } from '@/lib/auth';
import { assertGroup } from '@/lib/queries';

// Jugadores activos de UN grupo
export const GET = handle(async (req, { params }) => {
  const adminId = requireAdmin(req);
  const { groupId } = await params;
  await assertGroup(pool, adminId, groupId);
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.photo_url AS "photoUrl", gp.stars::float8 AS stars
       FROM group_players gp JOIN players p ON p.id = gp.player_id
      WHERE gp.group_id = $1 AND gp.is_active AND p.is_active
      ORDER BY p.name`,
    [groupId]
  );
  return Response.json(rows);
});

// Añade un jugador al grupo. Con "playerId" reutiliza a una persona que ya
// existe en otro grupo; sin él crea una nueva.
export const POST = handle(async (req, { params }) => {
  const adminId = requireAdmin(req);
  const { groupId } = await params;
  const b = await readBody(req);
  const stars = Number(b.stars);
  if (!Number.isFinite(stars) || stars < 0 || stars > 10) throw new HttpError(400, 'stars debe estar entre 0 y 10');

  const out = await tx(async (c) => {
    await assertGroup(c, adminId, groupId);
    let playerId: string = b.playerId;
    if (playerId) {
      const r = await c.query('SELECT id FROM players WHERE id = $1 AND admin_id = $2 AND is_active', [playerId, adminId]);
      if (!r.rows.length) throw new HttpError(404, 'Jugador no encontrado');
    } else {
      if (typeof b.name !== 'string' || !b.name.trim()) throw new HttpError(400, 'name es obligatorio');
      const r = await c.query(
        'INSERT INTO players (admin_id, name, photo_url) VALUES ($1, $2, $3) RETURNING id',
        [adminId, b.name.trim(), b.photoUrl ?? null]
      );
      playerId = r.rows[0].id;
    }
    await c.query(
      `INSERT INTO group_players (group_id, player_id, stars) VALUES ($1, $2, $3)
       ON CONFLICT (group_id, player_id)
       DO UPDATE SET stars = EXCLUDED.stars, is_active = TRUE, left_at = NULL`,
      [groupId, playerId, stars]
    );
    return { id: playerId, groupId, stars };
  });
  return Response.json(out, { status: 201 });
});
