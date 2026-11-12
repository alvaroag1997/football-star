import { pool } from '@/lib/db';
import { handle, HttpError } from '@/lib/http';
import { assertUuid } from '@/lib/queries';

// Vista previa PÚBLICA de una invitación (se ve antes de iniciar sesión).
export const GET = handle(async (_req, { params }) => {
  const { token } = await params;
  const { rows } = await pool.query(
    `SELECT g.name, (g.invite_expires_at IS NOT NULL AND g.invite_expires_at < now()) AS expired,
            (SELECT count(*) FROM group_players x WHERE x.group_id = g.id AND x.is_active)::int AS players
       FROM groups g WHERE g.invite_token = $1 AND g.is_active`,
    [assertUuid(token, 'token')]
  );
  if (!rows.length) throw new HttpError(404, 'Este enlace de invitación no es válido');
  return Response.json(rows[0]);
});
