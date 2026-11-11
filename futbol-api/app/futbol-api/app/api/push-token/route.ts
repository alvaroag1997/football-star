import { pool } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireAdmin } from '@/lib/auth';

// La app registra aquí el token push del dispositivo del admin.
// Body: { token: string }
export const POST = handle(async (req) => {
  const adminId = requireAdmin(req);
  const { token } = await readBody(req);
  if (typeof token !== 'string' || token.length < 10) throw new HttpError(400, 'token inválido');
  await pool.query('UPDATE admins SET push_token = $2 WHERE id = $1', [adminId, token]);
  return Response.json({ ok: true });
});
