import { pool } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertUuid, finishDueMatches } from '@/lib/queries';

// Registrar resultado y MVP de un partido ya finalizado (admin o co-admin).
// Body: { scoreA: number, scoreB: number, mvpEntryId?: string }
export const POST = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { id } = await params;
  const b = await readBody(req);
  // Los dos marcadores son obligatorios (un campo vacío NO cuenta como 0)
  const empty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
  if (empty(b.scoreA) || empty(b.scoreB)) throw new HttpError(400, 'Falta el marcador de algún equipo');
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
       FROM group_players gp
      WHERE m.id = $1 AND gp.group_id = m.group_id AND gp.player_id = $2 AND gp.is_active
        AND gp.role IN ('owner', 'co_admin') AND m.status = 'finished'
      RETURNING m.id`,
    [assertUuid(id), me.playerId, scoreA, scoreB, b.mvpEntryId ?? null]
  );
  if (!r.rowCount) throw new HttpError(409, 'Solo el admin puede registrar el resultado, y solo de partidos finalizados');
  return Response.json({ id, scoreA, scoreB, mvpEntryId: b.mvpEntryId ?? null });
});
