import { pool, tx } from '@/lib/db';
import { handle } from '@/lib/http';
import { requireAdmin } from '@/lib/auth';
import { loadDetail, loadEntries, lockPending, saveSplit } from '@/lib/matches';
import { balanceTeams } from '@/lib/teamBalancer';

// "Regenerar": nuevo reparto equilibrado con los mismos convocados (usa los datos congelados del snapshot).
export const POST = handle(async (req, { params }) => {
  const adminId = requireAdmin(req);
  const { id } = await params;

  await tx(async (c) => {
    const m = await lockPending(c, adminId, id);
    const entries = await loadEntries(c, id);
    const players = entries.map((e) => ({ id: e.id, name: e.name, stars: e.stars, pos: e.pos, photo: e.photo, nick: e.nick }));
    const key = (ids: string[]) => [...ids].sort().join(',');
    const curA = key(entries.filter((e) => e.team === 'A').map((e) => e.id));
    const curB = key(entries.filter((e) => e.team === 'B').map((e) => e.id));

    // Hasta 20 intentos para obtener un reparto distinto del actual (tolerancia de media estrella).
    let split = balanceTeams(players, { startersPerSide: m.startersPerSide, tolerance: 0.5 });
    for (let i = 0; i < 20; i++) {
      const k = key([...split.teamA.starters, ...split.teamA.bench].map((p: { id: string }) => p.id));
      if (k !== curA && k !== curB) break;
      split = balanceTeams(players, { startersPerSide: m.startersPerSide, tolerance: 0.5 });
    }
    const byId = new Map(entries.map((e) => [e.id, e]));
    const side = (t: { starters: { id: string }[]; bench: { id: string }[] }) =>
      [...t.starters, ...t.bench].map((p) => byId.get(p.id)!);
    await saveSplit(c, id, side(split.teamA), side(split.teamB), m.startersPerSide);
  });
  return Response.json(await loadDetail(pool, adminId, id));
});
