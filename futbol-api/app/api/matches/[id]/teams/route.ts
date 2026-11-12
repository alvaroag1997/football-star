import { pool, tx } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { loadDetail, loadEntries, lockPending, saveSplit } from '@/lib/matches';

// Mover jugadores entre equipos (arrastrar, botón de intercambio) mientras el partido está pendiente.
// Body: { A: string[], B: string[] }  ->  ids de la convocatoria (entryId), repartidos entre A y B.
// El servidor recalcula titulares/suplentes y las estadísticas de equilibrio.
export const PATCH = handle(async (req, { params }) => {
  const me = await requireUser(req);
  const { id } = await params;
  const b = await readBody(req);
  if (!Array.isArray(b.A) || !Array.isArray(b.B)) throw new HttpError(400, 'A y B deben ser listas');

  await tx(async (c) => {
    const m = await lockPending(c, me.playerId, id);
    const entries = await loadEntries(c, id);
    const byId = new Map(entries.map((e) => [e.id, e]));
    const pick = (ids: unknown[]) =>
      ids.map((x) => {
        const e = typeof x === 'string' ? byId.get(x) : undefined;
        if (!e) throw new HttpError(400, 'Hay jugadores que no pertenecen a este partido');
        return e;
      });
    const A = pick(b.A);
    const B = pick(b.B);
    if (new Set([...A, ...B].map((e) => e.id)).size !== entries.length || A.length + B.length !== entries.length) {
      throw new HttpError(400, 'El reparto debe incluir exactamente a todos los convocados');
    }
    if (!A.length || !B.length) throw new HttpError(400, 'Cada equipo necesita al menos un jugador');
    await saveSplit(c, id, A, B, m.startersPerSide);
  });
  return Response.json(await loadDetail(pool, me.playerId, id));
});
