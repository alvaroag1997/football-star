import { HttpError } from './http';
import { evaluateSplit } from './teamBalancer';

export type Db = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export type Pos = 'GK' | 'DEF' | 'ATT';
export type Convocado = { id: string; name: string; photo: string | null; stars: number; pos: Pos; nick: string | null };

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
    `SELECT p.id, p.name, p.photo_url AS photo, p.pos, p.nick, gp.stars::float8 AS stars
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
