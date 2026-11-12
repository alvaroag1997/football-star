import { pool } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { parsePos } from '@/lib/queries';

const COLS = `id, name, nick, pos, level::float8 AS level, email, photo_url AS "photoUrl"`;

// Perfil público del usuario autenticado (nombre, apodo, posición preferida, nivel).
export const GET = handle(async (req) => {
  const me = await requireUser(req);
  const { rows } = await pool.query(`SELECT ${COLS} FROM players WHERE id = $1`, [me.playerId]);
  return Response.json(rows[0]);
});

// Body: { name?, nick?, pos?, level? (1-5) }
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
  const nick = b.nick === undefined ? undefined : typeof b.nick === 'string' && b.nick.trim() ? b.nick.trim() : null;
  const { rows } = await pool.query(
    `UPDATE players SET
       name  = COALESCE($2, name),
       nick  = CASE WHEN $3::boolean THEN $4 ELSE nick END,
       pos   = COALESCE($5, pos),
       level = COALESCE($6, level)
     WHERE id = $1
     RETURNING ${COLS}`,
    [me.playerId, b.name === undefined ? null : b.name.trim(), nick !== undefined, nick ?? null,
     b.pos === undefined ? null : parsePos(b.pos), level]
  );
  return Response.json(rows[0]);
});
