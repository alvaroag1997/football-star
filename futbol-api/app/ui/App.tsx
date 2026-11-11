'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

/* ============================== Tipos ============================== */
type Group = { id: string; name: string; players: number };
type GPlayer = { id: string; name: string; photoUrl: string | null; stars: number };
type AnyPlayer = { id: string; name: string; photoUrl: string | null; groupIds: string[] };
type Person = { id: string; name: string; stars: number };
type TeamOut = { starters: Person[]; bench: Person[]; sum: number; mean: number };
type Balanced = {
  teamA: TeamOut;
  teamB: TeamOut;
  stats: { diffSum: number; diffMean: number; sizeA: number; sizeB: number };
};
type RosterRow = { entryId: string; name: string; stars: number; team: 'A' | 'B'; isStarter: boolean };
type MatchItem = {
  id: string;
  groupName: string;
  scheduledAt: string;
  location: string | null;
  format: string;
  playersCount: number;
};
type Detail = MatchItem & { status: string; roster: RosterRow[] };
type HistItem = {
  id: string;
  groupName: string;
  scheduledAt: string;
  location: string | null;
  format: string;
  scoreA: number | null;
  scoreB: number | null;
  needsResult: boolean;
  mvpName: string | null;
  roster: RosterRow[];
};
type Col = { starters: { key: string; name: string; stars: number }[]; bench: { key: string; name: string; stars: number }[] };

const FORMATS: { value: string; label: string; starters: number }[] = [
  { value: '5v5', label: 'Fútbol sala (5v5)', starters: 5 },
  { value: '7v7', label: 'Fútbol 7 (7v7)', starters: 7 },
  { value: '11v11', label: 'Fútbol 11 (11v11)', starters: 11 },
];

/* ============================== Utilidades ============================== */
const KEY = 'futbol_api_key';

function loadKey(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}
function saveKey(k: string) {
  try {
    if (k) localStorage.setItem(KEY, k);
    else localStorage.removeItem(KEY);
  } catch {
    /* sin almacenamiento: la sesión dura lo que dure la pestaña */
  }
}

async function api<T>(key: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'x-api-key': key, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* respuesta sin cuerpo */
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error ?? `Error ${res.status}`;
    const e = new Error(msg) as Error & { status: number };
    e.status = res.status;
    throw e;
  }
  return data as T;
}

const msgOf = (e: unknown) => (e instanceof Error ? e.message : 'Error inesperado');

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('es-ES', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}
const n1 = (n: number) => (Math.round(n * 10) / 10).toString();
const n2 = (n: number) => (Math.round(n * 100) / 100).toString();

function colFromTeam(t: TeamOut): Col {
  const m = (p: Person) => ({ key: p.id, name: p.name, stars: p.stars });
  return { starters: t.starters.map(m), bench: t.bench.map(m) };
}
function colFromRoster(r: RosterRow[], team: 'A' | 'B'): Col {
  const m = (p: RosterRow) => ({ key: p.entryId, name: p.name, stars: p.stars });
  const mine = r.filter((x) => x.team === team);
  return { starters: mine.filter((x) => x.isStarter).map(m), bench: mine.filter((x) => !x.isStarter).map(m) };
}

function defaultWhen(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(21, 0, 0, 0);
  return toLocalInput(d);
}
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ============================== Piezas comunes ============================== */
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="link" onClick={onClose} aria-label="Cerrar">✕ Cerrar</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function TeamsView({ a, b }: { a: Col; b: Col }) {
  const tot = (c: Col) => {
    const all = [...c.starters, ...c.bench];
    const sum = all.reduce((s, p) => s + p.stars, 0);
    return { sum, mean: all.length ? sum / all.length : 0, n: all.length };
  };
  const one = (c: Col, side: 'A' | 'B') => {
    const t = tot(c);
    return (
      <div className={`team ${side}`}>
        <h3>Equipo {side}</h3>
        <div className="tot">{t.n} jug. · Suma {n1(t.sum)} · Media {n2(t.mean)}</div>
        <ul>
          {c.starters.map((p) => (
            <li key={p.key}><span>{p.name}</span><span className="stars">★ {n1(p.stars)}</span></li>
          ))}
        </ul>
        {c.bench.length > 0 && (
          <>
            <div className="bench-h">Banquillo</div>
            <ul>
              {c.bench.map((p) => (
                <li key={p.key} className="bench"><span>{p.name}</span><span>★ {n1(p.stars)}</span></li>
              ))}
            </ul>
          </>
        )}
      </div>
    );
  };
  return <div className="teams">{one(a, 'A')}{one(b, 'B')}</div>;
}

/* ============================== Login ============================== */
function Login({ onOk }: { onOk: (k: string) => void }) {
  const [k, setK] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      await api<Group[]>(k.trim(), '/api/groups');
      onOk(k.trim());
    } catch (e) {
      const status = (e as { status?: number }).status;
      setErr(status === 401 ? 'Clave incorrecta' : msgOf(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="app">
      <div className="top"><h1>⚽ Fútbol</h1></div>
      <div className="card stack">
        <div className="title">Acceso de administrador</div>
        <div className="muted">Escribe la clave <b>ADMIN_API_KEY</b> que configuraste en Vercel. Se guarda solo en este dispositivo.</div>
        <input className="in" type="password" placeholder="Clave de administrador" value={k}
          onChange={(e) => setK(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && k && go()} />
        {err && <div className="err">{err}</div>}
        <button className="btn" disabled={!k.trim() || busy} onClick={go}>{busy ? 'Comprobando…' : 'Entrar'}</button>
      </div>
    </div>
  );
}

/* ============================== Resultado y MVP ============================== */
function ResultSheet({ k, item, onClose, onDone }: { k: string; item: HistItem; onClose: () => void; onDone: () => void }) {
  const [sa, setSa] = useState(item.scoreA?.toString() ?? '');
  const [sb, setSb] = useState(item.scoreB?.toString() ?? '');
  const [mvp, setMvp] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    setErr('');
    try {
      await api(k, `/api/matches/${item.id}/result`, 'POST', {
        scoreA: Number(sa), scoreB: Number(sb), ...(mvp ? { mvpEntryId: mvp } : {}),
      });
      onDone();
    } catch (e) {
      setErr(msgOf(e));
      setBusy(false);
    }
  };
  const valid = sa !== '' && sb !== '' && Number(sa) >= 0 && Number(sb) >= 0;
  return (
    <Sheet title="Resultado y MVP" onClose={onClose}>
      <div className="muted" style={{ marginBottom: 12 }}>{item.groupName} · {fmtDate(item.scheduledAt)}</div>
      <div className="stack">
        <div className="scoreline">
          <span className="title">A</span>
          <input className="in" inputMode="numeric" type="number" min={0} max={99} value={sa} onChange={(e) => setSa(e.target.value)} />
          <span className="score">-</span>
          <input className="in" inputMode="numeric" type="number" min={0} max={99} value={sb} onChange={(e) => setSb(e.target.value)} />
          <span className="title">B</span>
        </div>
        <label className="f">MVP del partido
          <select className="in" value={mvp} onChange={(e) => setMvp(e.target.value)}>
            <option value="">— Sin MVP por ahora —</option>
            {(['A', 'B'] as const).map((t) => (
              <optgroup key={t} label={`Equipo ${t}`}>
                {item.roster.filter((r) => r.team === t).map((r) => (
                  <option key={r.entryId} value={r.entryId}>{r.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        {err && <div className="err">{err}</div>}
        <button className="btn" disabled={!valid || busy} onClick={save}>{busy ? 'Guardando…' : 'Guardar'}</button>
      </div>
    </Sheet>
  );
}

/* ============================== Pestaña Partidos ============================== */
function MatchesTab({ k, rev, reload }: { k: string; rev: number; reload: () => void }) {
  const [list, setList] = useState<MatchItem[] | null>(null);
  const [due, setDue] = useState<HistItem[]>([]);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [result, setResult] = useState<HistItem | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [m, h] = await Promise.all([
          api<MatchItem[]>(k, '/api/matches'),
          api<HistItem[]>(k, '/api/history'),
        ]);
        if (!live) return;
        setList(m);
        setDue(h.filter((x) => x.needsResult));
        setErr('');
      } catch (e) {
        if (live) setErr(msgOf(e));
      }
    })();
    return () => { live = false; };
  }, [k, rev]);

  return (
    <>
      {err && <div className="err">{err}</div>}
      {due.map((d) => (
        <div className="alert" key={d.id}>
          <b>El partido ya se ha jugado. ¡Vota al MVP y registra el resultado!</b>
          <div>{d.groupName} · {fmtDate(d.scheduledAt)}</div>
          <button className="btn small" onClick={() => setResult(d)}>Registrar resultado</button>
        </div>
      ))}
      {list === null && !err && <div className="empty">Cargando…</div>}
      {list?.length === 0 && <div className="empty">No hay partidos pendientes.<br />Pulsa “Crear partido”.</div>}
      {list?.map((m) => (
        <div className="card tap stack" key={m.id} onClick={() => setOpen(m.id)}>
          <div className="row">
            <span className="title">{m.groupName}</span>
            <span className="pill">{m.format} · {m.playersCount} jug.</span>
          </div>
          <div className="muted">{fmtDate(m.scheduledAt)}{m.location ? ` · ${m.location}` : ''}</div>
        </div>
      ))}
      {open && <MatchSheet k={k} id={open} onClose={() => setOpen(null)} onChanged={() => { setOpen(null); reload(); }} />}
      {result && <ResultSheet k={k} item={result} onClose={() => setResult(null)} onDone={() => { setResult(null); reload(); }} />}
    </>
  );
}

function MatchSheet({ k, id, onClose, onChanged }: { k: string; id: string; onClose: () => void; onChanged: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Detail>(k, `/api/matches/${id}`).then(setD).catch((e) => setErr(msgOf(e)));
  }, [k, id]);

  const cancel = async () => {
    if (!confirm('¿Cancelar este partido? No se podrá recuperar.')) return;
    setBusy(true);
    try {
      await api(k, `/api/matches/${id}/cancel`, 'POST');
      onChanged();
    } catch (e) {
      setErr(msgOf(e));
      setBusy(false);
    }
  };

  return (
    <Sheet title={d ? d.groupName : 'Partido'} onClose={onClose}>
      {err && <div className="err">{err}</div>}
      {!d && !err && <div className="empty">Cargando…</div>}
      {d && (
        <div className="stack">
          <div className="muted">{fmtDate(d.scheduledAt)}{d.location ? ` · ${d.location}` : ''} · {d.format}</div>
          <TeamsView a={colFromRoster(d.roster, 'A')} b={colFromRoster(d.roster, 'B')} />
          {d.status === 'pending' && (
            <button className="btn danger" disabled={busy} onClick={cancel}>Cancelar partido</button>
          )}
        </div>
      )}
    </Sheet>
  );
}

/* ============================== Pestaña Historial ============================== */
function HistoryTab({ k, rev, reload }: { k: string; rev: number; reload: () => void }) {
  const [list, setList] = useState<HistItem[] | null>(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [result, setResult] = useState<HistItem | null>(null);

  useEffect(() => {
    let live = true;
    api<HistItem[]>(k, '/api/history')
      .then((h) => { if (live) { setList(h); setErr(''); } })
      .catch((e) => { if (live) setErr(msgOf(e)); });
    return () => { live = false; };
  }, [k, rev]);

  return (
    <>
      {err && <div className="err">{err}</div>}
      {list === null && !err && <div className="empty">Cargando…</div>}
      {list?.length === 0 && <div className="empty">Aún no hay partidos jugados.</div>}
      {list?.map((h) => (
        <div className="card stack" key={h.id}>
          <div className="row tap" style={{ cursor: 'pointer' }} onClick={() => setOpen(open === h.id ? null : h.id)}>
            <div>
              <div className="title">{h.groupName}</div>
              <div className="muted">{fmtDate(h.scheduledAt)}{h.location ? ` · ${h.location}` : ''}</div>
            </div>
            {h.needsResult ? <span className="pill">Sin resultado</span> : <span className="score">{h.scoreA} - {h.scoreB}</span>}
          </div>
          {h.mvpName && <div>🏆 MVP: <b>{h.mvpName}</b></div>}
          {open === h.id && <TeamsView a={colFromRoster(h.roster, 'A')} b={colFromRoster(h.roster, 'B')} />}
          <div className="btns">
            <button className="btn small ghost" onClick={() => setOpen(open === h.id ? null : h.id)}>
              {open === h.id ? 'Ocultar equipos' : 'Ver equipos'}
            </button>
            <button className="btn small ghost" onClick={() => setResult(h)}>
              {h.needsResult ? 'Registrar resultado' : 'Editar resultado / MVP'}
            </button>
          </div>
        </div>
      ))}
      {result && <ResultSheet k={k} item={result} onClose={() => setResult(null)} onDone={() => { setResult(null); reload(); }} />}
    </>
  );
}

/* ============================== Pestaña Grupos ============================== */
function GroupsTab({ k, rev, reload }: { k: string; rev: number; reload: () => void }) {
  const [list, setList] = useState<Group[] | null>(null);
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<Group | null>(null);

  useEffect(() => {
    let live = true;
    api<Group[]>(k, '/api/groups')
      .then((g) => { if (live) { setList(g); setErr(''); } })
      .catch((e) => { if (live) setErr(msgOf(e)); });
    return () => { live = false; };
  }, [k, rev]);

  const add = async () => {
    try {
      await api(k, '/api/groups', 'POST', { name });
      setName('');
      reload();
    } catch (e) {
      setErr(msgOf(e));
    }
  };

  return (
    <>
      <div className="card stack">
        <div className="title">Nuevo grupo</div>
        <div className="row">
          <input className="in" placeholder="Ej: Fútbol Jueves" value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && name.trim() && add()} />
          <button className="btn" disabled={!name.trim()} onClick={add}>Crear</button>
        </div>
      </div>
      {err && <div className="err">{err}</div>}
      {list === null && !err && <div className="empty">Cargando…</div>}
      {list?.length === 0 && <div className="empty">Crea tu primer grupo arriba.</div>}
      {list?.map((g) => (
        <div className="card tap row" key={g.id} onClick={() => setOpen(g)}>
          <span className="title">{g.name}</span>
          <span className="pill">{g.players} jugadores ›</span>
        </div>
      ))}
      {open && <GroupSheet k={k} group={open} onClose={() => { setOpen(null); reload(); }} />}
    </>
  );
}

function GroupSheet({ k, group, onClose }: { k: string; group: Group; onClose: () => void }) {
  const [players, setPlayers] = useState<GPlayer[] | null>(null);
  const [everyone, setEveryone] = useState<AnyPlayer[]>([]);
  const [name, setName] = useState('');
  const [stars, setStars] = useState(5);
  const [existing, setExisting] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(async () => {
    try {
      const [p, all] = await Promise.all([
        api<GPlayer[]>(k, `/api/groups/${group.id}/players`),
        api<AnyPlayer[]>(k, '/api/players'),
      ]);
      setPlayers(p);
      setEveryone(all);
      setErr('');
    } catch (e) {
      setErr(msgOf(e));
    }
  }, [k, group.id]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    try { await fn(); await load(); } catch (e) { setErr(msgOf(e)); }
  };
  const addNew = () => run(async () => {
    await api(k, `/api/groups/${group.id}/players`, 'POST', { name, stars });
    setName('');
  });
  const addExisting = () => run(async () => {
    await api(k, `/api/groups/${group.id}/players`, 'POST', { playerId: existing, stars });
    setExisting('');
  });
  const setStarsOf = (id: string, v: number) => {
    const s = Math.min(10, Math.max(0, v));
    setPlayers((ps) => ps && ps.map((p) => (p.id === id ? { ...p, stars: s } : p)));
    api(k, `/api/groups/${group.id}/players/${id}`, 'PATCH', { stars: s }).catch((e) => { setErr(msgOf(e)); load(); });
  };
  const remove = (p: GPlayer) => {
    if (!confirm(`¿Quitar a ${p.name} del grupo? Seguirá apareciendo en el historial.`)) return;
    run(() => api(k, `/api/groups/${group.id}/players/${p.id}`, 'DELETE'));
  };

  const available = everyone.filter((p) => !p.groupIds.includes(group.id));

  return (
    <Sheet title={group.name} onClose={onClose}>
      {err && <div className="err">{err}</div>}
      <div className="stack">
        {players === null && !err && <div className="empty">Cargando…</div>}
        {players?.length === 0 && <div className="muted">Este grupo aún no tiene jugadores.</div>}
        {players?.map((p) => (
          <div className="card row" key={p.id} style={{ margin: 0 }}>
            <span className="title">{p.name}</span>
            <div className="stepper">
              <button className="btn small ghost" aria-label="Bajar" onClick={() => setStarsOf(p.id, p.stars - 0.5)}>−</button>
              <span className="stars" style={{ margin: 0, minWidth: 52, textAlign: 'center' }}>★ {n1(p.stars)}</span>
              <button className="btn small ghost" aria-label="Subir" onClick={() => setStarsOf(p.id, p.stars + 0.5)}>+</button>
              <button className="btn small danger" aria-label="Quitar" onClick={() => remove(p)}>🗑</button>
            </div>
          </div>
        ))}

        <div className="card stack" style={{ margin: 0 }}>
          <div className="title">Añadir jugador</div>
          <label className="f">Nivel inicial (estrellas): {n1(stars)}
            <input type="range" min={0} max={10} step={0.5} value={stars} onChange={(e) => setStars(Number(e.target.value))} />
          </label>
          <div className="row">
            <input className="in" placeholder="Nombre del jugador" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn" disabled={!name.trim()} onClick={addNew}>Añadir</button>
          </div>
          {available.length > 0 && (
            <div className="row">
              <select className="in" value={existing} onChange={(e) => setExisting(e.target.value)}>
                <option value="">…o reutilizar uno de otro grupo</option>
                {available.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button className="btn" disabled={!existing} onClick={addExisting}>Añadir</button>
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/* ============================== Crear partido ============================== */
function CreateSheet({ k, onClose, onCreated }: { k: string; onClose: () => void; onCreated: () => void }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [groupId, setGroupId] = useState('');
  const [players, setPlayers] = useState<GPlayer[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState('5v5');
  const [when, setWhen] = useState(defaultWhen());
  const [place, setPlace] = useState('');
  const [teams, setTeams] = useState<Balanced | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Group[]>(k, '/api/groups').then(setGroups).catch((e) => setErr(msgOf(e)));
  }, [k]);

  // PASO 1 obligatorio: al elegir grupo solo se cargan los jugadores de ESE grupo.
  const pickGroup = async (id: string) => {
    setGroupId(id);
    setSel(new Set());
    setTeams(null);
    setPlayers([]);
    if (!id) return;
    try {
      setPlayers(await api<GPlayer[]>(k, `/api/groups/${id}/players`));
      setErr('');
    } catch (e) {
      setErr(msgOf(e));
    }
  };

  const toggle = (id: string) => {
    setTeams(null);
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const starters = FORMATS.find((f) => f.value === format)!.starters;
  const n = sel.size;
  const sizeText = useMemo(() => {
    if (n < 2) return 'Selecciona al menos 2 jugadores';
    const big = Math.ceil(n / 2), small = Math.floor(n / 2);
    const side = big === small ? `${big} vs ${big}` : `${big} vs ${small}`;
    const bench = Math.max(0, big - starters);
    return `${n} convocados → ${side}` + (bench ? ` (${starters} titulares + ${bench} suplentes por equipo)` : '');
  }, [n, starters]);

  const generate = async () => {
    setBusy(true);
    setErr('');
    try {
      setTeams(await api<Balanced>(k, '/api/matches/preview', 'POST', { groupId, format, playerIds: [...sel] }));
    } catch (e) {
      setErr(msgOf(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!teams) return;
    setBusy(true);
    setErr('');
    try {
      const ids = (t: TeamOut) => [...t.starters, ...t.bench].map((p) => p.id);
      await api(k, '/api/matches', 'POST', {
        groupId, format, location: place.trim() || undefined,
        scheduledAt: new Date(when).toISOString(),
        playerIds: [...sel],
        assignment: { A: ids(teams.teamA), B: ids(teams.teamB) },
      });
      onCreated();
    } catch (e) {
      setErr(msgOf(e));
      setBusy(false);
    }
  };

  return (
    <Sheet title="Crear partido" onClose={onClose}>
      <div className="stack">
        <label className="f">1. Grupo
          <select className="in" value={groupId} onChange={(e) => pickGroup(e.target.value)}>
            <option value="">Elige un grupo…</option>
            {groups?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        {groups?.length === 0 && <div className="muted">Aún no tienes grupos. Crea uno en la pestaña “Grupos”.</div>}

        {groupId && (
          <>
            <div className="row" style={{ alignItems: 'stretch' }}>
              <label className="f" style={{ flex: 1 }}>Modalidad
                <select className="in" value={format} onChange={(e) => { setFormat(e.target.value); setTeams(null); }}>
                  {FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                </select>
              </label>
              <label className="f" style={{ flex: 1 }}>Fecha y hora
                <input className="in" type="datetime-local" value={when} min={toLocalInput(new Date())}
                  onChange={(e) => setWhen(e.target.value)} />
              </label>
            </div>
            <label className="f">Lugar (opcional)
              <input className="in" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Pabellón, campo…" />
            </label>

            <div className="row">
              <span className="title">2. Convocatoria</span>
              <div className="btns">
                <button className="btn small ghost" onClick={() => { setTeams(null); setSel(new Set(players.map((p) => p.id))); }}>Todos</button>
                <button className="btn small ghost" onClick={() => { setTeams(null); setSel(new Set()); }}>Ninguno</button>
              </div>
            </div>
            {players.length === 0 && <div className="muted">Este grupo no tiene jugadores todavía. Añádelos en la pestaña “Grupos”.</div>}
            <div className="stack">
              {players.map((p) => (
                <label key={p.id} className={`check ${sel.has(p.id) ? 'on' : ''}`}>
                  <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
                  <span>{p.name}</span>
                  <span className="stars">★ {n1(p.stars)}</span>
                </label>
              ))}
            </div>
            <div className="muted">{sizeText}</div>

            {err && <div className="err">{err}</div>}
            <button className="btn" disabled={n < 2 || busy || !when} onClick={generate}>
              {teams ? 'Regenerar equipos' : 'Generar equipos'}
            </button>

            {teams && (
              <>
                <TeamsView a={colFromTeam(teams.teamA)} b={colFromTeam(teams.teamB)} />
                <div className="muted">
                  Diferencia de suma: {n1(teams.stats.diffSum)} · Diferencia de media: {n2(teams.stats.diffMean)}
                </div>
                <button className="btn" disabled={busy} onClick={save}>Guardar partido</button>
              </>
            )}
          </>
        )}
        {!groupId && err && <div className="err">{err}</div>}
      </div>
    </Sheet>
  );
}

/* ============================== App ============================== */
export default function App() {
  const [key, setKey] = useState<string | null>(null);
  const [tab, setTab] = useState<'matches' | 'history' | 'groups'>('matches');
  const [creating, setCreating] = useState(false);
  const [rev, setRev] = useState(0);
  const reload = useCallback(() => setRev((r) => r + 1), []);

  useEffect(() => { setKey(loadKey()); }, []);
  if (key === null) return null;
  if (!key) return <Login onOk={(k) => { saveKey(k); setKey(k); }} />;

  const titles = { matches: 'Partidos', history: 'Historial', groups: 'Grupos' } as const;

  return (
    <div className="app">
      <div className="top">
        <h1>⚽ {titles[tab]}</h1>
        <button className="link" onClick={() => { saveKey(''); setKey(''); }}>Salir</button>
      </div>

      {tab === 'matches' && <MatchesTab k={key} rev={rev} reload={reload} />}
      {tab === 'history' && <HistoryTab k={key} rev={rev} reload={reload} />}
      {tab === 'groups' && <GroupsTab k={key} rev={rev} reload={reload} />}

      {tab === 'matches' && <button className="fab" onClick={() => setCreating(true)}>＋ Crear partido</button>}

      <nav className="tabs">
        <div className="tabs-inner">
          {(['matches', 'history', 'groups'] as const).map((t) => (
            <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{titles[t]}</button>
          ))}
        </div>
      </nav>

      {creating && <CreateSheet k={key} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); setTab('matches'); reload(); }} />}
    </div>
  );
}
