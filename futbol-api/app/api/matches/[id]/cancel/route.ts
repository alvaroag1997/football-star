import { pool } from '@/lib/db';
import { handle, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertUuid } from '@/lib/queries';

// Cancelar un partido: solo admin/co-admin y solo si sigue "pending" (antes de su fecha y hora).
export const POST = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { id } = await params;
  const r = await pool.query(
    `UPDATE matches m SET status = 'cancelled', cancelled_at = now()
       FROM group_players gp
      WHERE m.id = $1 AND gp.group_id = m.group_id AND gp.player_id = $2 AND gp.is_active
        AND gp.role IN ('owner', 'co_admin')
        AND m.status = 'pending' AND m.scheduled_at > now()
      RETURNING m.id`,
    [assertUuid(id), me.playerId]
  );
  if (!r.rowCount) throw new HttpError(409, 'Solo el admin puede cancelar, y solo partidos pendientes que aún no han empezado');
  return Response.json({ id, status: 'cancelled' });
});
