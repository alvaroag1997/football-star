import { pool } from '@/lib/db';
import { handle, HttpError } from '@/lib/http';
import { requireAdmin } from '@/lib/auth';

// Cancelar un partido: solo si sigue "pending" (antes de su fecha y hora).
export const POST = handle(async (req, { params }) => {
  const adminId = requireAdmin(req);
  const { id } = await params;
  const r = await pool.query(
    `UPDATE matches m SET status = 'cancelled', cancelled_at = now()
       FROM groups g
      WHERE m.id = $1 AND m.group_id = g.id AND g.admin_id = $2
        AND m.status = 'pending' AND m.scheduled_at > now()
      RETURNING m.id`,
    [id, adminId]
  );
  if (!r.rowCount) throw new HttpError(409, 'Solo se pueden cancelar partidos pendientes que aún no han empezado');
  return Response.json({ id, status: 'cancelled' });
});
