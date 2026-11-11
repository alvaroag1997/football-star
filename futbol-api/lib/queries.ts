import { HttpError } from './http';

export type Db = {
  query: (text: string, params?: any[]) => Promise<{ rows: any[]; rowCount: number | null }>;
};

export type Convocado = { id: string; name: string; photo: string | null; stars: number };

const STARTERS: Record<string, number> = { '5v5': 5, '7v7': 7, '11v11': 11 };

export function startersFor(format: unknown): number {
  const n = typeof format === 'string' ? STARTERS[format] : undefined;
  if (!n) throw new HttpError(400, "format debe ser '5v5', '7v7' u '11v11'");
  return n;
}

/** Comprueba que el grupo existe, está activo y pertenece al admin. */
export async function assertGroup(db: Db, adminId: string, groupId: unknown) {
  if (typeof groupId !== 'string') throw new HttpError(400, 'groupId es obligatorio');
  const { rows } = await db.query(
    'SELECT id, name FROM groups WHERE id = $1 AND admin_id = $2 AND is_active',
    [groupId, adminId]
  );
  if (!rows.length) throw new HttpError(404, 'Grupo no encontrado');
  return rows[0] as { id: string; name: string };
}

/**
 * Carga los convocados SOLO desde el grupo elegido (aislamiento por grupo).
 * Las estrellas salen de group_players en este instante: ese valor es el que
 * se congela en el snapshot del partido.
 */
export async function loadConvocados(db: Db, groupId: string, playerIds: unknown): Promise<Convocado[]> {
  if (!Array.isArray(playerIds) || playerIds.length < 2) {
    throw new HttpError(400, 'Convoca al menos 2 jugadores');
  }
  const unique = [...new Set(playerIds as string[])];
  if (unique.length !== playerIds.length) throw new HttpError(400, 'Hay jugadores duplicados');

  const { rows } = await db.query(
    `SELECT p.id, p.name, p.photo_url AS photo, gp.stars::float8 AS stars
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
  const build = (team: Convocado[]) => {
    const sorted = [...team].sort((x, y) => y.stars - x.stars);
    const sum = sorted.reduce((a, p) => a + p.stars, 0);
    return {
      starters: sorted.slice(0, startersPerSide),
      bench: sorted.slice(startersPerSide),
      sum,
      mean: sum / sorted.length,
    };
  };
  const teamA = build(A);
  const teamB = build(B);
  return {
    teamA,
    teamB,
    stats: {
      diffSum: Math.abs(teamA.sum - teamB.sum),
      diffMean: Math.abs(teamA.mean - teamB.mean),
      sizeA: A.length,
      sizeB: B.length,
    },
  };
}

/** Pasa a "finished" los partidos vencidos (idempotente). */
export async function finishDueMatches(db: Db) {
  await db.query('SELECT 1 FROM finish_due_matches()');
}
