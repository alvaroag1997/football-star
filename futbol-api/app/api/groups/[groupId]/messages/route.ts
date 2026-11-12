import { pool } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup } from '@/lib/queries';
import { loadPolls, MSG_SELECT } from '@/lib/polls';
import { notify } from '@/lib/notify';

// Chat del grupo. GET ?before=ISO&limit=50 → página de mensajes (del más antiguo al más nuevo),
// con el estado de cada encuesta ya calculado.
export const GET = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { groupId } = await params;
  await assertGroup(pool, me.playerId, groupId);
  const url = new URL(req.url);
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 50));
  const before = url.searchParams.get('before');
  if (before && Number.isNaN(new Date(before).getTime())) throw new HttpError(400, 'before no es una fecha válida');

  const { rows } = await pool.query(
    `${MSG_SELECT}
      WHERE c.group_id = $1 AND ($2::timestamptz IS NULL OR c.created_at < $2)
      ORDER BY c.created_at DESC
      LIMIT $3`,
    [groupId, before, limit + 1]
  );
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  const polls = await loadPolls(pool, [...new Set(page.filter((m) => m.pollId).map((m) => m.pollId as string))], me.playerId);
  return Response.json({ messages: page.map((m) => (m.pollId ? { ...m, poll: polls.get(m.pollId) ?? null } : m)), hasMore });
});

// Enviar mensaje de texto. Body: { content }
export const POST = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { groupId } = await params;
  await assertGroup(pool, me.playerId, groupId);
  const { content } = await readBody(req);
  if (typeof content !== 'string' || !content.trim()) throw new HttpError(400, 'El mensaje está vacío');
  if (content.length > 2000) throw new HttpError(400, 'El mensaje es demasiado largo (máx. 2000)');
  const ins = await pool.query(
    `INSERT INTO chat_messages (group_id, player_id, type, content) VALUES ($1, $2, 'text', $3) RETURNING id`,
    [groupId, me.playerId, content.trim()]
  );
  // Quien escribe ya lo ha leído todo
  await pool.query('UPDATE group_players SET last_read_chat_at = now() WHERE group_id = $1 AND player_id = $2', [groupId, me.playerId]);
  const { rows } = await pool.query(`${MSG_SELECT} WHERE c.id = $1`, [ins.rows[0].id]);
  // Push al resto (los mensajes de chat no van a la campana: se cuentan con el badge de no leídos)
  const g = await pool.query('SELECT name FROM groups WHERE id = $1', [groupId]);
  await notify(pool, {
    groupId, type: 'chat', recipients: 'members', exclude: me.playerId,
    title: `${me.name} · ${g.rows[0]?.name ?? 'Chat'}`, body: content.trim().slice(0, 140),
  });
  return Response.json(rows[0], { status: 201 });
});
