import { pool } from '@/lib/db';
import { handle } from '@/lib/http';
import { requireUser } from '@/lib/auth';

// Campana in-app: últimos avisos del usuario (nuevas encuestas, partidos nuevos y cambios en partidos).
// GET ?limit=30  ->  { items: [...], unread }
export const GET = handle(async (req) => {
  const me = await requireUser(req);
  const limit = Math.min(100, Math.max(1, Number(new URL(req.url).searchParams.get('limit')) || 30));
  const [items, unread] = await Promise.all([
    pool.query(
      `SELECT n.id, n.group_id AS "groupId", g.name AS "groupName", n.type, n.title, n.body, n.data,
              n.read_at AS "readAt", n.created_at AS "createdAt"
         FROM notifications n LEFT JOIN groups g ON g.id = n.group_id
        WHERE n.player_id = $1
        ORDER BY n.created_at DESC
        LIMIT $2`,
      [me.playerId, limit]
    ),
    pool.query('SELECT count(*)::int AS n FROM notifications WHERE player_id = $1 AND read_at IS NULL', [me.playerId]),
  ]);
  return Response.json({ items: items.rows, unread: unread.rows[0].n });
});
