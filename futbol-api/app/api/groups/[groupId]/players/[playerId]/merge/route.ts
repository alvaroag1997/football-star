import { tx } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup, assertUuid } from '@/lib/queries';

/**
 * "Es la misma persona": une un jugador MANUAL (sin cuenta) con un miembro que sí tiene cuenta.
 * La cuenta hereda su historial, sus grupos con sus estrellas y sus votos; el manual se desactiva.
 * Útil cuando alguien que ya estaba en la plantilla se registra con el enlace de invitación,
 * y para el propio admin de la v1.2 la primera vez que inicia sesión.
 * Body: { intoPlayerId }
 */
export const POST = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { groupId, playerId } = await params;
  const { intoPlayerId } = await readBody(req);

  await tx(async (c) => {
    await assertGroup(c, me.playerId, groupId, 'manager');
    const from = assertUuid(playerId, 'playerId');
    const into = assertUuid(intoPlayerId, 'intoPlayerId');

    const rows = await c.query(
      `SELECT p.id, (p.auth_user_id IS NOT NULL) AS "hasAccount"
         FROM group_players gp JOIN players p ON p.id = gp.player_id
        WHERE gp.group_id = $1 AND gp.is_active AND p.id = ANY($2::uuid[])`,
      [groupId, [from, into]]
    );
    const f = rows.rows.find((r) => r.id === from);
    const i = rows.rows.find((r) => r.id === into);
    if (!f || !i) throw new HttpError(404, 'Los dos jugadores tienen que estar en este grupo');
    if (f.hasAccount) throw new HttpError(400, 'Solo se puede unir un jugador sin cuenta');
    if (!i.hasAccount) throw new HttpError(400, 'El destino tiene que ser un jugador con cuenta');

    // Hay que gestionar todos los grupos activos del jugador manual
    const notMine = await c.query(
      `SELECT 1 FROM group_players gp
        WHERE gp.player_id = $1 AND gp.is_active
          AND NOT EXISTS (SELECT 1 FROM group_players m
                           WHERE m.group_id = gp.group_id AND m.player_id = $2 AND m.is_active
                             AND m.role IN ('owner', 'co_admin'))`,
      [from, me.playerId]
    );
    if (notMine.rowCount) throw new HttpError(403, 'Ese jugador está en grupos que no gestionas');

    await c.query('SELECT merge_players($1, $2)', [from, into]);
  });
  return Response.json({ ok: true });
});
