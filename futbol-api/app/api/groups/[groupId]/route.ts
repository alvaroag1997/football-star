import { pool, tx } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup, deactivateOrphans, isManager, storageUrl } from '@/lib/queries';

// Detalle del grupo. El enlace de invitación solo se devuelve al admin y a los co-admins.
export const GET = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { groupId } = await params;
  const g = await assertGroup(pool, me.playerId, groupId);
  const { rows } = await pool.query(
    `SELECT g.id, g.name, g.icon_url AS "iconUrl", g.invite_token AS "inviteToken", g.invite_expires_at AS "inviteExpiresAt",
            (SELECT count(*) FROM group_players x WHERE x.group_id = g.id AND x.is_active)::int AS players
       FROM groups g WHERE g.id = $1`,
    [g.id]
  );
  const r = rows[0];
  const origin = new URL(req.url).origin;
  return Response.json({
    id: r.id, name: r.name, iconUrl: r.iconUrl, players: r.players, role: g.role,
    invite: isManager(g.role) ? { url: `${origin}/join/${r.inviteToken}`, expiresAt: r.inviteExpiresAt } : null,
  });
});

// Renombrar o cambiar el escudo (admin o co-admin). Body: { name?, iconUrl? (Storage o null) }
export const PATCH = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { groupId } = await params;
  await assertGroup(pool, me.playerId, groupId, 'manager');
  const b = await readBody(req);
  if (b.name !== undefined && (typeof b.name !== 'string' || !b.name.trim() || b.name.trim().length > 60)) {
    throw new HttpError(400, 'Nombre no válido');
  }
  const icon = b.iconUrl === undefined ? undefined : storageUrl(b.iconUrl, `groups/${groupId}`);
  const { rows } = await pool.query(
    `UPDATE groups SET name = COALESCE($2, name), icon_url = CASE WHEN $3::boolean THEN $4 ELSE icon_url END
      WHERE id = $1 RETURNING id, name, icon_url AS "iconUrl"`,
    [groupId, b.name === undefined ? null : b.name.trim(), icon !== undefined, icon ?? null]
  );
  return Response.json(rows[0]);
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
