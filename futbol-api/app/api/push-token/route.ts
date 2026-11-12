import { pool } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';

// La app registra aquí el token push del dispositivo del usuario.
// Body: { token: string }
export const POST = handle(async (req) => {
  const me = await requireUser(req);
  const { token } = await readBody(req);
  if (typeof token !== 'string' || token.length < 10) throw new HttpError(400, 'token inválido');
  await pool.query('UPDATE players SET push_token = $2 WHERE id = $1', [me.playerId, token]);
  return Response.json({ ok: true });
});
