import { pool } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireAdmin } from '@/lib/auth';
import { finishDueMatches } from '@/lib/queries';

// Registrar resultado y MVP de un partido ya finalizado.
// Body: { scoreA: number, scoreB: number, mvpEntryId?: string }
export const POST = handle(async (req, { params }) => {
  const adminId = requireAdmin(req);
  const { id } = await params;
  const b = await readBody(req);
  const scoreA = Number(b.scoreA);
  const scoreB = Number(b.scoreB);
  if (![scoreA, scoreB].every((n) => Number.isInteger(n) && n >= 0 && n <= 99)) {
    throw new HttpError(400, 'scoreA y scoreB deben ser enteros entre 0 y 99');
  }

  await finishDueMatches(pool);
  if (b.mvpEntryId) {
    const e = await pool.query('SELECT 1 FROM match_players WHERE id = $1 AND match_id = $2', [b.mvpEntryId, id]);
    if (!e.rowCount) throw new HttpError(400, 'El MVP debe ser alguien de la convocatoria de este partido');
  }
  const r = await pool.query(
    `UPDATE matches m SET score_a = $3, score_b = $4, mvp_entry_id = $5
       FROM groups g
      WHERE m.id = $1 AND m.group_id = g.id AND g.admin_id = $2 AND m.status = 'finished'
      RETURNING m.id`,
    [id, adminId, scoreA, scoreB, b.mvpEntryId ?? null]
  );
  if (!r.rowCount) throw new HttpError(409, 'Solo se puede registrar el resultado de un partido finalizado');
  return Response.json({ id, scoreA, scoreB, mvpEntryId: b.mvpEntryId ?? null });
});
