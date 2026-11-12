import { pool, tx } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertGroup, assertUniqueNames, assertUuid, isManager, parsePos } from '@/lib/queries';

// Jugadores activos de UN grupo (con su rol). Las estrellas solo las ven admin y co-admins.
export const GET = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { groupId } = await params;
  const g = await assertGroup(pool, me.playerId, groupId);
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.nick, p.last_name AS "lastName", p.display_name AS "displayName",
            p.pos, p.photo_url AS "photoUrl", gp.stars::float8 AS stars,
            gp.role, (p.auth_user_id IS NOT NULL) AS "hasAccount"
       FROM group_players gp JOIN players p ON p.id = gp.player_id
      WHERE gp.group_id = $1 AND gp.is_active AND p.is_active
      ORDER BY p.display_name`,
    [groupId]
  );
  return Response.json(isManager(g.role) ? rows : rows.map((r) => ({ ...r, stars: 0 })));
});

// Añade un jugador al grupo (admin o co-admin):
//  - con "playerId": alguien activo de OTRO de tus grupos (ver GET /api/players?groupId=)
//  - sin él: crea un jugador manual, sin cuenta (name, nick?, pos?)
export const POST = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { groupId } = await params;
  const b = await readBody(req);
  const stars = Number(b.stars);
  if (!Number.isFinite(stars) || stars < 0 || stars > 10) throw new HttpError(400, 'stars debe estar entre 0 y 10');

  const out = await tx(async (c) => {
    await assertGroup(c, me.playerId, groupId, 'manager');
    let playerId: string;
    if (b.playerId) {
      playerId = assertUuid(b.playerId, 'playerId');
      // Solo jugadores ACTIVOS que estén activos en algún otro grupo tuyo (nada de huérfanos)
      const r = await c.query(
        `SELECT 1
           FROM group_players mine
           JOIN groups g ON g.id = mine.group_id AND g.is_active
           JOIN group_players gp ON gp.group_id = g.id AND gp.is_active AND gp.player_id = $2
           JOIN players p ON p.id = gp.player_id AND p.is_active
          WHERE mine.player_id = $1 AND mine.is_active
          LIMIT 1`,
        [me.playerId, playerId]
      );
      if (!r.rowCount) throw new HttpError(404, 'Ese jugador no está en ninguno de tus otros grupos');
    } else {
      if (typeof b.name !== 'string' || !b.name.trim()) throw new HttpError(400, 'name es obligatorio');
      const nick = typeof b.nick === 'string' && b.nick.trim() ? b.nick.trim() : null;
      const lastName = typeof b.lastName === 'string' && b.lastName.trim() ? b.lastName.trim() : null;
      const r = await c.query(
        'INSERT INTO players (name, nick, last_name, pos, photo_url, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
        [b.name.trim(), nick, lastName, parsePos(b.pos), b.photoUrl ?? null, me.playerId]
      );
      playerId = r.rows[0].id;
    }
    await c.query(
      `INSERT INTO group_players (group_id, player_id, stars) VALUES ($1, $2, $3)
       ON CONFLICT (group_id, player_id)
       DO UPDATE SET stars = EXCLUDED.stars, is_active = TRUE, left_at = NULL`,
      [groupId, playerId, stars]
    );
    await assertUniqueNames(c, playerId, groupId); // nada de dos "Carlos M." en el mismo grupo
    return { id: playerId, groupId, stars };
  });
  return Response.json(out, { status: 201 });
});
