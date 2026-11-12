import { pool } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup } from '@/lib/queries';

// Regenera el enlace de invitación (el anterior deja de funcionar).
// Body: { expiresInDays?: 1..30 | null }   (null o ausente = no caduca)
export const POST = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { groupId } = await params;
  await assertGroup(pool, me.playerId, groupId, 'manager');
  const b = await readBody(req).catch(() => ({}));
  const days = b?.expiresInDays == null ? null : Number(b.expiresInDays);
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 30)) throw new HttpError(400, 'expiresInDays debe estar entre 1 y 30');

  const { rows } = await pool.query(
    `UPDATE groups SET invite_token = gen_random_uuid(),
            invite_expires_at = CASE WHEN $2::int IS NULL THEN NULL ELSE now() + make_interval(days => $2::int) END
      WHERE id = $1
      RETURNING invite_token AS "token", invite_expires_at AS "expiresAt"`,
    [groupId, days]
  );
  const origin = new URL(req.url).origin;
  return Response.json({ url: `${origin}/join/${rows[0].token}`, expiresAt: rows[0].expiresAt });
});
