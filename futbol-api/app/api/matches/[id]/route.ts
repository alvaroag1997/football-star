import { pool } from '@/lib/db';
import { handle } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertUuid, finishDueMatches } from '@/lib/queries';
import { loadDetail } from '@/lib/matches';

// Detalle de un partido con su convocatoria (siempre desde los snapshots). Solo miembros del grupo.
export const GET = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { id } = await params;
  await finishDueMatches(pool);
  return Response.json(await loadDetail(pool, me.playerId, assertUuid(id)));
});
