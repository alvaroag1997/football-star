import { pool } from '@/lib/db';
import { handle, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup, assertUuid } from '@/lib/queries';
import { loadPoll } from '@/lib/polls';

// Estado de una encuesta: contadores, confirmados, lista de espera, dudas y "no puedo".
export const GET = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { pollId } = await params;
  const poll = await loadPoll(pool, assertUuid(pollId, 'pollId'), me.playerId);
  if (!poll) throw new HttpError(404, 'Encuesta no encontrada');
  await assertGroup(pool, me.playerId, poll.groupId);
  return Response.json(poll);
});
