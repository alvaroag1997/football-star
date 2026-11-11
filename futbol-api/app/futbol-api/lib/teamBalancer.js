/**
 * teamBalancer.js — v1.2
 * Reparte N jugadores en Equipo A y Equipo B equilibrando estrellas, con soporte
 * de banquillo: N ya no está limitado a 2 × modalidad (ej. 14 en futsal = 7v7
 * con 5 titulares + 2 suplentes por equipo).
 *
 * El equilibrio se calcula sobre la PLANTILLA COMPLETA de cada equipo
 * (titulares + suplentes): suma total y media.
 *
 * Uso:
 *   const { balanceTeams } = require('./teamBalancer');
 *   const res = balanceTeams(players, { startersPerSide: 5 });
 */

/**
 * @typedef {Object} Player
 * @property {string} id
 * @property {string} name
 * @property {number} stars
 * @property {(string|null)=} photo
 */

const EXHAUSTIVE_LIMIT = 20; // hasta 20 jugadores se busca el óptimo exacto
const EPS = 1e-9;

function sum(list) {
  let s = 0;
  for (const p of list) s += p.stars;
  return s;
}

function mean(list) {
  return list.length ? sum(list) / list.length : 0;
}

/** Marca titulares (los mejores por estrellas) y suplentes de un equipo. */
function splitStartersAndBench(team, startersPerSide) {
  const sorted = [...team].sort((a, b) => b.stars - a.stars);
  return {
    starters: sorted.slice(0, startersPerSide),
    bench: sorted.slice(startersPerSide),
  };
}

/**
 * Coste de una partición: menor es mejor.
 * - Prioridad 1: diferencia de MEDIA entre plantillas completas.
 * - Prioridad 2: diferencia de SUMA total (con tamaños iguales es equivalente;
 *   con plantillas impares, desempata).
 * - Prioridad 3 (desempate fino): diferencia de media entre los titulares.
 */
function cost(teamA, teamB, startersPerSide) {
  const diffMean = Math.abs(mean(teamA) - mean(teamB));
  const diffSum = Math.abs(sum(teamA) - sum(teamB));
  const startA = splitStartersAndBench(teamA, startersPerSide).starters;
  const startB = splitStartersAndBench(teamB, startersPerSide).starters;
  const diffStarters = Math.abs(mean(startA) - mean(startB));
  return diffMean * 1000 + diffSum * 10 + diffStarters;
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
 * Búsqueda exacta (N ≤ 20): enumera todas las combinaciones de tamaño
 * ceil(N/2) para el equipo A, calcula el mejor coste y devuelve una al azar
 * entre las que empatan en la media/suma óptimas (así "Regenerar" da variedad
 * sin perder equilibrio).
 */
function exhaustiveSearch(players, sizeA, startersPerSide, rng) {
  const n = players.length;
  const stars = players.map((p) => p.stars);
  const total = stars.reduce((a, b) => a + b, 0);
  const sizeB = n - sizeA;

  const primary = (sumA) => {
    const sumB = total - sumA;
    return Math.abs(sumA / sizeA - sumB / sizeB) * 1000 + Math.abs(sumA - sumB) * 10;
  };

  // Pasada 1: coste primario mínimo
  let best = Infinity;
  const chosen = [];
  (function rec(start, count, acc) {
    if (count === sizeA) {
      const c = primary(acc);
      if (c < best) best = c;
      return;
    }
    for (let i = start; i <= n - (sizeA - count); i++) rec(i + 1, count + 1, acc + stars[i]);
  })(0, 0, 0);

  // Pasada 2: recoger todas las combinaciones óptimas (con tope para no explotar memoria)
  const candidates = [];
  const MAX_CANDIDATES = 500;
  (function rec(start, count, acc) {
    if (candidates.length >= MAX_CANDIDATES) return;
    if (count === sizeA) {
      if (primary(acc) <= best + EPS) candidates.push([...chosen]);
      return;
    }
    for (let i = start; i <= n - (sizeA - count); i++) {
      chosen.push(i);
      rec(i + 1, count + 1, acc + stars[i]);
      chosen.pop();
    }
  })(0, 0, 0);

  // Entre las óptimas, afinar por equilibrio de titulares y elegir al azar entre las mejores
  let bestFine = Infinity;
  let pool = [];
  for (const idxs of candidates) {
    const set = new Set(idxs);
    const A = players.filter((_, i) => set.has(i));
    const B = players.filter((_, i) => !set.has(i));
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

/**
 * Búsqueda heurística (N > 20): reinicios aleatorios + mejora por
 * intercambios de pares (hill climbing) hasta que ningún swap mejora.
 */
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

/**
 * @param {Player[]} players  Convocados (cualquier cantidad ≥ 2).
 * @param {Object} opts
 * @param {number} opts.startersPerSide  Titulares por equipo según modalidad (5, 7, 11).
 * @param {() => number=} opts.rng       Generador aleatorio (inyectable para tests).
 * @returns {{
 *   teamA: {starters: Player[], bench: Player[], sum: number, mean: number},
 *   teamB: {starters: Player[], bench: Player[], sum: number, mean: number},
 *   stats: {diffSum: number, diffMean: number, sizeA: number, sizeB: number}
 * }}
 */
function balanceTeams(players, { startersPerSide, rng = Math.random } = {}) {
  if (!Array.isArray(players) || players.length < 2) {
    throw new Error('Se necesitan al menos 2 jugadores.');
  }
  if (!Number.isInteger(startersPerSide) || startersPerSide < 1) {
    throw new Error('startersPerSide debe ser un entero ≥ 1.');
  }
  const ids = new Set(players.map((p) => p.id));
  if (ids.size !== players.length) throw new Error('Hay jugadores duplicados en la convocatoria.');
  for (const p of players) {
    if (typeof p.stars !== 'number' || Number.isNaN(p.stars)) {
      throw new Error(`Estrellas inválidas para ${p.name}.`);
    }
  }

  // Sin restricción de modalidad: el tamaño depende solo de los convocados.
  // Si N es impar, el equipo A recibe un jugador más (el reparto A/B se puede
  // aleatorizar abajo para que no siempre sea A el más numeroso).
  const n = players.length;
  const sizeA = Math.ceil(n / 2);

  const [A0, B0] =
    n <= EXHAUSTIVE_LIMIT
      ? exhaustiveSearch(players, sizeA, startersPerSide, rng)
      : localSearch(players, sizeA, startersPerSide, rng);

  // Con N impar, intercambiar etiquetas al azar para que el equipo con un
  // jugador extra no sea siempre el A.
  const swap = n % 2 === 1 && rng() < 0.5;
  const A = swap ? B0 : A0;
  const B = swap ? A0 : B0;

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
  };
}

/**
 * Convierte el resultado en filas de snapshot listas para guardar en
 * match_players (o en matches.roster en Firestore/Mongo).
 */
function toSnapshotRows(result) {
  const rows = [];
  const push = (team, list, isStarter) =>
    list.forEach((p) =>
      rows.push({
        playerId: p.id,
        name: p.name,
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

module.exports = { balanceTeams, toSnapshotRows };
