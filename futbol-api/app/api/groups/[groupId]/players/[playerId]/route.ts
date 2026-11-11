import { pool, tx } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireAdmin } from '@/lib/auth';
import { assertGroup, parsePos } from '@/lib/queries';

// Editar un jugador: estrellas (en este grupo) y/o nombre, apodo y posición (de la persona).
// Los partidos pasados NO cambian: guardan su snapshot.
export const PATCH = handle(async (req, { params }) => {
  const adminId = requireAdmin(req);
  const { groupId, playerId } = await params;
  const b = await readBody(req);

  await tx(async (c) => {
    await assertGroup(c, adminId, groupId);
    const gp = await c.query(
      'SELECT 1 FROM group_players WHERE group_id = $1 AND player_id = $2 AND is_active',
      [groupId, playerId]
    );
    if (!gp.rowCount) throw new HttpError(404, 'Jugador no encontrado en el grupo');

    if (b.stars !== undefined) {
      const stars = Number(b.stars);
      if (!Number.isFinite(stars) || stars < 0 || stars > 10) throw new HttpError(400, 'stars debe estar entre 0 y 10');
      await c.query('UPDATE group_players SET stars = $3 WHERE group_id = $1 AND player_id = $2', [groupId, playerId, stars]);
    }
    if (b.name !== undefined || b.nick !== undefined || b.pos !== undefined) {
      if (b.name !== undefined && (typeof b.name !== 'string' || !b.name.trim())) throw new HttpError(400, 'name no puede estar vacío');
      const nick = b.nick === undefined ? undefined : typeof b.nick === 'string' && b.nick.trim() ? b.nick.trim() : null;
      await c.query(
        `UPDATE players SET
           name = COALESCE($3, name),
           nick = CASE WHEN $4::boolean THEN $5 ELSE nick END,
           pos  = COALESCE($6, pos)
         WHERE id = $1 AND admin_id = $2`,
        [playerId, adminId, b.name === undefined ? null : b.name.trim(), nick !== undefined, nick ?? null,
         b.pos === undefined ? null : parsePos(b.pos)]
      );
    }
  });
  return Response.json({ ok: true });
});

// SOFT DELETE: nunca se borra la fila.
//  - por defecto, el jugador sale de este grupo
//  - con ?everywhere=true se desactiva la persona en todos los grupos
// El historial sigue mostrándolo gracias a los snapshots.
export const DELETE = handle(async (req, { params }) => {
  const adminId = requireAdmin(req);
  const { groupId, playerId } = await params;
  await assertGroup(pool, adminId, groupId);
  const everywhere = new URL(req.url).searchParams.get('everywhere') === 'true';

  if (everywhere) {
    const r = await pool.query(
      'UPDATE players SET is_active = FALSE, deleted_at = now() WHERE id = $1 AND admin_id = $2 AND is_active',
      [playerId, adminId]
    );
    if (!r.rowCount) throw new HttpError(404, 'Jugador no encontrado');
  } else {
    const r = await pool.query(
      'UPDATE group_players SET is_active = FALSE, left_at = now() WHERE group_id = $1 AND player_id = $2 AND is_active',
      [groupId, playerId]
    );
    if (!r.rowCount) throw new HttpError(404, 'Jugador no encontrado en el grupo');
  }
  return Response.json({ ok: true });
});
