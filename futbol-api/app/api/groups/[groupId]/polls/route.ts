import { tx } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup, startersFor } from '@/lib/queries';
import { loadPoll, MSG_SELECT } from '@/lib/polls';

// Crear encuesta de asistencia en el chat (cualquier miembro).
// Body: { question, matchAt (ISO futuro), maxSlots?: 2..60 | null, format?: '5v5' | '7v7' | '11v11' }
export const POST = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { groupId } = await params;
  const b = await readBody(req);
  const question = typeof b.question === 'string' ? b.question.trim() : '';
  if (!question || question.length > 200) throw new HttpError(400, 'Escribe la pregunta (máx. 200 caracteres)');
  const when = new Date(b.matchAt);
  if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {
    throw new HttpError(400, 'La fecha del partido debe ser posterior al momento actual');
  }
  const maxSlots = b.maxSlots == null ? null : Number(b.maxSlots);
  if (maxSlots !== null && (!Number.isInteger(maxSlots) || maxSlots < 2 || maxSlots > 60)) {
    throw new HttpError(400, 'El cupo debe estar entre 2 y 60');
  }
  const format = b.format ? (startersFor(b.format), b.format as string) : null;

  const out = await tx(async (c) => {
    await assertGroup(c, me.playerId, groupId);
    const p = await c.query(
      `INSERT INTO polls (group_id, created_by, question, match_at, max_slots, format)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [groupId, me.playerId, question, when.toISOString(), maxSlots, format]
    );
    const pollId: string = p.rows[0].id;
    const m = await c.query(
      `INSERT INTO chat_messages (group_id, player_id, type, content, poll_id) VALUES ($1, $2, 'poll', $3, $4) RETURNING id`,
      [groupId, me.playerId, question, pollId]
    );
    const msg = await c.query(`${MSG_SELECT} WHERE c.id = $1`, [m.rows[0].id]);
    return { ...msg.rows[0], poll: await loadPoll(c, pollId, me.playerId) };
  });
  return Response.json(out, { status: 201 });
});
