import { pool, tx } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup, deactivateOrphans, isManager } from '@/lib/queries';

// Detalle del grupo. El enlace de invitación solo se devuelve al admin y a los co-admins.
export const GET = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { groupId } = await params;
  const g = await assertGroup(pool, me.playerId, groupId);
  const { rows } = await pool.query(
    `SELECT g.id, g.name, g.invite_token AS "inviteToken", g.invite_expires_at AS "inviteExpiresAt",
            (SELECT count(*) FROM group_players x WHERE x.group_id = g.id AND x.is_active)::int AS players
       FROM groups g WHERE g.id = $1`,
    [g.id]
  );
  const r = rows[0];
  const origin = new URL(req.url).origin;
  return Response.json({
    id: r.id, name: r.name, players: r.players, role: g.role,
    invite: isManager(g.role) ? { url: `${origin}/join/${r.inviteToken}`, expiresAt: r.inviteExpiresAt } : null,
  });
});

// Renombrar (admin o co-admin). Body: { name }
export const PATCH = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { groupId } = await params;
  await assertGroup(pool, me.playerId, groupId, 'manager');
  const { name } = await readBody(req);
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) throw new HttpError(400, 'Nombre no válido');
  await pool.query('UPDATE groups SET name = $2 WHERE id = $1', [groupId, name.trim()]);
  return Response.json({ id: groupId, name: name.trim() });
});

// ELIMINAR GRUPO (solo el creador). Borrado físico en cascada: miembros, partidos (con su
// historial), encuestas, votos y chat. Los jugadores manuales que se quedan sin grupo se desactivan.
export const DELETE = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { groupId } = await params;
  const out = await tx(async (c) => {
    await assertGroup(c, me.playerId, groupId, 'owner');
    const members = await c.query('SELECT player_id FROM group_players WHERE group_id = $1', [groupId]);
    await c.query('DELETE FROM groups WHERE id = $1', [groupId]);
    const orphans = await deactivateOrphans(c, members.rows.map((r) => r.player_id));
    return { deleted: true, orphansDeactivated: orphans };
  });
  return Response.json(out);
});
