import { pool } from '@/lib/db';
import { handle, readBody } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup } from '@/lib/queries';

// Marca como vistos los partidos nuevos o modificados (quita el aviso de la pestaña Partidos).
// Body opcional: { groupId } — sin él, en todos tus grupos.
export const POST = handle(async (req) => {
  const me = await requireUser(req);
  const b = await readBody(req).catch(() => ({}));
  if (b?.groupId) await assertGroup(pool, me.playerId, b.groupId);
  await pool.query(
    `UPDATE group_players SET last_seen_matches_at = now()
      WHERE player_id = $1 AND is_active AND ($2::uuid IS NULL OR group_id = $2)`,
    [me.playerId, b?.groupId ?? null]
  );
  return Response.json({ ok: true });
});
