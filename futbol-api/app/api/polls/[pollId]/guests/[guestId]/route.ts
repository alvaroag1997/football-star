import { tx } from '@/lib/db';
import { handle, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup, assertUuid } from '@/lib/queries';
import { loadPoll } from '@/lib/polls';

// Quitar un invitado de la encuesta (solo admin / co-admin). El siguiente de la lista de espera entra solo.
export const DELETE = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { pollId, guestId } = await params;
  const poll = await tx(async (c) => {
    const p = await c.query('SELECT group_id FROM polls WHERE id = $1', [assertUuid(pollId, 'pollId')]);
    if (!p.rowCount) throw new HttpError(404, 'Encuesta no encontrada');
    await assertGroup(c, me.playerId, p.rows[0].group_id, 'manager');
    const r = await c.query('DELETE FROM poll_guests WHERE id = $1 AND poll_id = $2', [assertUuid(guestId, 'guestId'), pollId]);
    if (!r.rowCount) throw new HttpError(404, 'Invitado no encontrado');
    return loadPoll(c, pollId, me.playerId);
  });
  return Response.json(poll);
});
