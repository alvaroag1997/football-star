import { pool } from '@/lib/db';
import { handle, readBody } from '@/lib/http';
import { requireAdmin } from '@/lib/auth';
import { assertGroup, loadConvocados, startersFor } from '@/lib/queries';
import { balanceTeams } from '@/lib/teamBalancer';

// Genera equipos sin guardar nada (botón "Regenerar" de la app).
// Body: { groupId, format, playerIds: string[] }
export const POST = handle(async (req) => {
  const adminId = requireAdmin(req);
  const b = await readBody(req);
  const startersPerSide = startersFor(b.format);
  await assertGroup(pool, adminId, b.groupId);
  const players = await loadConvocados(pool, b.groupId, b.playerIds);
  return Response.json(balanceTeams(players, { startersPerSide }));
});
