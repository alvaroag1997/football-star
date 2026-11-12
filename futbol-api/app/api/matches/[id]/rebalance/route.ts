import { pool } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { assertUuid, parsePos, startersFor } from '@/lib/queries';
import { balanceTeams } from '@/lib/teamBalancer';

/**
 * "Re-equilibrar equipos" del editor de partido: calcula un reparto equilibrado de la
 * convocatoria que el admin está editando (con invitados y estrellas ajustadas) SIN guardar.
 * Body: { format, roster: [{ key, stars, pos }] }   ->   { assignment: [{ key, team, isStarter }] }
 */
export const POST = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { id } = await params;
  const ok = await pool.query(
    `SELECT 1 FROM matches m
       JOIN group_players gp ON gp.group_id = m.group_id AND gp.player_id = $2 AND gp.is_active
                            AND gp.role IN ('owner', 'co_admin')
      WHERE m.id = $1`,
    [assertUuid(id), me.playerId]
  );
  if (!ok.rowCount) throw new HttpError(403, 'Solo el admin o los co-admins del grupo pueden hacer esto');

  const b = await readBody(req);
  const startersPerSide = startersFor(b.format);
  if (!Array.isArray(b.roster) || b.roster.length < 2) throw new HttpError(400, 'Hacen falta al menos 2 jugadores');
  const players = b.roster.map((r: any) => {
    const stars = Number(r?.stars);
    if (typeof r?.key !== 'string' || !Number.isFinite(stars)) throw new HttpError(400, 'roster no es válido');
    return { id: r.key, name: r.key, stars, pos: parsePos(r.pos) };
  });
  const res = balanceTeams(players, { startersPerSide, tolerance: 0.5 });
  const assignment: { key: string; team: 'A' | 'B'; isStarter: boolean }[] = [];
  const add = (team: 'A' | 'B', list: { id: string }[], isStarter: boolean) =>
    list.forEach((p) => assignment.push({ key: p.id, team, isStarter }));
  add('A', res.teamA.starters, true);
  add('A', res.teamA.bench, false);
  add('B', res.teamB.starters, true);
  add('B', res.teamB.bench, false);
  return Response.json({ assignment });
});
