import { HttpError } from './http';
import type { Db } from './queries';
import { evaluateSplit } from './teamBalancer';

export type EntryRow = {
  id: string; playerId: string | null; name: string; nick: string | null; pos: string;
  stars: number; photo: string | null; team: 'A' | 'B'; isStarter: boolean;
};

/** Estadísticas del reparto que se guardan en matches.balance_stats (se muestran en la app). */
export function statsOf(result: any) {
  return {
    sumA: result.teamA.sum, sumB: result.teamB.sum,
    meanA: result.teamA.mean, meanB: result.teamB.mean,
    diffSum: result.stats.diffSum, diffMean: result.stats.diffMean,
    warnings: result.warnings as string[],
  };
}

/**
 * Detalle de un partido con su convocatoria, siempre desde los snapshots.
 * Solo para miembros del grupo. Las estrellas solo las ven el admin y los co-admins.
 */
export async function loadDetail(db: Db, playerId: string, id: string) {
  const m = await db.query(
    `SELECT m.id, m.group_id AS "groupId", g.name AS "groupName", m.scheduled_at AS "scheduledAt",
            m.location, m.format, m.starters_per_side AS "startersPerSide", m.status,
            m.score_a AS "scoreA", m.score_b AS "scoreB", m.mvp_entry_id AS "mvpEntryId",
            m.balance_stats AS "balanceStats",
            (m.status = 'finished' AND m.score_a IS NULL) AS "needsResult",
            gp.role, (gp.role IN ('owner', 'co_admin')) AS "canManage"
       FROM matches m
       JOIN groups g ON g.id = m.group_id
       JOIN group_players gp ON gp.group_id = g.id AND gp.player_id = $2 AND gp.is_active
      WHERE m.id = $1`,
    [id, playerId]
  );
  if (!m.rows.length) throw new HttpError(404, 'Partido no encontrado');
  const canManage: boolean = m.rows[0].canManage;
  const roster = await db.query(
    `SELECT id AS "entryId", player_id AS "playerId", name_snapshot AS name, nick_snapshot AS nick,
            pos_snapshot AS pos, stars_snapshot::float8 AS stars, photo_snapshot AS photo,
            team, is_starter AS "isStarter"
       FROM match_players WHERE match_id = $1
      ORDER BY team, is_starter DESC, stars_snapshot DESC`,
    [id]
  );
  if (!canManage) {
    // Los miembros ven equipos y posiciones, pero no las estrellas ni las sumas.
    return { ...m.rows[0], balanceStats: null, roster: roster.rows.map((r: any) => ({ ...r, stars: 0 })) };
  }
  return { ...m.rows[0], roster: roster.rows };
}

/** Bloquea un partido que todavía se puede modificar (pendiente, antes de su hora, y el usuario es admin/co-admin). */
export async function lockPending(db: Db, playerId: string, id: string) {
  const r = await db.query(
    `SELECT m.id, m.starters_per_side AS "startersPerSide"
       FROM matches m
       JOIN group_players gp ON gp.group_id = m.group_id AND gp.player_id = $2 AND gp.is_active
                            AND gp.role IN ('owner', 'co_admin')
      WHERE m.id = $1 AND m.status = 'pending' AND m.scheduled_at > now()
      FOR UPDATE OF m`,
    [id, playerId]
  );
  if (!r.rows.length) throw new HttpError(409, 'Solo se pueden modificar partidos pendientes que aún no han empezado');
  return r.rows[0] as { id: string; startersPerSide: number };
}

export async function loadEntries(db: Db, matchId: string): Promise<EntryRow[]> {
  const r = await db.query(
    `SELECT id, player_id AS "playerId", name_snapshot AS name, nick_snapshot AS nick, pos_snapshot AS pos,
            stars_snapshot::float8 AS stars, photo_snapshot AS photo, team, is_starter AS "isStarter"
       FROM match_players WHERE match_id = $1`,
    [matchId]
  );
  return r.rows as EntryRow[];
}

const asPlayer = (e: EntryRow) => ({ id: e.id, name: e.name, stars: e.stars, pos: e.pos, photo: e.photo, nick: e.nick });

/** Guarda un reparto A/B: recalcula titulares y suplentes y las estadísticas del partido. */
export async function saveSplit(db: Db, matchId: string, A: EntryRow[], B: EntryRow[], startersPerSide: number) {
  const res = evaluateSplit(A.map(asPlayer), B.map(asPlayer), startersPerSide);
  const ids: string[] = [];
  const teams: string[] = [];
  const starters: boolean[] = [];
  const add = (team: string, list: { id: string }[], isStarter: boolean) =>
    list.forEach((p) => { ids.push(p.id); teams.push(team); starters.push(isStarter); });
  add('A', res.teamA.starters, true);
  add('A', res.teamA.bench, false);
  add('B', res.teamB.starters, true);
  add('B', res.teamB.bench, false);

  await db.query(
    `UPDATE match_players mp SET team = v.team::team_side, is_starter = v.st
       FROM (SELECT unnest($2::uuid[]) AS id, unnest($3::text[]) AS team, unnest($4::boolean[]) AS st) v
      WHERE mp.id = v.id AND mp.match_id = $1`,
    [matchId, ids, teams, starters]
  );
  await db.query('UPDATE matches SET balance_stats = $2 WHERE id = $1', [matchId, JSON.stringify(statsOf(res))]);
}
