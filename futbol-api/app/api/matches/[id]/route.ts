import { pool } from '@/lib/db';
import { handle } from '@/lib/http';
import { requireAdmin } from '@/lib/auth';
import { finishDueMatches } from '@/lib/queries';
import { loadDetail } from '@/lib/matches';

// Detalle de un partido con su convocatoria (siempre desde los snapshots).
export const GET = handle(async (req, { params }) => {
  const adminId = requireAdmin(req);
  const { id } = await params;
  await finishDueMatches(pool);
  return Response.json(await loadDetail(pool, adminId, id));
});
