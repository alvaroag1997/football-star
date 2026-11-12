import { tx } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup, assertUuid } from '@/lib/queries';
import { checkQuorum } from '@/lib/polls';

// Votar: { choice: 'yes' (Me apunto) | 'no' (No puedo) | 'maybe' (Duda) }
export const POST = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { pollId } = await params;
  const { choice } = await readBody(req);
  if (!['yes', 'no', 'maybe'].includes(choice)) throw new HttpError(400, "choice debe ser 'yes', 'no' o 'maybe'");

  const poll = await tx(async (c) => {
    const p = await c.query('SELECT group_id, status FROM polls WHERE id = $1', [assertUuid(pollId, 'pollId')]);
    if (!p.rowCount) throw new HttpError(404, 'Encuesta no encontrada');
    await assertGroup(c, me.playerId, p.rows[0].group_id);
    if (p.rows[0].status !== 'open') throw new HttpError(409, 'La encuesta está cerrada');
    await c.query(
      `INSERT INTO poll_votes (poll_id, group_id, player_id, choice) VALUES ($1, $2, $3, $4)
       ON CONFLICT (poll_id, player_id) DO UPDATE SET choice = EXCLUDED.choice`,
      [pollId, p.rows[0].group_id, me.playerId, choice]
    );
    return checkQuorum(c, pollId, me.playerId); // estado + aviso de "ya somos 10/14/22" si toca
  });
  return Response.json(poll);
});
