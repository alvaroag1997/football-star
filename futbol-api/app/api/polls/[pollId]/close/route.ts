import { pool } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup, assertUuid } from '@/lib/queries';
import { loadPoll } from '@/lib/polls';

// Cerrar o reabrir una encuesta (admin o co-admin). Body: { reopen?: boolean }
export const POST = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { pollId } = await params;
  const p = await pool.query('SELECT group_id FROM polls WHERE id = $1', [assertUuid(pollId, 'pollId')]);
  if (!p.rowCount) throw new HttpError(404, 'Encuesta no encontrada');
  await assertGroup(pool, me.playerId, p.rows[0].group_id, 'manager');
  const b = await readBody(req).catch(() => ({}));
  await pool.query('UPDATE polls SET status = $2 WHERE id = $1', [pollId, b?.reopen ? 'open' : 'closed']);
  return Response.json(await loadPoll(pool, pollId, me.playerId));
});
