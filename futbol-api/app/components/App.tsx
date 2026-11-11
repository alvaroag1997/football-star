'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

/* ================================ tipos ================================ */
type Pos = 'GK' | 'DEF' | 'ATT';
type Group = { id: string; name: string; players: number };
type Player = { id: string; name: string; nick: string | null; pos: Pos; photoUrl: string | null; stars: number };
type Entry = {
  entryId: string; name: string; nick: string | null; pos: Pos; stars: number; photo: string | null;
  team: 'A' | 'B'; isStarter: boolean;
};
type Balance = {
  sumA: number; sumB: number; meanA: number; meanB: number; diffSum: number; diffMean: number; warnings?: string[];
} | null;
type MatchRow = {
  id: string; groupId: string; groupName: string; scheduledAt: string; location: string | null; format: string;
  startersPerSide: number; status: string; balanceStats: Balance; playersCount: number;
};
type Detail = {
  id: string; groupId: string; groupName: string; scheduledAt: string; location: string | null; format: string;
  startersPerSide: number; status: string; balanceStats: Balance; scoreA: number | null; scoreB: number | null;
  mvpEntryId: string | null; needsResult: boolean; roster: Entry[];
};
type HistRow = {
  id: string; groupId: string; groupName: string; scheduledAt: string; location: string | null; format: string;
  scoreA: number | null; scoreB: number | null; needsResult: boolean; balanceStats: Balance;
  mvpName: string | null; mvpPhoto: string | null;
};
type StatRow = { playerId: string; name: string; nick: string | null; pos: Pos; stars: number; pj: number; w: number; mvp: number };
type Call = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Tab = 'matches' | 'history' | 'squad' | 'stats';
type View = null | { t: 'new' } | { t: 'match'; id: string; pack?: boolean };
type PlayerInit = { id?: string; name: string; nick: string; pos: Pos; stars: number };
type SheetState =
  | null
  | { t: 'player'; init: PlayerInit }
  | { t: 'text'; text: string }
  | { t: 'group' }
  | { t: 'existing' }
  | { t: 'result'; id: string; title: string; roster: Entry[]; scoreA: number | null; scoreB: number | null; mvp: string | null; onSaved: () => void };

const MOD: Record<string, { label: string; short: string; n: number }> = {
  '5v5': { label: 'Fútbol Sala', short: '5v5', n: 5 },
  '7v7': { label: 'Fútbol 7', short: '7v7', n: 7 },
  '11v11': { label: 'Fútbol 11', short: '11v11', n: 11 },
};
const POS: Record<Pos, { label: string; short: string; o: number }> = {
  GK: { label: 'Portero', short: 'POR', o: 0 },
  DEF: { label: 'Defensa', short: 'DEF', o: 1 },
  ATT: { label: 'Atacante', short: 'DEL', o: 2 },
};

class AuthError extends Error {}

async function api<T>(key: string, path: string, method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-api-key': key };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new AuthError('Clave incorrecta');
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Error del servidor');
  return data as T;
}

/* ============================== utilidades ============================== */
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Algo ha fallado');
const f1 = (n: number) => n.toFixed(1);
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtD = (iso: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-ES', o).format(new Date(iso)).replace('.', '');
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
const mapsUrl = (v: string) => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(v);

function nextThursday() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + (((4 - d.getDay() + 7) % 7) || 7));
  return ymd(d);
}

/** Titulares primero; dentro de cada bloque, el portero arriba y luego por estrellas. */
function sortTeam(list: Entry[]) {
  return [...list].sort(
    (a, b) => Number(b.isStarter) - Number(a.isStarter) || (a.pos === 'GK' ? 0 : 1) - (b.pos === 'GK' ? 0 : 1) || b.stars - a.stars
  );
}
const sumOf = (l: Entry[]) => l.reduce((a, p) => a + p.stars, 0);

function lineupText(d: Detail) {
  const L = [`Fútbol · ${MOD[d.format]?.label ?? d.format} · ${cap1(fmtD(d.scheduledAt, { weekday: 'long', day: 'numeric', month: 'long' }))} · ${hhmm(d.scheduledAt)}`];
  if (d.location) L.push(d.location);
  const line = (p: Entry) => `- ${p.name}${p.nick ? ` (${p.nick})` : ''}${p.pos === 'GK' ? ' [POR]' : ''}`;
  (['A', 'B'] as const).forEach((t) => {
    const list = sortTeam(d.roster.filter((r) => r.team === t));
    L.push('', `EQUIPO ${t}`);
    list.filter((p) => p.isStarter).forEach((p) => L.push(line(p)));
    const bench = list.filter((p) => !p.isStarter);
    if (bench.length) {
      L.push('Suplentes:');
      bench.forEach((p) => L.push(line(p)));
    }
  });
  return L.join('\n');
}

/* ============================ piezas de interfaz ============================ */
const IC: Record<string, string> = {
  matches: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  history: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  squad: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.8a3.5 3.5 0 010 6.4M18 14.8c2 .6 3.3 2.3 3.5 5.2"/>',
  stats: '<path d="M5 20V11M12 20V4M19 20v-6M3 20h18"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chev: '<path d="M9 5l7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  swap: '<path d="M4 8h14l-4-4M20 16H6l4 4"/>',
  grip: '<g fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.7"/><circle cx="15" cy="6" r="1.7"/><circle cx="9" cy="12" r="1.7"/><circle cx="15" cy="12" r="1.7"/><circle cx="9" cy="18" r="1.7"/><circle cx="15" cy="18" r="1.7"/></g>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/>',
  shuffle: '<path d="M3 7h4l9 10h5M3 17h4l2-2.4M14 9.4L16 7h5M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  warn: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.5v.01"/>',
};
function Icon({ n }: { n: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" dangerouslySetInnerHTML={{ __html: IC[n] }} />
  );
}

const STAR = 'M12 2.5l2.9 6.2 6.6.8-4.9 4.6 1.3 6.7L12 17.6 6.1 20.8l1.3-6.7L2.5 9.5l6.6-.8z';
function Stars({ v, size, onPick }: { v: number; size: number; onPick?: (v: number) => void }) {
  return (
    <span className="stars" style={{ '--s': size + 'px' } as CSSProperties} role="img" aria-label={`${v} estrellas`}>
      {[1, 2, 3, 4, 5].map((i) => {
        const f = Math.max(0, Math.min(1, v - (i - 1)));
        return (
          <span className="st" key={i}>
            <svg className="b" viewBox="0 0 24 24"><path d={STAR} /></svg>
            <span className="fw" style={{ width: f * 100 + '%' }}><svg viewBox="0 0 24 24"><path d={STAR} /></svg></span>
            {onPick && (
              <>
                <button type="button" className="hz l" onClick={() => onPick(i - 0.5)} aria-label={`${i - 0.5} estrellas`} />
                <button type="button" className="hz r" onClick={() => onPick(i)} aria-label={`${i} estrellas`} />
              </>
            )}
          </span>
        );
      })}
    </span>
  );
}

function Av({ name }: { name: string }) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 90;
  return <span className="av" style={{ '--h': 95 + h } as CSSProperties}>{name.slice(0, 2).toUpperCase()}</span>;
}
const PosChip = ({ pos }: { pos: Pos }) => <span className={`chip${pos === 'GK' ? ' gk' : ''}`}>{POS[pos].short}</span>;

function Hdr({ eyebrow, title, onBack, right }: { eyebrow: string; title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="hdr">
      {onBack && <button className="iconbtn" onClick={onBack} aria-label="Volver"><Icon n="back" /></button>}
      <div className="htxt"><div className="eyebrow">{eyebrow}</div><h1>{title}</h1></div>
      {right}
    </header>
  );
}

function SheetShell({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-label={title}>
        <div className="grab" />
        <h2>{title}</h2>
        {children}
      </div>
    </>
  );
}

function GroupSelect({ groups, value, onChange, label = 'Grupo' }: { groups: Group[]; value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <div>
      <label htmlFor="g-sel">{label}</label>
      <select id="g-sel" value={value} onChange={(e) => onChange(e.target.value)}>
        {groups.length === 0 && <option value="">Sin grupos</option>}
        {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.players})</option>)}
      </select>
    </div>
  );
}

function MatchCard({ m, count, played, right, onOpen }: {
  m: { id: string; groupName: string; scheduledAt: string; location: string | null; format: string; balanceStats: Balance };
  count?: number; played?: boolean; right: ReactNode; onOpen: () => void;
}) {
  const d = new Date(m.scheduledAt);
  const info = [m.groupName];
  if (count !== undefined) info.push(`${count} jugadores`);
  if (!played && m.balanceStats) info.push(`diferencia ${f1(m.balanceStats.diffSum)}★`);
  return (
    <button className="card mcard" onClick={onOpen}>
      <span className="dbox"><b>{d.getDate()}</b><small>{fmtD(m.scheduledAt, { month: 'short' })}</small></span>
      <span className="minfo">
        <span className="mtop"><b>{MOD[m.format]?.label ?? m.format}</b><span className="chip">{MOD[m.format]?.short ?? m.format}</span></span>
        <span className="mmeta">{cap1(fmtD(m.scheduledAt, { weekday: 'long' }))} · {hhmm(m.scheduledAt)} · {m.location || 'Sin lugar'}</span>
        <span className="mmeta">{info.join(' · ')}</span>
      </span>
      {right}
    </button>
  );
}

/* ================================ Entrada ================================ */
function Login({ onLogin }: { onLogin: (k: string) => void }) {
  const [k, setK] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      await api<Group[]>(k.trim(), '/api/groups');
      onLogin(k.trim());
    } catch (e) {
      setErr(e instanceof AuthError ? 'Esa clave no es correcta.' : msg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="app">
      <Hdr eyebrow="Equilibrio FC" title="Entrar" />
      <main className="main">
        <div className="card form">
          <p className="note" style={{ margin: 0 }}>Introduce tu clave de administrador (la que pusiste en ADMIN_API_KEY en Vercel).</p>
          <label htmlFor="k">Clave de administrador</label>
          <input id="k" type="password" value={k} onChange={(e) => setK(e.target.value)} autoComplete="current-password"
            onKeyDown={(e) => { if (e.key === 'Enter' && k.trim()) go(); }} />
        </div>
        {err && <div className="alert err">{err}</div>}
      </main>
      <div className="foot"><button className="btn primary" disabled={!k.trim() || busy} onClick={go}>{busy ? 'Comprobando…' : 'Entrar'}</button></div>
    </div>
  );
}

/* ============================ Nuevo partido (2 pasos) ============================ */
function NewMatch({ groups, call, flash, onClose, onCreated }: {
  groups: Group[]; call: Call; flash: (m: string) => void; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [groupId, setGroupId] = useState('');
  const [mod, setMod] = useState('7v7');
  const [date, setDate] = useState(nextThursday());
  const [time, setTime] = useState('21:00');
  const [venue, setVenue] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Con varios grupos hay que elegir uno a propósito; con uno solo no hay duda posible.
  useEffect(() => { if (groups.length === 1) setGroupId(groups[0].id); }, [groups]);
  useEffect(() => {
    setPlayers([]);
    setSel([]);
    if (!groupId) return;
    call<Player[]>(`/api/groups/${groupId}/players`)
      .then((l) => { setPlayers(l); setSel(l.map((p) => p.id)); })
      .catch((e) => flash(msg(e)));
  }, [groupId, call, flash]);

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const n = sel.length;
  const starters = MOD[mod].n;
  const big = Math.ceil(n / 2);
  const small = Math.floor(n / 2);
  const bench = Math.max(0, big - starters);
  const gk = players.filter((p) => sel.includes(p.id) && p.pos === 'GK').length;
  const plan = n < 2 ? 'Elige al menos 2 jugadores.'
    : bench === 0 ? `${big} vs ${small} · sin suplentes`
      : `${big} vs ${small} · ${starters} titulares + ${bench} suplente${bench > 1 ? 's' : ''} por equipo`;
  const sorted = [...players].sort((a, b) => POS[a.pos].o - POS[b.pos].o || b.stars - a.stars);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await call<{ id: string }>('/api/matches', 'POST', {
        groupId, format: mod, playerIds: sel, location: venue.trim() || null,
        scheduledAt: new Date(`${date}T${time}`).toISOString(),
      });
      onCreated(r.id);
    } catch (e) {
      flash(e instanceof RangeError ? 'Revisa la fecha y la hora' : msg(e));
      setBusy(false);
    }
  };

  return (
    <>
      <Hdr eyebrow={`Paso ${step} de 2`} title={step === 1 ? 'Nuevo partido' : 'Convocatoria'} onBack={() => (step === 2 ? setStep(1) : onClose())} />
      <main className="main">
        {step === 1 ? (
          <>
            <div className="card form">
              <label htmlFor="d-group">Grupo</label>
              <select id="d-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Elige un grupo…</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.players} jugadores)</option>)}
              </select>
              {groups.length === 0 && <div className="warnbox" style={{ marginTop: 6 }}><Icon n="warn" /><span>Aún no tienes grupos. Créalos en la pestaña Plantilla.</span></div>}
            </div>
            {groupId && (
              <div className="card form">
                <div className="lbl">Modalidad</div>
                <div className="mods">
                  {Object.keys(MOD).map((k) => (
                    <button key={k} className={`modbtn${mod === k ? ' on' : ''}`} onClick={() => setMod(k)}>
                      <b>{MOD[k].short}</b><small>{MOD[k].label}</small>
                    </button>
                  ))}
                </div>
                <div className="two" style={{ marginTop: 8 }}>
                  <div><label htmlFor="d-date">Fecha</label><input id="d-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                  <div><label htmlFor="d-time">Hora</label><input id="d-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></div>
                </div>
                <label htmlFor="d-venue" style={{ marginTop: 6 }}>Lugar</label>
                <input id="d-venue" placeholder="Pista, polideportivo o dirección" value={venue} onChange={(e) => setVenue(e.target.value)} autoComplete="off" />
                <a className="maps" target="_blank" rel="noopener noreferrer" href={mapsUrl(venue)} hidden={!venue.trim()}><Icon n="pin" /> Ver en Google Maps</a>
              </div>
            )}
          </>
        ) : (
          <>
            <div className="card">
              <div className="counter">
                <b>{n}</b><span>convocados · {gk} portero{gk === 1 ? '' : 's'}</span>
                <button className="btn sm" onClick={() => setSel(players.map((p) => p.id))}>Todos</button>
                <button className="btn sm" onClick={() => setSel([])}>Ninguno</button>
              </div>
              <div className="plan">{plan}</div>
              {n >= 2 && gk < 2 && <div className="warnbox" style={{ marginTop: 10 }}><Icon n="warn" /><span>Necesitas 2 porteros para que cada equipo tenga el suyo.</span></div>}
            </div>
            {players.length === 0 && <div className="empty">Este grupo no tiene jugadores todavía. Añádelos en la pestaña Plantilla.</div>}
            {sorted.map((p) => {
              const on = sel.includes(p.id);
              return (
                <button key={p.id} className={`prow sel${on ? ' on' : ''}`} onClick={() => toggle(p.id)} aria-pressed={on}>
                  <span className="cb"><Icon n="check" /></span>
                  <Av name={p.name} />
                  <span className="pname"><b>{p.name}</b><small>{p.nick || POS[p.pos].label}</small></span>
                  <PosChip pos={p.pos} />
                  <span className="rate">{f1(p.stars)}</span>
                </button>
              );
            })}
          </>
        )}
      </main>
      <div className="foot">
        {step === 1 ? (
          <button className="btn primary" disabled={!groupId || !date || !time} onClick={() => setStep(2)}>Elegir jugadores</button>
        ) : (
          <>
            <button className="btn" onClick={() => setStep(1)}>Atrás</button>
            <button className="btn primary" disabled={n < 2 || busy} onClick={generate}>{busy ? 'Generando…' : 'Generar equipos'}</button>
          </>
        )}
      </div>
    </>
  );
}

/* ============================ Equipos de un partido ============================ */
function TeamPanel({ side, list, editable, anim, offset, onSwap }: {
  side: 'A' | 'B'; list: Entry[]; editable: boolean; anim: boolean; offset: number; onSwap: (eid: string) => void;
}) {
  const sorted = sortTeam(list);
  const starters = sorted.filter((p) => p.isStarter);
  const bench = sorted.filter((p) => !p.isStarter);
  const hasGk = sorted.some((p) => p.pos === 'GK');
  const other = side === 'A' ? 'B' : 'A';
  const row = (p: Entry, i: number) => (
    <div key={p.entryId} className={`trow${editable ? '' : ' ro'}${anim ? ' reveal' : ''}${p.isStarter ? '' : ' bench'}`}
      data-eid={p.entryId} style={{ '--i': i + offset } as CSSProperties}>
      {editable && <span className="grip" data-handle="1" title="Arrastra para cambiar de equipo"><Icon n="grip" /></span>}
      <Av name={p.name} />
      <span className="pname"><b>{p.name}</b><small>{p.nick || POS[p.pos].label}</small></span>
      <PosChip pos={p.pos} />
      <span className="rate">{f1(p.stars)}</span>
      {editable && <button className="iconbtn" onClick={() => onSwap(p.entryId)} aria-label={`Pasar a Equipo ${other}`}><Icon n="swap" /></button>}
    </div>
  );
  return (
    <section className={`team t${side}`} data-team={side}>
      <div className="thead">
        <h3>Equipo {side}</h3>
        <span className={`chip ${hasGk ? 'ok' : 'warn'}`}>{hasGk ? 'Con portero' : 'Sin portero'}</span>
        <span className="tcount">{sorted.length} jug. · {f1(sumOf(sorted))}★</span>
      </div>
      <div className="tlist">
        {bench.length > 0 && <div className="bsep" style={{ margin: '0 2px' }}>Titulares · {starters.length}</div>}
        {starters.map((p, i) => row(p, i))}
        {bench.length > 0 && <div className="bsep">Suplentes · {bench.length}</div>}
        {bench.map((p, i) => row(p, i + starters.length))}
      </div>
    </section>
  );
}

function MatchView({ id, startPack, call, flash, onBack, onChanged, openText, openResult }: {
  id: string; startPack: boolean; call: Call; flash: (m: string) => void; onBack: () => void; onChanged: () => void;
  openText: (t: string) => void;
  openResult: (info: { id: string; title: string; roster: Entry[]; scoreA: number | null; scoreB: number | null; mvp: string | null; onSaved: () => void }) => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [pack, setPack] = useState(startPack);
  const [opening, setOpening] = useState(false);
  const [anim, setAnim] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => call<Detail>(`/api/matches/${id}`).then(setD).catch((e) => flash(msg(e))), [call, id, flash]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!anim || pack) return;
    const t = setTimeout(() => setAnim(false), 1600);
    return () => clearTimeout(t);
  }, [anim, pack, animKey]);

  const reveal = () => { setPack(false); setAnim(true); setAnimKey((k) => k + 1); };
  const openPack = () => {
    if (opening) return;
    setOpening(true);
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(reveal, reduce ? 0 : 450);
  };

  const editable = !!d && d.status === 'pending' && !pack;

  const saveTeams = async (A: string[], B: string[]) => {
    setD((p) => (p ? { ...p, roster: p.roster.map((r) => ({ ...r, team: (A.includes(r.entryId) ? 'A' : 'B') as 'A' | 'B' })) } : p));
    try {
      setD(await call<Detail>(`/api/matches/${id}/teams`, 'PATCH', { A, B }));
      onChanged();
    } catch (e) {
      flash(msg(e));
      load();
    }
  };

  const applyMove = (eid: string, t: { rowEid?: string; team?: 'A' | 'B' }) => {
    if (!d) return;
    const me = d.roster.find((r) => r.entryId === eid);
    if (!me) return;
    let A = d.roster.filter((r) => r.team === 'A').map((r) => r.entryId);
    let B = d.roster.filter((r) => r.team === 'B').map((r) => r.entryId);
    if (t.rowEid) {
      const o = d.roster.find((r) => r.entryId === t.rowEid);
      if (!o || o.team === me.team) return;
      const swap = (l: string[]) => l.map((x) => (x === eid ? o.entryId : x === o.entryId ? eid : x));
      A = swap(A);
      B = swap(B);
      flash('Intercambio hecho');
    } else if (t.team && t.team !== me.team) {
      A = A.filter((x) => x !== eid);
      B = B.filter((x) => x !== eid);
      (t.team === 'A' ? A : B).push(eid);
    } else return;
    saveTeams(A, B);
  };
  const moveRef = useRef(applyMove);
  moveRef.current = applyMove;

  // arrastrar y soltar (ratón y táctil)
  useEffect(() => {
    if (!editable) return;
    type Drag = { eid: string; ghost: HTMLElement; row: HTMLElement; dx: number; dy: number };
    let drag: Drag | null = null;
    const clearOver = () => document.querySelectorAll('.over').forEach((n) => n.classList.remove('over'));
    const hit = (e: PointerEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      let row = (el?.closest('.trow') as HTMLElement | null) ?? null;
      if (row && drag && row.dataset.eid === drag.eid) row = null;
      const team = (el?.closest('[data-team]') as HTMLElement | null) ?? null;
      return { row, team };
    };
    const down = (e: PointerEvent) => {
      const g = (e.target as Element | null)?.closest('[data-handle]');
      if (!g || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const row = g.closest('.trow') as HTMLElement | null;
      if (!row) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      const ghost = row.cloneNode(true) as HTMLElement;
      ghost.classList.remove('reveal');
      ghost.classList.add('ghost');
      ghost.style.width = r.width + 'px';
      ghost.style.left = r.left + 'px';
      ghost.style.top = r.top + 'px';
      document.body.appendChild(ghost);
      row.classList.add('dragging');
      drag = { eid: row.dataset.eid || '', ghost, row, dx: e.clientX - r.left, dy: e.clientY - r.top };
    };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      e.preventDefault();
      drag.ghost.style.left = e.clientX - drag.dx + 'px';
      drag.ghost.style.top = e.clientY - drag.dy + 'px';
      const mn = document.querySelector('.main');
      if (mn) {
        const mr = mn.getBoundingClientRect();
        if (e.clientY < mr.top + 50) mn.scrollTop -= 10;
        else if (e.clientY > mr.bottom - 50) mn.scrollTop += 10;
      }
      clearOver();
      const h = hit(e);
      if (h.row) h.row.classList.add('over');
      else if (h.team) h.team.classList.add('over');
    };
    const end = (e: PointerEvent | null) => {
      if (!drag) return;
      const h = e ? hit(e) : { row: null, team: null };
      const eid = drag.eid;
      drag.ghost.remove();
      drag.row.classList.remove('dragging');
      clearOver();
      drag = null;
      if (e) moveRef.current(eid, { rowEid: h.row?.dataset.eid, team: h.team?.dataset.team as 'A' | 'B' | undefined });
    };
    const up = (e: PointerEvent) => end(e);
    const cancel = () => end(null);
    document.addEventListener('pointerdown', down);
    document.addEventListener('pointermove', move, { passive: false });
    document.addEventListener('pointerup', up);
    document.addEventListener('pointercancel', cancel);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      document.removeEventListener('pointercancel', cancel);
      if (drag) { drag.ghost.remove(); drag.row.classList.remove('dragging'); }
      clearOver();
    };
  }, [editable]);

  const regenerate = async () => {
    setBusy(true);
    try {
      setD(await call<Detail>(`/api/matches/${id}/regenerate`, 'POST'));
      setAnim(true);
      setAnimKey((k) => k + 1);
      flash('Equipos regenerados');
      onChanged();
    } catch (e) {
      flash(msg(e));
    } finally {
      setBusy(false);
    }
  };
  const cancelMatch = async () => {
    if (!confirm('¿Cancelar este partido? Esta acción no se puede deshacer.')) return;
    try {
      await call(`/api/matches/${id}/cancel`, 'POST');
      flash('Partido cancelado');
      onChanged();
      onBack();
    } catch (e) {
      flash(msg(e));
    }
  };
  const copy = () => {
    if (!d) return;
    const txt = lineupText(d);
    const fallback = () => openText(txt);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => flash('Alineación copiada'), fallback);
      else fallback();
    } catch { fallback(); }
  };

  /* ---- sobre ---- */
  if (pack) {
    return (
      <>
        <Hdr eyebrow="Equilibrio FC" title="Tu sobre" onBack={onBack} />
        <main className="main">
          <div className="packwrap">
            <button className={`pack${opening ? ' open' : ''}`} onClick={openPack} aria-label="Abrir el sobre de equipos">
              <svg viewBox="0 0 120 160" fill="none" stroke="#3fdc78" strokeWidth="1.2"><rect x="8" y="8" width="104" height="144" rx="4" /><path d="M8 80h104" /><circle cx="60" cy="80" r="16" /><rect x="34" y="8" width="52" height="24" /><rect x="34" y="128" width="52" height="24" /></svg>
              <span className="pk"><b>EQUIPOS</b><small>{d ? `${MOD[d.format]?.label ?? d.format} · ${d.roster.length} jugadores` : 'Preparando…'}</small></span>
            </button>
            <p>Toca el sobre para ver los equipos</p>
            <button className="btn ghost sm" onClick={reveal}>Saltar animación</button>
          </div>
        </main>
      </>
    );
  }

  if (!d) {
    return (<><Hdr eyebrow="Equilibrio FC" title="Equipos" onBack={onBack} /><main className="main"><div className="empty">Cargando…</div></main></>);
  }

  const A = d.roster.filter((r) => r.team === 'A');
  const B = d.roster.filter((r) => r.team === 'B');
  const a = sumOf(A);
  const b = sumOf(B);
  const meanA = A.length ? a / A.length : 0;
  const meanB = B.length ? b / B.length : 0;
  const diff = Math.abs(meanA - meanB) * ((A.length + B.length) / 2); // equivale a la diferencia de suma cuando hay el mismo nº de jugadores
  const pct = meanA + meanB > 0 ? (meanA / (meanA + meanB)) * 100 : 50;
  const verdict: [string, string] = diff < 0.05 ? ['ok', 'Igualados']
    : diff <= 0.5 ? ['ok', `Equilibrado · dif. ${f1(diff)}★`]
      : diff <= 1.5 ? ['mid', `Ligera ventaja del ${meanA > meanB ? 'A' : 'B'} · dif. ${f1(diff)}★`]
        : ['bad', `Descompensado · dif. ${f1(diff)}★`];
  const warnings: string[] = [];
  if (!A.some((p) => p.pos === 'GK') && B.some((p) => p.pos === 'GK')) warnings.push('El Equipo A no tiene portero.');
  if (!B.some((p) => p.pos === 'GK') && A.some((p) => p.pos === 'GK')) warnings.push('El Equipo B no tiene portero.');
  if (!d.roster.some((p) => p.pos === 'GK')) warnings.push('No hay porteros en la convocatoria.');
  if (Math.abs(A.length - B.length) > 1) warnings.push(`Los equipos tienen distinto número de jugadores (${A.length} y ${B.length}).`);
  const mvp = d.mvpEntryId ? d.roster.find((r) => r.entryId === d.mvpEntryId) : undefined;
  const finished = d.status === 'finished';

  const askResult = () =>
    openResult({
      id: d.id, title: `${d.groupName} · ${cap1(fmtD(d.scheduledAt, { weekday: 'long', day: 'numeric', month: 'long' }))}`,
      roster: d.roster, scoreA: d.scoreA, scoreB: d.scoreB, mvp: d.mvpEntryId, onSaved: () => { load(); onChanged(); },
    });

  return (
    <>
      <Hdr eyebrow={`Equilibrio FC · ${d.groupName}`} title="Equipos" onBack={onBack} />
      <main className="main">
        <div className="card minfo2">
          <b>{cap1(fmtD(d.scheduledAt, { weekday: 'long', day: 'numeric', month: 'long' }))} · {hhmm(d.scheduledAt)}</b>
          <span>{MOD[d.format]?.label ?? d.format} · {d.location || 'Sin lugar'}</span>
          {d.location && <a className="maps" target="_blank" rel="noopener noreferrer" href={mapsUrl(d.location)}><Icon n="pin" /> Ver en Google Maps</a>}
        </div>

        {d.status === 'cancelled' && <div className="alert err">Este partido está cancelado.</div>}
        {finished && d.needsResult && (
          <div className="alert">
            <b>El partido ya se ha jugado. ¡Vota al MVP y registra el resultado!</b>
            <button className="btn primary sm" onClick={askResult} style={{ alignSelf: 'flex-start' }}>Registrar resultado y MVP</button>
          </div>
        )}
        {finished && d.scoreA !== null && (
          <div className="card stack" style={{ display: 'grid', gap: 10 }}>
            <div className="resbox">
              <div className="big"><span className="a">{d.scoreA}</span> – <span className="b">{d.scoreB}</span></div>
              <button className="btn sm" onClick={askResult}>Editar</button>
            </div>
            {mvp && <div className="mvpline"><Av name={mvp.name} /><span>🏆 MVP: {mvp.name}{mvp.nick ? ` (${mvp.nick})` : ''}</span></div>}
          </div>
        )}

        <div className="card meter">
          <div className="mrow">
            <div className="ta"><small>Equipo A</small>{f1(a)}★<span className="avg">media {meanA.toFixed(2)}</span></div>
            <div className={`verdict ${verdict[0]}`}>{verdict[1]}</div>
            <div className="tb"><small>Equipo B</small>{f1(b)}★<span className="avg">media {meanB.toFixed(2)}</span></div>
          </div>
          <div className="barwrap"><div className="bar"><i className="ba" style={{ width: pct + '%' }} /><i className="bb" /></div><u /></div>
        </div>
        {warnings.map((w) => <div key={w} className="warnbox"><Icon n="warn" /><span>{w}</span></div>)}

        <TeamPanel side="A" list={A} editable={editable} anim={anim} offset={0} onSwap={(eid) => applyMove(eid, { team: 'B' })} />
        <TeamPanel side="B" list={B} editable={editable} anim={anim} offset={A.length} onSwap={(eid) => applyMove(eid, { team: 'A' })} />

        {editable && (
          <div className="note"><Icon n="lock" /><span>Arrastra el icono de la izquierda o usa el botón de flechas para cambiar a alguien de equipo. Si sueltas sobre otro jugador, se intercambian.</span></div>
        )}
        {d.status === 'pending' && <button className="btn danger block" onClick={cancelMatch}>Cancelar partido</button>}
      </main>
      <div className="foot">
        {d.status === 'pending' && <button className="btn" onClick={regenerate} disabled={busy}><Icon n="shuffle" /> Regenerar</button>}
        <button className="btn primary" onClick={copy}><Icon n="copy" /> Copiar alineación</button>
      </div>
    </>
  );
}

/* ================================== Hojas ================================== */
function PlayerSheet({ init, groupId, call, flash, onClose, onDone }: {
  init: PlayerInit; groupId: string; call: Call; flash: (m: string) => void; onClose: () => void; onDone: () => void;
}) {
  const [s, setS] = useState(init);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!init.id) nameRef.current?.focus(); }, [init.id]);

  const save = async () => {
    if (!s.name.trim()) { flash('Escribe un nombre'); nameRef.current?.focus(); return; }
    setBusy(true);
    try {
      const body = { name: s.name.trim(), nick: s.nick.trim(), pos: s.pos, stars: s.stars };
      if (s.id) await call(`/api/groups/${groupId}/players/${s.id}`, 'PATCH', body);
      else await call(`/api/groups/${groupId}/players`, 'POST', body);
      flash('Jugador guardado');
      onDone();
    } catch (e) { flash(msg(e)); setBusy(false); }
  };
  const del = async () => {
    if (!s.id) return;
    if (!confirmDel) { setConfirmDel(true); return; }
    try {
      await call(`/api/groups/${groupId}/players/${s.id}`, 'DELETE');
      flash('Jugador quitado del grupo (sigue en el historial)');
      onDone();
    } catch (e) { flash(msg(e)); }
  };

  return (
    <SheetShell title={s.id ? 'Editar jugador' : 'Nuevo jugador'} onClose={onClose}>
      <label htmlFor="f-name">Nombre</label>
      <input id="f-name" ref={nameRef} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} autoComplete="off" />
      <label htmlFor="f-nick" style={{ marginTop: 6 }}>Apodo (opcional)</label>
      <input id="f-nick" value={s.nick} onChange={(e) => setS({ ...s, nick: e.target.value })} autoComplete="off" />
      <div className="lbl" style={{ marginTop: 6 }}>Posición principal</div>
      <div className="seg">
        {(['GK', 'DEF', 'ATT'] as Pos[]).map((k) => (
          <button key={k} className={s.pos === k ? 'on' : ''} onClick={() => setS({ ...s, pos: k })}>{POS[k].label}</button>
        ))}
      </div>
      <div className="lbl" style={{ marginTop: 6 }}>Valoración<span className="lockt"><Icon n="lock" /> solo la ves tú</span></div>
      <div className="starbox"><Stars v={s.stars} size={34} onPick={(v) => setS({ ...s, stars: Math.max(1, v) })} /><b className="big">{f1(s.stars)}</b></div>
      <div className="sheet-actions">
        {s.id && <button className="btn danger" onClick={del}>{confirmDel ? 'Pulsa otra vez' : 'Quitar del grupo'}</button>}
        <button className="btn primary" onClick={save} disabled={busy}>Guardar</button>
      </div>
    </SheetShell>
  );
}

function ResultSheet({ s, call, flash, onClose }: {
  s: Extract<SheetState, { t: 'result' }>; call: Call; flash: (m: string) => void; onClose: () => void;
}) {
  const [a, setA] = useState(s.scoreA ?? 0);
  const [b, setB] = useState(s.scoreB ?? 0);
  const [mvp, setMvp] = useState(s.mvp ?? '');
  const save = async () => {
    try {
      await call(`/api/matches/${s.id}/result`, 'POST', { scoreA: a, scoreB: b, mvpEntryId: mvp || undefined });
      flash('Resultado guardado ✅');
      s.onSaved();
      onClose();
    } catch (e) { flash(msg(e)); }
  };
  const list = [...s.roster].sort((x, y) => x.team.localeCompare(y.team) || x.name.localeCompare(y.name));
  return (
    <SheetShell title="Resultado y MVP" onClose={onClose}>
      <div className="note" style={{ marginBottom: 6 }}><span>{s.title}</span></div>
      <div className="two">
        <div><label htmlFor="r-a" style={{ color: 'var(--grass)' }}>Equipo A</label><input id="r-a" type="number" inputMode="numeric" min={0} max={99} value={a} onChange={(e) => setA(Number(e.target.value))} /></div>
        <div><label htmlFor="r-b" style={{ color: 'var(--sky)' }}>Equipo B</label><input id="r-b" type="number" inputMode="numeric" min={0} max={99} value={b} onChange={(e) => setB(Number(e.target.value))} /></div>
      </div>
      <label htmlFor="r-mvp" style={{ marginTop: 6 }}>MVP del partido</label>
      <select id="r-mvp" value={mvp} onChange={(e) => setMvp(e.target.value)}>
        <option value="">Sin MVP</option>
        {list.map((r) => <option key={r.entryId} value={r.entryId}>{r.name} (Equipo {r.team})</option>)}
      </select>
      <div className="sheet-actions"><button className="btn primary" onClick={save}>Guardar</button></div>
    </SheetShell>
  );
}

function GroupSheet({ call, flash, onClose, onDone }: { call: Call; flash: (m: string) => void; onClose: () => void; onDone: (id: string) => void | Promise<void> }) {
  const [name, setName] = useState('');
  const save = async () => {
    try {
      const g = await call<{ id: string }>('/api/groups', 'POST', { name });
      flash('Grupo creado');
      onDone(g.id);
    } catch (e) { flash(msg(e)); }
  };
  return (
    <SheetShell title="Nuevo grupo" onClose={onClose}>
      <label htmlFor="g-name">Nombre del grupo</label>
      <input id="g-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Fútbol Jueves" autoComplete="off" autoFocus />
      <div className="sheet-actions"><button className="btn primary" disabled={!name.trim()} onClick={save}>Crear grupo</button></div>
    </SheetShell>
  );
}

function ExistingSheet({ groupId, call, flash, onClose, onDone }: {
  groupId: string; call: Call; flash: (m: string) => void; onClose: () => void; onDone: () => void;
}) {
  const [all, setAll] = useState<{ id: string; name: string; groupIds: string[] }[] | null>(null);
  const [pid, setPid] = useState('');
  const [stars, setStars] = useState(3);
  useEffect(() => {
    call<{ id: string; name: string; groupIds: string[] }[]>('/api/players').then(setAll).catch((e) => { flash(msg(e)); setAll([]); });
  }, [call, flash]);
  const others = (all ?? []).filter((p) => !p.groupIds.includes(groupId));
  const save = async () => {
    try {
      await call(`/api/groups/${groupId}/players`, 'POST', { playerId: pid, stars });
      flash('Jugador añadido al grupo');
      onDone();
    } catch (e) { flash(msg(e)); }
  };
  return (
    <SheetShell title="Jugador de otro grupo" onClose={onClose}>
      {all === null ? <div className="note">Cargando…</div> : others.length === 0 ? (
        <div className="empty">No hay jugadores de otros grupos que añadir.</div>
      ) : (
        <>
          <label htmlFor="e-sel">Jugador</label>
          <select id="e-sel" value={pid} onChange={(e) => setPid(e.target.value)}>
            <option value="">Elige un jugador…</option>
            {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <div className="lbl" style={{ marginTop: 6 }}>Valoración en este grupo</div>
          <div className="starbox"><Stars v={stars} size={34} onPick={(v) => setStars(Math.max(1, v))} /><b className="big">{f1(stars)}</b></div>
          <div className="sheet-actions"><button className="btn primary" disabled={!pid} onClick={save}>Añadir al grupo</button></div>
        </>
      )}
    </SheetShell>
  );
}

function TextSheet({ text, onClose }: { text: string; onClose: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select(); }, []);
  return (
    <SheetShell title="Alineación" onClose={onClose}>
      <label htmlFor="f-text">Selecciona y copia el texto</label>
      <textarea id="f-text" ref={ref} readOnly defaultValue={text} />
      <div className="sheet-actions"><button className="btn primary" onClick={onClose}>Hecho</button></div>
    </SheetShell>
  );
}

/* ================================ Pestañas ================================ */
function SquadTab({ groups, groupId, setGroupId, call, flash, version, openPlayer, openGroup, openExisting }: {
  groups: Group[]; groupId: string; setGroupId: (id: string) => void; call: Call; flash: (m: string) => void; version: number;
  openPlayer: (p: PlayerInit) => void; openGroup: () => void; openExisting: () => void;
}) {
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [filter, setFilter] = useState<'ALL' | Pos>('ALL');
  useEffect(() => {
    if (!groupId) { setPlayers([]); return; }
    setPlayers(null);
    call<Player[]>(`/api/groups/${groupId}/players`).then(setPlayers).catch((e) => { flash(msg(e)); setPlayers([]); });
  }, [groupId, call, flash, version]);

  const all = players ?? [];
  const list = all.filter((p) => filter === 'ALL' || p.pos === filter).sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name));
  const gk = all.filter((p) => p.pos === 'GK').length;
  const avg = all.length ? all.reduce((s, p) => s + p.stars, 0) / all.length : 0;

  return (
    <>
      <div className="gbar">
        <GroupSelect groups={groups} value={groupId} onChange={setGroupId} />
        <button className="btn sm" style={{ height: 46 }} onClick={openGroup}><Icon n="plus" /> Grupo</button>
      </div>
      {groups.length === 0 ? (
        <div className="empty">Crea tu primer grupo, por ejemplo “Fútbol Jueves”, y añade a sus jugadores.</div>
      ) : (
        <>
          <div className="note"><Icon n="lock" /><span>{all.length} jugadores · {gk} porteros · media {f1(avg)}★. Las estrellas solo las ves tú.</span></div>
          <div className="filters">
            {([['ALL', 'Todos'], ['GK', 'Porteros'], ['DEF', 'Defensas'], ['ATT', 'Atacantes']] as [string, string][]).map(([k, l]) => (
              <button key={k} className={`fchip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k as 'ALL' | Pos)}>{l}</button>
            ))}
          </div>
          {players === null ? <div className="empty">Cargando…</div> : list.length === 0 ? (
            <div className="empty">Todavía no hay jugadores aquí. Pulsa “Jugador” para añadir el primero.</div>
          ) : list.map((p) => (
            <button key={p.id} className="prow" onClick={() => openPlayer({ id: p.id, name: p.name, nick: p.nick ?? '', pos: p.pos, stars: Math.min(5, Math.max(1, p.stars)) })}>
              <Av name={p.name} />
              <span className="pname"><b>{p.name}</b><small>{p.nick || POS[p.pos].label}</small></span>
              <PosChip pos={p.pos} />
              <span><Stars v={p.stars} size={13} /></span>
            </button>
          ))}
          <button className="btn block" onClick={openExisting}>Añadir jugador de otro grupo</button>
        </>
      )}
    </>
  );
}

const ADJ_KEY = 'eqfc-adj';
function readAdj(): string[] {
  try { return JSON.parse(localStorage.getItem(ADJ_KEY) || '[]'); } catch { return []; }
}

function StatsTab({ groups, groupId, setGroupId, call, flash, version, onAdjusted }: {
  groups: Group[]; groupId: string; setGroupId: (id: string) => void; call: Call; flash: (m: string) => void; version: number; onAdjusted: () => void;
}) {
  const [rows, setRows] = useState<StatRow[] | null>(null);
  const [done, setDone] = useState<string[]>([]);
  useEffect(() => { setDone(readAdj()); }, []);
  useEffect(() => {
    if (!groupId) { setRows([]); return; }
    setRows(null);
    call<StatRow[]>(`/api/stats?groupId=${groupId}`).then(setRows).catch((e) => { flash(msg(e)); setRows([]); });
  }, [groupId, call, flash, version]);

  const all = rows ?? [];
  const ranked = all.filter((p) => p.pj > 0).sort((a, b) => b.w / b.pj - a.w / a.pj || b.pj - a.pj);
  const keyOf = (p: StatRow) => `${groupId}:${p.playerId}:${p.pj}`;
  const adj: { p: StatRow; d: number; why: string }[] = [];
  all.forEach((p) => {
    if (!p.pj || done.includes(keyOf(p))) return;
    const r = p.w / p.pj;
    if (((p.pj >= 15 && r >= 0.62) || p.mvp >= 3) && p.stars < 5) adj.push({ p, d: 0.5, why: p.mvp >= 3 ? `Ha sido MVP ${p.mvp} veces` : `Gana el ${Math.round(r * 100)}% de sus partidos` });
    else if (p.pj >= 10 && r <= 0.25 && p.stars > 1) adj.push({ p, d: -0.5, why: `Gana solo el ${Math.round(r * 100)}% de sus partidos` });
  });

  const apply = async (p: StatRow, d: number) => {
    try {
      const stars = Math.min(5, Math.max(1, p.stars + d));
      await call(`/api/groups/${groupId}/players/${p.playerId}`, 'PATCH', { stars });
      const next = [...done, keyOf(p)];
      setDone(next);
      try { localStorage.setItem(ADJ_KEY, JSON.stringify(next)); } catch { /* sin almacenamiento */ }
      flash(`${p.name} pasa a ${f1(stars)}★`);
      onAdjusted();
    } catch (e) { flash(msg(e)); }
  };

  return (
    <>
      <GroupSelect groups={groups} value={groupId} onChange={setGroupId} />
      {rows === null ? <div className="empty">Cargando…</div> : (
        <>
          {adj.length > 0 && (
            <>
              <h2 className="sec">Ajustes sugeridos</h2>
              <div className="card">
                {adj.map(({ p, d, why }) => (
                  <div className="arow" key={p.playerId}>
                    <Av name={p.name} />
                    <span className="pname"><b>{p.name}</b><small className="why">{why}</small></span>
                    <button className="btn sm" onClick={() => apply(p, d)}>
                      <span className={`delta${d < 0 ? ' dn' : ''}`}>{d > 0 ? '+' : '−'}½★</span> {f1(p.stars)} → {f1(p.stars + d)}
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
          <h2 className="sec">Ranking del grupo</h2>
          {ranked.length === 0 ? (
            <div className="empty">Aún no hay partidos con resultado en este grupo. Registra los resultados desde el Historial.</div>
          ) : (
            <div className="card">
              {ranked.map((p, i) => {
                const r = Math.round((p.w / p.pj) * 100);
                return (
                  <div className="rrow" key={p.playerId}>
                    <span className="rk">{i + 1}</span>
                    <Av name={p.name} />
                    <span className="pname">
                      <span className="nm"><b>{p.name}</b>{p.mvp > 0 && <span className="chip gk">MVP ×{p.mvp}</span>}</span>
                      <span className="wbar"><i style={{ width: r + '%' }} /></span>
                    </span>
                    <span className="pct"><b>{r}%</b><small>{p.w} de {p.pj}</small></span>
                  </div>
                );
              })}
            </div>
          )}
          <div className="note"><Icon n="stats" /><span>Calculado con los partidos finalizados que tienen resultado. Las sugerencias se basan en victorias y votos MVP.</span></div>
        </>
      )}
    </>
  );
}

/* ================================ Principal ================================ */
const TITLES: Record<Tab, string> = { matches: 'Partidos', history: 'Historial', squad: 'Plantilla', stats: 'Estadísticas' };

function Main({ apiKey, onLogout }: { apiKey: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('matches');
  const [view, setView] = useState<View>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [pending, setPending] = useState<MatchRow[]>([]);
  const [history, setHistory] = useState<HistRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [groupId, setGroupId] = useState('');
  const [version, setVersion] = useState(0);

  const call: Call = useCallback(<T,>(path: string, method = 'GET', body?: unknown) => api<T>(apiKey, path, method, body), [apiKey]);
  const flash = useCallback((m: string) => setToastMsg(m), []);
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(''), 2600);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const refresh = useCallback(async () => {
    try {
      const [g, p, h] = await Promise.all([call<Group[]>('/api/groups'), call<MatchRow[]>('/api/matches'), call<HistRow[]>('/api/history')]);
      setGroups(g); setPending(p); setHistory(h); setError(''); setLoaded(true);
    } catch (e) {
      if (e instanceof AuthError) onLogout();
      else setError(msg(e));
    }
  }, [call, onLogout]);

  // Refresco cada 30 s: un partido pasa solo de "Partidos" al "Historial" cuando llega su hora.
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (groups.length && !groups.some((g) => g.id === groupId)) setGroupId(groups[0].id);
  }, [groups, groupId]);

  const toResult = history.filter((h) => h.needsResult);
  const groupName = groups.find((g) => g.id === groupId)?.name;
  const bump = () => { setVersion((v) => v + 1); refresh(); };

  let screen: ReactNode;
  if (view && view.t === 'new') {
    screen = (
      <NewMatch groups={groups} call={call} flash={flash} onClose={() => setView(null)}
        onCreated={(id) => { setView({ t: 'match', id, pack: true }); setTab('matches'); refresh(); }} />
    );
  } else if (view && view.t === 'match') {
    screen = (
      <MatchView key={view.id} id={view.id} startPack={!!view.pack} call={call} flash={flash}
        onBack={() => { setView(null); refresh(); }} onChanged={refresh}
        openText={(text) => setSheet({ t: 'text', text })}
        openResult={(info) => setSheet({ t: 'result', ...info })} />
    );
  } else {
    const eyebrow = (tab === 'squad' || tab === 'stats') && groupName ? `Equilibrio FC · ${groupName}` : 'Equilibrio FC';
    screen = (
      <>
        <Hdr eyebrow={eyebrow} title={TITLES[tab]} right={
          tab === 'squad' && groupId ? (
            <button className="btn primary sm" onClick={() => setSheet({ t: 'player', init: { name: '', nick: '', pos: 'DEF', stars: 3 } })}><Icon n="plus" /> Jugador</button>
          ) : undefined
        } />
        <main className="main" key={tab}>
          {error && <div className="alert err">No se pudo conectar con el servidor: {error}</div>}
          {toResult.length > 0 && tab !== 'history' && (
            <div className="alert">
              <b>El partido ya se ha jugado. ¡Vota al MVP y registra el resultado!</b>
              <span>{toResult.length === 1 ? '1 partido espera' : `${toResult.length} partidos esperan`} resultado.</span>
              <button className="btn primary sm" style={{ alignSelf: 'flex-start' }} onClick={() => setTab('history')}>Ir al Historial</button>
            </div>
          )}

          {tab === 'matches' && (
            <>
              <button className="btn primary block" onClick={() => setView({ t: 'new' })}><Icon n="plus" /> Nuevo partido</button>
              <h2 className="sec">Próximos</h2>
              {!loaded ? <div className="empty">Cargando…</div> : pending.length === 0 ? (
                <div className="empty">No hay partidos próximos. Crea uno y deja que la app reparta los equipos.</div>
              ) : pending.map((m) => (
                <MatchCard key={m.id} m={m} count={m.playersCount} right={<Icon n="chev" />} onOpen={() => setView({ t: 'match', id: m.id })} />
              ))}
            </>
          )}

          {tab === 'history' && (
            !loaded ? <div className="empty">Cargando…</div> : history.length === 0 ? (
              <div className="empty">Todavía no hay partidos jugados. Aparecerán aquí cuando pase su hora.</div>
            ) : history.map((m) => (
              <MatchCard key={m.id} m={m} played onOpen={() => setView({ t: 'match', id: m.id })}
                right={m.needsResult ? <span className="chip warn">Sin resultado</span> : <span className="score">{m.scoreA}–{m.scoreB}</span>} />
            ))
          )}

          {tab === 'squad' && (
            <SquadTab groups={groups} groupId={groupId} setGroupId={setGroupId} call={call} flash={flash} version={version}
              openPlayer={(init) => setSheet({ t: 'player', init })} openGroup={() => setSheet({ t: 'group' })} openExisting={() => setSheet({ t: 'existing' })} />
          )}
          {tab === 'stats' && (
            <StatsTab groups={groups} groupId={groupId} setGroupId={setGroupId} call={call} flash={flash} version={version} onAdjusted={bump} />
          )}

          {tab === 'matches' && <button className="btn ghost sm" onClick={onLogout} style={{ alignSelf: 'center' }}>Cerrar sesión</button>}
        </main>
        <nav className="nav" aria-label="Secciones">
          {(['matches', 'history', 'squad', 'stats'] as Tab[]).map((k) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} aria-label={TITLES[k]}>
              <Icon n={k} />{TITLES[k]}{k === 'history' && toResult.length > 0 && <span className="dot">{toResult.length}</span>}
            </button>
          ))}
        </nav>
      </>
    );
  }

  return (
    <div className="app">
      {screen}
      {sheet && sheet.t === 'player' && (
        <PlayerSheet key={sheet.init.id ?? 'new'} init={sheet.init} groupId={groupId} call={call} flash={flash} onClose={() => setSheet(null)}
          onDone={() => { setSheet(null); bump(); }} />
      )}
      {sheet && sheet.t === 'group' && (
        <GroupSheet call={call} flash={flash} onClose={() => setSheet(null)} onDone={async (id) => { setSheet(null); await refresh(); setGroupId(id); }} />
      )}
      {sheet && sheet.t === 'existing' && (
        <ExistingSheet groupId={groupId} call={call} flash={flash} onClose={() => setSheet(null)} onDone={() => { setSheet(null); bump(); }} />
      )}
      {sheet && sheet.t === 'text' && <TextSheet text={sheet.text} onClose={() => setSheet(null)} />}
      {sheet && sheet.t === 'result' && <ResultSheet s={sheet} call={call} flash={flash} onClose={() => setSheet(null)} />}
      <div className={`toast${toastMsg ? ' show' : ''}`} role="status">{toastMsg}</div>
    </div>
  );
}

export default function App() {
  const [key, setKey] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { setKey(localStorage.getItem('futbol-key')); } catch { /* sin almacenamiento */ }
    setReady(true);
  }, []);
  const login = (k: string) => {
    try { localStorage.setItem('futbol-key', k); } catch { /* sin almacenamiento */ }
    setKey(k);
  };
  const logout = useCallback(() => {
    try { localStorage.removeItem('futbol-key'); } catch { /* sin almacenamiento */ }
    setKey(null);
  }, []);
  if (!ready) return null;
  if (!key) return <Login onLogin={login} />;
  return <Main apiKey={key} onLogout={logout} />;
}
