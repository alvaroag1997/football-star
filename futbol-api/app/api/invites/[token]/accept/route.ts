import { tx } from '@/lib/db';
import { handle, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertUuid, systemMessage } from '@/lib/queries';

// Unirse a un grupo con el enlace de invitación (requiere sesión).
export const POST = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { token } = await params;
  const out = await tx(async (c) => {
    const g = await c.query(
      `SELECT id, name, (invite_expires_at IS NOT NULL AND invite_expires_at < now()) AS expired
         FROM groups WHERE invite_token = $1 AND is_active`,
      [assertUuid(token, 'token')]
    );
    if (!g.rows.length) throw new HttpError(404, 'Este enlace de invitación no es válido');
    const group = g.rows[0];
    if (group.expired) throw new HttpError(410, 'Este enlace ha caducado. Pide uno nuevo al admin del grupo.');

    const existing = await c.query(
      'SELECT is_active FROM group_players WHERE group_id = $1 AND player_id = $2',
      [group.id, me.playerId]
    );
    if (existing.rows[0]?.is_active) return { groupId: group.id, alreadyMember: true };

    // Estrellas iniciales = nivel que el jugador declara en su perfil (el admin puede cambiarlas).
    await c.query(
      `INSERT INTO group_players (group_id, player_id, stars, role)
       SELECT $1, id, level, 'member' FROM players WHERE id = $2
       ON CONFLICT (group_id, player_id) DO UPDATE SET is_active = TRUE, left_at = NULL`,
      [group.id, me.playerId]
    );
    await c.query('UPDATE players SET is_active = TRUE, deleted_at = NULL WHERE id = $1', [me.playerId]);
    await systemMessage(c, group.id, `👋 ${me.name} se ha unido al grupo`, { event: 'member_joined', playerId: me.playerId });
    return { groupId: group.id, alreadyMember: false };
  });
  return Response.json(out, { status: out.alreadyMember ? 200 : 201 });
});
