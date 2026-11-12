import { HttpError } from './http';
import { evaluateSplit } from './teamBalancer';

export type Db = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export type Pos = 'GK' | 'DEF' | 'ATT';
export type Convocado = {
  id: string; name: string; photo: string | null; stars: number; pos: Pos; nick: string | null; isGuest?: boolean;
};
export type GuestInput = { name: string; stars: number; pos: Pos };

/** Mínimo de jugadores (convocados + invitados) para crear un partido: 5 contra 5. */
export const MIN_PLAYERS = 10;

/** Valida un invitado externo { name, stars?, pos? }. Estrellas 1-5 (por defecto 3). */
export function parseGuest(v: any): GuestInput {
  const name = typeof v?.name === 'string' ? v.name.trim() : '';
  if (!name || name.length > 60) throw new HttpError(400, 'El invitado necesita un nombre (máx. 60 caracteres)');
  const stars = v?.stars === undefined || v?.stars === null ? 3 : Number(v.stars);
  if (!Number.isFinite(stars) || stars < 1 || stars > 5) throw new HttpError(400, 'Las estrellas del invitado van de 1 a 5');
  return { name, stars: Math.round(stars * 2) / 2, pos: parsePos(v?.pos) };
}

/** Id temporal de un invitado dentro del algoritmo de reparto (en BD se guarda con player_id NULL). */
export const guestKey = (i: number) => `guest:${i}`;
export const isGuestKey = (id: string) => id.startsWith('guest:');

const STARTERS: Record<string, number> = { '5v5': 5, '7v7': 7, '11v11': 11 };

export function startersFor(format: unknown): number {
  const n = typeof format === 'string' ? STARTERS[format] : undefined;
  if (!n) throw new HttpError(400, "format debe ser '5v5', '7v7' u '11v11'");
  return n;
}

export function parsePos(v: unknown): Pos {
  if (v === undefined || v === null || v === '') return 'DEF';
  if (v === 'GK' || v === 'DEF' || v === 'ATT') return v;
  throw new HttpError(400, "pos debe ser 'GK', 'DEF' o 'ATT'");
}

export type Role = 'owner' | 'co_admin' | 'member';
export type Need = 'member' | 'manager' | 'owner';
export const isManager = (r: Role) => r === 'owner' || r === 'co_admin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function assertUuid(v: unknown, what = 'id'): string {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw new HttpError(400, `${what} no es válido`);
  return v;
}

/**
 * Comprueba que el grupo existe, que el usuario es miembro activo y que tiene el rol pedido:
 *  - member:  cualquier miembro
 *  - manager: owner o co_admin (crear partidos, gestionar plantilla, invitación)
 *  - owner:   solo el creador (borrar grupo, nombrar co-admins)
 */
export async function assertGroup(db: Db, playerId: string, groupId: unknown, need: Need = 'member') {
  const id = assertUuid(groupId, 'groupId');
  const { rows } = await db.query(
    `SELECT g.id, g.name, gp.role
       FROM groups g
       JOIN group_players gp ON gp.group_id = g.id AND gp.player_id = $2 AND gp.is_active
      WHERE g.id = $1 AND g.is_active`,
    [id, playerId]
  );
  if (!rows.length) throw new HttpError(404, 'Grupo no encontrado o no perteneces a él');
  const g = rows[0] as { id: string; name: string; role: Role };
  if (need === 'manager' && !isManager(g.role)) throw new HttpError(403, 'Solo el admin o los co-admins del grupo pueden hacer esto');
  if (need === 'owner' && g.role !== 'owner') throw new HttpError(403, 'Solo el creador del grupo puede hacer esto');
  return g;
}

/** Desactiva a los jugadores manuales que se hayan quedado sin ningún grupo (bug de huérfanos). */
export async function deactivateOrphans(db: Db, playerIds: string[]) {
  if (!playerIds.length) return 0;
  const r = await db.query('SELECT deactivate_orphans($1::uuid[]) AS n', [playerIds]);
  return Number(r.rows[0]?.n ?? 0);
}

/**
 * Evita confusiones en las convocatorias: dentro de un mismo grupo no puede haber dos miembros
 * con el mismo nombre visible ("Carlos M.", "Carlos 'El Mago'"). Se llama DESPUÉS de escribir
 * (dentro de la transacción), así display_name ya está recalculado y si falla se deshace todo.
 */
export async function assertUniqueNames(db: Db, playerId: string, groupId?: string) {
  const r = await db.query(
    `SELECT g.name AS "group", p.display_name AS "display"
       FROM group_players me
       JOIN players mp ON mp.id = me.player_id
       JOIN groups g ON g.id = me.group_id AND g.is_active
       JOIN group_players o ON o.group_id = me.group_id AND o.is_active AND o.player_id <> me.player_id
       JOIN players p ON p.id = o.player_id AND p.is_active
      WHERE me.player_id = $1 AND me.is_active AND ($2::uuid IS NULL OR me.group_id = $2)
        AND lower(p.display_name) = lower(mp.display_name)
      LIMIT 1`,
    [playerId, groupId ?? null]
  );
  if (r.rowCount) {
    throw new HttpError(409, `Ya hay un “${r.rows[0].display}” en ${r.rows[0].group}. Usa otro apodo o apellido para distinguiros.`);
  }
}

/**
 * Valida una URL de foto subida a Supabase Storage (bucket público "avatars") dentro de la carpeta
 * permitida: users/<id de la cuenta>/ o groups/<id del grupo>/. null = quitar la foto.
 */
export function storageUrl(v: unknown, folder: string): string | null {
  if (v === null || v === '') return null;
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
  const prefix = `${base}/storage/v1/object/public/avatars/${folder}/`;
  if (typeof v !== 'string' || !base || !v.startsWith(prefix) || v.length > 500) {
    throw new HttpError(400, 'La foto no es válida');
  }
  return v;
}

/** Mensaje automático del sistema en el chat del grupo. */
export async function systemMessage(db: Db, groupId: string, content: string, metadata: Record<string, unknown> = {}) {
  await db.query(
    `INSERT INTO chat_messages (group_id, type, content, metadata) VALUES ($1, 'system', $2, $3)`,
    [groupId, content, JSON.stringify(metadata)]
  );
}

/**
 * Carga los convocados SOLO desde el grupo elegido (aislamiento por grupo).
 * Las estrellas, la posición y el apodo salen de este instante: es lo que se congela en el snapshot.
 */
export async function loadConvocados(db: Db, groupId: string, playerIds: unknown): Promise<Convocado[]> {
  if (!Array.isArray(playerIds) || playerIds.length < 2) {
    throw new HttpError(400, 'Convoca al menos 2 jugadores');
  }
  const unique = [...new Set(playerIds as string[])];
  if (unique.length !== playerIds.length) throw new HttpError(400, 'Hay jugadores duplicados');

  const { rows } = await db.query(
    `SELECT p.id, p.display_name AS name, p.photo_url AS photo, p.pos, p.nick, gp.stars::float8 AS stars
       FROM group_players gp
       JOIN players p ON p.id = gp.player_id
      WHERE gp.group_id = $1 AND gp.is_active AND p.is_active
        AND p.id = ANY($2::uuid[])`,
    [groupId, unique]
  );
  if (rows.length !== unique.length) {
    throw new HttpError(400, 'Algún jugador no pertenece a este grupo o está inactivo');
  }
  return rows as Convocado[];
}

/** Permite guardar exactamente el reparto que el admin vio en la previsualización. */
export function fromAssignment(
  players: Convocado[],
  assignment: { A?: string[]; B?: string[] },
  startersPerSide: number
) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const pick = (ids: string[] = []) =>
    ids.map((id) => {
      const p = byId.get(id);
      if (!p) throw new HttpError(400, 'assignment incluye jugadores que no están convocados');
      return p;
    });
  const A = pick(assignment.A);
  const B = pick(assignment.B);
  const all = new Set([...A, ...B].map((p) => p.id));
  if (!A.length || !B.length || all.size !== players.length || A.length + B.length !== players.length) {
    throw new HttpError(400, 'assignment debe repartir exactamente a los convocados entre A y B');
  }
  return evaluateSplit(A, B, startersPerSide);
}

/** Pasa a "finished" los partidos vencidos (idempotente). */
export async function finishDueMatches(db: Db) {
  await db.query('SELECT 1 FROM finish_due_matches()');
}
