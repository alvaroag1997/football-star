import { pool } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup } from '@/lib/queries';

// Marca como leído el chat del grupo o como vistos sus partidos (pone el badge a 0 en todos tus dispositivos).
// Body: { what: 'chat' | 'matches' }
export const POST = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { groupId } = await params;
  await assertGroup(pool, me.playerId, groupId);
  const { what } = await readBody(req);
  const col = what === 'chat' ? 'last_read_chat_at' : what === 'matches' ? 'last_seen_matches_at' : null;
  if (!col) throw new HttpError(400, "what debe ser 'chat' o 'matches'");
  await pool.query(`UPDATE group_players SET ${col} = now() WHERE group_id = $1 AND player_id = $2`, [groupId, me.playerId]);
  return Response.json({ ok: true });
});
