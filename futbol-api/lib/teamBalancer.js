/**
 * teamBalancer.js — v1.3
 * Reparte N jugadores en Equipo A y Equipo B equilibrando estrellas.
 *  - Sin límite de plantilla: 14 jugadores en fútbol sala = 7v7 con 5 titulares + 2 suplentes por equipo.
 *  - El equilibrio se calcula sobre la PLANTILLA COMPLETA (titulares + suplentes): media y suma.
 *  - Porteros (pos === 'GK'): se reparten uno por equipo; el mejor portero de cada equipo es siempre titular.
 *  - Desempates: titulares parejos y mismo número de defensas/atacantes.
 *
 *   const { balanceTeams, evaluateSplit } = require('./teamBalancer');
 *   balanceTeams(players, { startersPerSide: 5 });                 // sorteo nuevo
 *   balanceTeams(players, { startersPerSide: 5, tolerance: 0.5 }); // otra variante casi igual de justa
 *   evaluateSplit(teamA, teamB, 5);                                // evalúa un reparto hecho a mano
 */

/**
 * @typedef {Object} Player
 * @property {string} id
 * @property {string} name
 * @property {number} stars
 * @property {string=} pos   'GK' | 'DEF' | 'ATT'
 * @property {(string|null)=} photo
 * @property {(string|null)=} nick
 */

const EXHAUSTIVE_LIMIT = 20; // hasta 20 jugadores se busca el óptimo exacto
const MAX_CANDIDATES = 500;
const EPS = 1e-9;

const isGK = (p) => p.pos === 'GK';

function sum(list) {
  let s = 0;
  for (const p of list) s += p.stars;
  return s;
}
function mean(list) {
  return list.length ? sum(list) / list.length : 0;
}
function countPos(list, pos) {
  let c = 0;
  for (const p of list) if (p.pos === pos) c++;
  return c;
}

/** Titulares = los mejores por estrellas, pero el mejor portero del equipo siempre juega de titular. */
function splitStartersAndBench(team, startersPerSide) {
  const sorted = [...team].sort((a, b) => b.stars - a.stars);
  const gkIdx = sorted.findIndex(isGK);
  if (gkIdx >= startersPerSide) {
    const keeper = sorted.splice(gkIdx, 1)[0];
    const starters = [...sorted.slice(0, startersPerSide - 1), keeper].sort((a, b) => b.stars - a.stars);
    return { starters, bench: sorted.slice(startersPerSide - 1) };
  }
  return { starters: sorted.slice(0, startersPerSide), bench: sorted.slice(startersPerSide) };
}

/** Penalización enorme si los porteros no quedan repartidos (uno por equipo). */
function gkPenalty(A, B) {
  const gA = countPos(A, 'GK');
  const gB = countPos(B, 'GK');
  const g = gA + gB;
  if (g < 2) return 0;
  const excess = Math.abs(gA - gB) - (g % 2);
  return excess > 0 ? excess * 1e6 : 0;
}

/**
 * Coste de una partición (menor = mejor).
 * 1) porteros repartidos  2) diferencia de MEDIA  3) diferencia de SUMA
 * 4) desempate: media de titulares y reparto de defensas/atacantes.
 */
function cost(A, B, startersPerSide) {
  const diffMean = Math.abs(mean(A) - mean(B));
  const diffSum = Math.abs(sum(A) - sum(B));
  const sA = splitStartersAndBench(A, startersPerSide).starters;
  const sB = splitStartersAndBench(B, startersPerSide).starters;
  const diffStarters = Math.abs(mean(sA) - mean(sB));
  const posDiff = Math.abs(countPos(A, 'ATT') - countPos(B, 'ATT')) + Math.abs(countPos(A, 'DEF') - countPos(B, 'DEF'));
  return gkPenalty(A, B) + diffMean * 1000 + diffSum * 10 + posDiff + diffStarters;
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Búsqueda exacta (N ≤ 20): prueba todas las combinaciones de tamaño ceil(N/2) para el equipo A.
 * tolStars = 0  → elige al azar entre las mejores.
 * tolStars > 0  → elige al azar entre todas las que quedan a ≤ tolStars estrellas del óptimo
 *                 (para "Regenerar" con variedad sin perder equilibrio).
 */
function exhaustiveSearch(players, sizeA, startersPerSide, rng, tolStars) {
  const list = shuffle(players, rng);
  const n = list.length;
  const stars = list.map((p) => p.stars);
  const gks = list.map((p) => (isGK(p) ? 1 : 0));
  const total = stars.reduce((a, b) => a + b, 0);
  const gkTotal = gks.reduce((a, b) => a + b, 0);
  const sizeB = n - sizeA;

  const gkOk = (gA) => gkTotal < 2 || Math.abs(gA - (gkTotal - gA)) <= gkTotal % 2;
  const primary = (sumA) => {
    const sumB = total - sumA;
    return Math.abs(sumA / sizeA - sumB / sizeB) * 1000 + Math.abs(sumA - sumB) * 10;
  };

  // Pasada 1: coste primario mínimo
  let best = Infinity;
  (function rec(start, count, acc, g) {
    if (count === sizeA) {
      if (gkOk(g)) {
        const c = primary(acc);
        if (c < best) best = c;
      }
      return;
    }
    for (let i = start; i <= n - (sizeA - count); i++) rec(i + 1, count + 1, acc + stars[i], g + gks[i]);
  })(0, 0, 0, 0);

  // Pasada 2: recoger combinaciones óptimas (o dentro de la tolerancia)
  const tol = tolStars > 0 ? tolStars * (1000 / sizeA + 10) : 0;
  const candidates = [];
  const chosen = [];
  (function rec(start, count, acc, g) {
    if (candidates.length >= MAX_CANDIDATES) return;
    if (count === sizeA) {
      if (gkOk(g) && primary(acc) <= best + tol + EPS) candidates.push([...chosen]);
      return;
    }
    for (let i = start; i <= n - (sizeA - count); i++) {
      chosen.push(i);
      rec(i + 1, count + 1, acc + stars[i], g + gks[i]);
      chosen.pop();
    }
  })(0, 0, 0, 0);

  const toTeams = (idxs) => {
    const set = new Set(idxs);
    return [list.filter((_, i) => set.has(i)), list.filter((_, i) => !set.has(i))];
  };

  if (tol > 0) return toTeams(candidates[Math.floor(rng() * candidates.length)]);

  let bestFine = Infinity;
  let pool = [];
  for (const idxs of candidates) {
    const [A, B] = toTeams(idxs);
    const c = cost(A, B, startersPerSide);
    if (c < bestFine - EPS) {
      bestFine = c;
      pool = [[A, B]];
    } else if (Math.abs(c - bestFine) <= EPS) {
      pool.push([A, B]);
    }
  }
  return pool[Math.floor(rng() * pool.length)];
}

/** Búsqueda heurística (N > 20): reinicios aleatorios + intercambios de pares hasta que nada mejora. */
function localSearch(players, sizeA, startersPerSide, rng, restarts = 40) {
  let bestPair = null;
  let bestCost = Infinity;
  for (let r = 0; r < restarts; r++) {
    const shuffled = shuffle(players, rng);
    let A = shuffled.slice(0, sizeA);
    let B = shuffled.slice(sizeA);
    let current = cost(A, B, startersPerSide);
    let improved = true;
    while (improved) {
      improved = false;
      for (let i = 0; i < A.length; i++) {
        for (let j = 0; j < B.length; j++) {
          const A2 = [...A];
          const B2 = [...B];
          [A2[i], B2[j]] = [B2[j], A2[i]];
          const c = cost(A2, B2, startersPerSide);
          if (c < current - EPS) {
            A = A2;
            B = B2;
            current = c;
            improved = true;
          }
        }
      }
    }
    if (current < bestCost - EPS) {
      bestCost = current;
      bestPair = [A, B];
    }
  }
  return bestPair;
}

function warningsFor(A, B) {
  const gA = countPos(A, 'GK');
  const gB = countPos(B, 'GK');
  const out = [];
  if (gA + gB === 0) out.push('No hay porteros en la convocatoria.');
  else {
    if (gA === 0) out.push('El Equipo A no tiene portero.');
    if (gB === 0) out.push('El Equipo B no tiene portero.');
  }
  return out;
}

/** Evalúa un reparto (hecho por el algoritmo o a mano): titulares, suplentes, sumas, medias y avisos. */
function evaluateSplit(A, B, startersPerSide) {
  const build = (team) => {
    const { starters, bench } = splitStartersAndBench(team, startersPerSide);
    return { starters, bench, sum: sum(team), mean: mean(team) };
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
    warnings: warningsFor(A, B),
  };
}

/**
 * @param {Player[]} players  Convocados (cualquier cantidad ≥ 2).
 * @param {Object} opts
 * @param {number} opts.startersPerSide  Titulares por equipo según modalidad (5, 7, 11).
 * @param {number=} opts.tolerance       Estrellas de margen sobre el reparto óptimo (para regenerar con variedad).
 * @param {() => number=} opts.rng       Generador aleatorio (inyectable para tests).
 */
function balanceTeams(players, { startersPerSide, tolerance = 0, rng = Math.random } = {}) {
  if (!Array.isArray(players) || players.length < 2) throw new Error('Se necesitan al menos 2 jugadores.');
  if (!Number.isInteger(startersPerSide) || startersPerSide < 1) throw new Error('startersPerSide debe ser un entero ≥ 1.');
  if (new Set(players.map((p) => p.id)).size !== players.length) throw new Error('Hay jugadores duplicados en la convocatoria.');
  for (const p of players) {
    if (typeof p.stars !== 'number' || Number.isNaN(p.stars)) throw new Error(`Estrellas inválidas para ${p.name}.`);
  }

  const n = players.length;
  const sizeA = Math.ceil(n / 2);
  const [A0, B0] =
    n <= EXHAUSTIVE_LIMIT
      ? exhaustiveSearch(players, sizeA, startersPerSide, rng, tolerance)
      : localSearch(players, sizeA, startersPerSide, rng);

  // Con N impar, el equipo con un jugador extra no tiene por qué ser siempre el A.
  const swap = n % 2 === 1 && rng() < 0.5;
  return evaluateSplit(swap ? B0 : A0, swap ? A0 : B0, startersPerSide);
}

/** Filas listas para guardar como snapshot en match_players. */
function toSnapshotRows(result) {
  const rows = [];
  const push = (team, list, isStarter) =>
    list.forEach((p) =>
      rows.push({
        playerId: p.id,
        name: p.name,
        nick: p.nick ?? null,
        pos: p.pos ?? 'DEF',
        stars: p.stars,
        photo: p.photo ?? null,
        team,
        isStarter,
      })
    );
  push('A', result.teamA.starters, true);
  push('A', result.teamA.bench, false);
  push('B', result.teamB.starters, true);
  push('B', result.teamB.bench, false);
  return rows;
}

module.exports = { balanceTeams, evaluateSplit, toSnapshotRows };
