import { pool, tx } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertUniqueNames, parsePos } from '@/lib/queries';

const COLS = `id, name, nick, last_name AS "lastName", display_name AS "displayName", pos,
              level::float8 AS level, email, photo_url AS "photoUrl",
              notify_chat AS "notifyChat", notify_polls AS "notifyPolls", notify_matches AS "notifyMatches"`;

// Perfil público del usuario autenticado (nombre, apodo/apellido, posición preferida, nivel).
export const GET = handle(async (req) => {
  const me = await requireUser(req);
  const { rows } = await pool.query(`SELECT ${COLS} FROM players WHERE id = $1`, [me.playerId]);
  return Response.json(rows[0]);
});

const optText = (v: unknown, what: string) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') throw new HttpError(400, `${what} no es válido`);
  const t = v.trim();
  if (t.length > 60) throw new HttpError(400, `${what} es demasiado largo`);
  return t || null;
};

// Body: { name?, nick?, lastName?, pos?, level? (1-5), notifyChat?, notifyPolls?, notifyMatches? }
// Obligatorio tener apodo O apellido, y el nombre visible no puede repetirse en tus grupos.
export const PATCH = handle(async (req) => {
  const me = await requireUser(req);
  const b = await readBody(req);
  if (b.name !== undefined && (typeof b.name !== 'string' || !b.name.trim() || b.name.length > 60)) {
    throw new HttpError(400, 'El nombre no puede estar vacío');
  }
  let level: number | null = null;
  if (b.level !== undefined) {
    level = Number(b.level);
    if (!Number.isFinite(level) || level < 1 || level > 5) throw new HttpError(400, 'El nivel debe estar entre 1 y 5');
  }
  const nick = optText(b.nick, 'El apodo');
  const flag = (v: unknown) => (typeof v === 'boolean' ? v : null);
  const lastName = optText(b.lastName, 'El apellido');

  const row = await tx(async (c) => {
    const { rows } = await c.query(
      `UPDATE players SET
         name      = COALESCE($2, name),
         nick      = CASE WHEN $3::boolean THEN $4 ELSE nick END,
         last_name = CASE WHEN $5::boolean THEN $6 ELSE last_name END,
         pos       = COALESCE($7, pos),
         level     = COALESCE($8, level),
         notify_chat    = COALESCE($9, notify_chat),
         notify_polls   = COALESCE($10, notify_polls),
         notify_matches = COALESCE($11, notify_matches)
       WHERE id = $1
       RETURNING ${COLS}`,
      [me.playerId, b.name === undefined ? null : b.name.trim(), nick !== undefined, nick ?? null,
       lastName !== undefined, lastName ?? null, b.pos === undefined ? null : parsePos(b.pos), level,
       flag(b.notifyChat), flag(b.notifyPolls), flag(b.notifyMatches)]
    );
    const p = rows[0];
    if (!p.nick && !p.lastName) throw new HttpError(400, 'Pon un apodo o un apellido para que te distingan en el grupo');
    await assertUniqueNames(c, me.playerId);
    return p;
  });
  return Response.json(row);
});
