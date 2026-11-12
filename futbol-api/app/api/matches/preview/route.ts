import { pool } from '@/lib/db';
import { handle, readBody } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup, loadConvocados, startersFor } from '@/lib/queries';
import { balanceTeams } from '@/lib/teamBalancer';

// Genera equipos sin guardar nada (botón "Regenerar" de la app).
// Body: { groupId, format, playerIds: string[] }
export const POST = handle(async (req) => {
  const me = await requireUser(req);
  const b = await readBody(req);
  const startersPerSide = startersFor(b.format);
  await assertGroup(pool, me.playerId, b.groupId, 'manager');
  const players = await loadConvocados(pool, b.groupId, b.playerIds);
  return Response.json(balanceTeams(players, { startersPerSide }));
});
