import { tx } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup, assertUuid, parseGuest } from '@/lib/queries';
import { loadPoll } from '@/lib/polls';

// "+ Añadir invitado" a una encuesta abierta (solo admin / co-admin).
// Body: { name, stars?: 1..5 (por defecto 3), pos?: 'GK' | 'DEF' | 'ATT' }
// El invitado cuenta como "Me apunto" (cupo incluido) y pasa al partido al crearlo desde la encuesta.
export const POST = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { pollId } = await params;
  const guest = parseGuest(await readBody(req));

  const poll = await tx(async (c) => {
    const p = await c.query('SELECT group_id, status, match_id FROM polls WHERE id = $1 FOR UPDATE', [assertUuid(pollId, 'pollId')]);
    if (!p.rowCount) throw new HttpError(404, 'Encuesta no encontrada');
    await assertGroup(c, me.playerId, p.rows[0].group_id, 'manager');
    if (p.rows[0].status !== 'open' || p.rows[0].match_id) throw new HttpError(409, 'La encuesta está cerrada');
    await c.query(
      'INSERT INTO poll_guests (poll_id, group_id, name, stars, pos, added_by) VALUES ($1, $2, $3, $4, $5, $6)',
      [pollId, p.rows[0].group_id, guest.name, guest.stars, guest.pos, me.playerId]
    );
    return loadPoll(c, pollId, me.playerId);
  });
  return Response.json(poll, { status: 201 });
});
