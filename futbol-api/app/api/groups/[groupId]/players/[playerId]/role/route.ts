import { pool } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup, assertUuid } from '@/lib/queries';

// Ascender / degradar co-administradores (solo el creador). Body: { role: 'co_admin' | 'member' }
// Solo jugadores con cuenta: un jugador manual no puede iniciar sesión.
export const PATCH = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { groupId, playerId } = await params;
  await assertGroup(pool, me.playerId, groupId, 'owner');
  const { role } = await readBody(req);
  if (role !== 'co_admin' && role !== 'member') throw new HttpError(400, "role debe ser 'co_admin' o 'member'");
  if (assertUuid(playerId, 'playerId') === me.playerId) throw new HttpError(400, 'No puedes cambiar tu propio rol');

  const r = await pool.query(
    `UPDATE group_players gp SET role = $3
       FROM players p
      WHERE gp.group_id = $1 AND gp.player_id = $2 AND gp.is_active AND gp.role <> 'owner'
        AND p.id = gp.player_id AND p.auth_user_id IS NOT NULL
      RETURNING gp.role`,
    [groupId, playerId, role]
  );
  if (!r.rowCount) throw new HttpError(404, 'Jugador no encontrado o sin cuenta (invítale con el enlace primero)');
  return Response.json({ playerId, role });
});
