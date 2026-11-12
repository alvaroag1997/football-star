import { pool } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';

// Marcar avisos como leídos. Body: { all: true } ("Marcar todas como leídas") o { ids: string[] }
export const POST = handle(async (req) => {
  const me = await requireUser(req);
  const b = await readBody(req);
  if (b.all === true) {
    await pool.query('UPDATE notifications SET read_at = now() WHERE player_id = $1 AND read_at IS NULL', [me.playerId]);
  } else if (Array.isArray(b.ids) && b.ids.length) {
    await pool.query(
      'UPDATE notifications SET read_at = now() WHERE player_id = $1 AND read_at IS NULL AND id = ANY($2::uuid[])',
      [me.playerId, b.ids]
    );
  } else {
    throw new HttpError(400, 'Envía { all: true } o { ids: [...] }');
  }
  return Response.json({ ok: true });
});
