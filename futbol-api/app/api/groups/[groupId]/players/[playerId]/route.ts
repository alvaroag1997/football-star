import { pool, tx } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup, assertUuid, deactivateOrphans, parsePos } from '@/lib/queries';

// Editar un jugador (admin o co-admin): estrellas (en este grupo), apodo y posición.
// El nombre solo se puede cambiar en jugadores manuales: los que tienen cuenta lo cambian en su perfil.
// Los partidos pasados NO cambian: guardan su snapshot.
export const PATCH = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { groupId, playerId } = await params;
  const b = await readBody(req);

  await tx(async (c) => {
    await assertGroup(c, me.playerId, groupId, 'manager');
    const gp = await c.query(
      `SELECT (p.auth_user_id IS NOT NULL) AS "hasAccount"
         FROM group_players gp JOIN players p ON p.id = gp.player_id
        WHERE gp.group_id = $1 AND gp.player_id = $2 AND gp.is_active`,
      [groupId, assertUuid(playerId, 'playerId')]
    );
    if (!gp.rowCount) throw new HttpError(404, 'Jugador no encontrado en el grupo');
    const hasAccount: boolean = gp.rows[0].hasAccount;

    if (b.stars !== undefined) {
      const stars = Number(b.stars);
      if (!Number.isFinite(stars) || stars < 0 || stars > 10) throw new HttpError(400, 'stars debe estar entre 0 y 10');
      await c.query('UPDATE group_players SET stars = $3 WHERE group_id = $1 AND player_id = $2', [groupId, playerId, stars]);
    }
    if (b.name !== undefined || b.nick !== undefined || b.pos !== undefined) {
      if (b.name !== undefined && (typeof b.name !== 'string' || !b.name.trim())) throw new HttpError(400, 'name no puede estar vacío');
      const name = b.name === undefined || hasAccount ? null : b.name.trim(); // con cuenta: el nombre es suyo
      const nick = b.nick === undefined ? undefined : typeof b.nick === 'string' && b.nick.trim() ? b.nick.trim() : null;
      await c.query(
        `UPDATE players SET
           name = COALESCE($2, name),
           nick = CASE WHEN $3::boolean THEN $4 ELSE nick END,
           pos  = COALESCE($5, pos)
         WHERE id = $1`,
        [playerId, name, nick !== undefined, nick ?? null, b.pos === undefined ? null : parsePos(b.pos)]
      );
    }
  });
  return Response.json({ ok: true });
});

/**
 * Quitar del grupo (soft delete: el historial lo conserva gracias a los snapshots).
 *  - cualquiera puede salir de un grupo (menos el creador)
 *  - owner: puede quitar a cualquiera · co_admin: solo a miembros normales
 *  - ?everywhere=true: desactiva a un jugador MANUAL en todos los grupos que gestionas
 * Después, si un jugador manual se queda sin ningún grupo activo, se desactiva (no sale
 * más en "Añadir jugador de otro grupo").
 */
export const DELETE = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { groupId, playerId } = await params;
  const everywhere = new URL(req.url).searchParams.get('everywhere') === 'true';

  await tx(async (c) => {
    const g = await assertGroup(c, me.playerId, groupId);
    const t = await c.query(
      `SELECT gp.role, (p.auth_user_id IS NOT NULL) AS "hasAccount"
         FROM group_players gp JOIN players p ON p.id = gp.player_id
        WHERE gp.group_id = $1 AND gp.player_id = $2 AND gp.is_active`,
      [groupId, assertUuid(playerId, 'playerId')]
    );
    if (!t.rowCount) throw new HttpError(404, 'Jugador no encontrado en el grupo');
    const target = t.rows[0] as { role: string; hasAccount: boolean };
    const self = playerId === me.playerId;

    if (target.role === 'owner') throw new HttpError(400, 'El creador no puede salir del grupo. Si quieres, elimina el grupo.');
    if (!self) {
      if (g.role === 'member') throw new HttpError(403, 'No tienes permisos para quitar jugadores');
      if (g.role === 'co_admin' && target.role !== 'member') throw new HttpError(403, 'Un co-admin no puede quitar a otro co-admin');
    }

    if (everywhere && !self) {
      if (target.hasAccount) throw new HttpError(400, 'Un jugador con cuenta solo se puede quitar grupo a grupo');
      const notMine = await c.query(
        `SELECT 1 FROM group_players gp
          WHERE gp.player_id = $1 AND gp.is_active
            AND NOT EXISTS (SELECT 1 FROM group_players m
                             WHERE m.group_id = gp.group_id AND m.player_id = $2 AND m.is_active
                               AND m.role IN ('owner', 'co_admin'))`,
        [playerId, me.playerId]
      );
      if (notMine.rowCount) throw new HttpError(403, 'Ese jugador está en grupos que no gestionas: quítalo solo de este');
      await c.query('UPDATE group_players SET is_active = FALSE, left_at = now(), role = \'member\' WHERE player_id = $1 AND is_active', [playerId]);
    } else {
      await c.query(
        `UPDATE group_players SET is_active = FALSE, left_at = now(), role = 'member'
          WHERE group_id = $1 AND player_id = $2`,
        [groupId, playerId]
      );
    }
    await deactivateOrphans(c, [playerId]);
  });
  return Response.json({ ok: true });
});
