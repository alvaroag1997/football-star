'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';

/* ============================== tipos ============================== */
type Group = { id: string; name: string; players: number };
type GPlayer = { id: string; name: string; photoUrl: string | null; stars: number };
type P = { id: string; name: string; photo: string | null; stars: number };
type Side = { starters: P[]; bench: P[]; sum: number; mean: number };
type Preview = { teamA: Side; teamB: Side; stats: { diffSum: number; diffMean: number; sizeA: number; sizeB: number } };
type Balance = { sumA: number; sumB: number; meanA: number; meanB: number; diffSum: number; diffMean: number } | null;
type MatchRow = {
  id: string; groupId: string; groupName: string; scheduledAt: string; location: string | null;
  format: string; startersPerSide: number; status: string; balanceStats: Balance; playersCount: number;
};
type Entry = { entryId: string; name: string; stars: number; photo: string | null; team: 'A' | 'B'; isStarter: boolean };
type Detail = MatchRow & { roster: Entry[] };
type HistRow = {
  id: string; groupName: string; scheduledAt: string; location: string | null; format: string;
  scoreA: number | null; scoreB: number | null; needsResult: boolean; balanceStats: Balance;
  mvpName: string | null; mvpPhoto: string | null; roster: Entry[];
};
type Call = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Tab = 'partidos' | 'historial' | 'grupos';

const STARTERS: Record<string, number> = { '5v5': 5, '7v7': 7, '11v11': 11 };
const FORMAT_LABEL: Record<string, string> = { '5v5': 'Fútbol sala · 5', '7v7': 'Fútbol 7', '11v11': 'Fútbol 11' };

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

/* ============================ utilidades ============================ */
const num = (n: number, d = 1) => n.toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const when = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Algo ha fallado');

function defaultWhen() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(21, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ============================ piezas UI ============================ */
function Avatar({ name, photo }: { name: string; photo: string | null }) {
  if (photo) return <img className="av" src={photo} alt="" />;
  const ini = name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  return <span className="av">{ini}</span>;
}

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-h">
          <h2>{title}</h2>
          <button className="x" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <div className="stack">{children}</div>
      </div>
    </div>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const set = (v: number) => onChange(Math.min(10, Math.max(0, v)));
  return (
    <span className="step">
      <button onClick={() => set(value - 0.5)} aria-label="Menos">−</button>
      <output>{num(value)} ★</output>
      <button onClick={() => set(value + 0.5)} aria-label="Más">+</button>
    </span>
  );
}

function Roster({ roster }: { roster: Entry[] }) {
  return (
    <div className="teams">
      {(['A', 'B'] as const).map((t) => {
        const list = roster.filter((r) => r.team === t);
        const sum = list.reduce((a, r) => a + r.stars, 0);
        return (
          <div key={t} className={`team team-${t}`}>
            <h4>Equipo {t}</h4>
            <div className="meta">{num(sum)} ★ · media {num(sum / (list.length || 1), 2)} · {list.length} jug.</div>
            <ul>
              {list.map((r) => (
                <li key={r.entryId} className={r.isStarter ? '' : 'sub'}>
                  <Avatar name={r.name} photo={r.photo} />
                  <span>{r.name}</span>
                  {!r.isStarter && <em className="bench">SUP</em>}
                  <b>{num(r.stars)}</b>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function BalanceLine({ b }: { b: Balance }) {
  if (!b) return null;
  return (
    <div className="stats">
      <span>Dif. suma: {num(b.diffSum, 2)}</span>
      <span>Dif. media: {num(b.diffMean, 2)}</span>
    </div>
  );
}

/* ================================ Login ================================ */
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
    <div className="login">
      <div>
        <div className="eyebrow">Equilibrio FC</div>
        <h1>Entrar</h1>
      </div>
      <p className="muted">Introduce tu clave de administrador (la que pusiste en <b>ADMIN_API_KEY</b> en Vercel).</p>
      <label className="field">
        <span>Clave de administrador</span>
        <input type="password" value={k} onChange={(e) => setK(e.target.value)} autoComplete="current-password" />
      </label>
      {err && <div className="banner err">{err}</div>}
      <button className="btn" disabled={!k.trim() || busy} onClick={go}>{busy ? 'Comprobando…' : 'Entrar'}</button>
    </div>
  );
}

/* ============================ Crear partido ============================ */
function CreateMatch({ groups, call, onClose, onCreated, flash }: {
  groups: Group[]; call: Call; onClose: () => void; onCreated: () => void; flash: (m: string) => void;
}) {
  const [groupId, setGroupId] = useState('');
  const [players, setPlayers] = useState<GPlayer[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [date, setDate] = useState(defaultWhen());
  const [place, setPlace] = useState('');
  const [format, setFormat] = useState('5v5');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSel([]);
    setPreview(null);
    setPlayers([]);
    if (!groupId) return;
    call<GPlayer[]>(`/api/groups/${groupId}/players`).then(setPlayers).catch((e) => flash(msg(e)));
  }, [groupId, call, flash]);

  const toggle = (id: string) => {
    setPreview(null);
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  const n = sel.length;
  const starters = STARTERS[format];
  const big = Math.ceil(n / 2);
  const small = Math.floor(n / 2);
  const bench = Math.max(0, big - starters);
  const hint =
    n < 2 ? 'Elige al menos 2 jugadores.'
      : bench === 0 ? `${n} convocados: ${big} vs ${small}, sin suplentes.`
        : `${n} convocados: ${big} vs ${small} · ${starters} titulares + ${bench} suplente${bench > 1 ? 's' : ''} por equipo.`;

  const generate = async () => {
    setBusy(true);
    try {
      setPreview(await call<Preview>('/api/matches/preview', 'POST', { groupId, format, playerIds: sel }));
    } catch (e) {
      flash(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!preview) return;
    const ids = (s: Side) => [...s.starters, ...s.bench].map((p) => p.id);
    setBusy(true);
    try {
      await call('/api/matches', 'POST', {
        groupId, format, playerIds: sel, location: place.trim() || null,
        scheduledAt: new Date(date).toISOString(),
        assignment: { A: ids(preview.teamA), B: ids(preview.teamB) },
      });
      flash('Partido creado ✅');
      onCreated();
    } catch (e) {
      flash(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const asRoster = (side: Side, team: 'A' | 'B'): Entry[] => [
    ...side.starters.map((p) => ({ entryId: p.id + team, name: p.name, stars: p.stars, photo: p.photo, team, isStarter: true })),
    ...side.bench.map((p) => ({ entryId: p.id + team, name: p.name, stars: p.stars, photo: p.photo, team, isStarter: false })),
  ];

  return (
    <Sheet title="Crear partido" onClose={onClose}>
      <label className="field">
        <span>1 · Grupo</span>
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">Elige un grupo…</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.players})</option>)}
        </select>
      </label>

      {groups.length === 0 && <div className="banner">Aún no tienes grupos. Créalos en la pestaña “Grupos”.</div>}

      {groupId && (
        <>
          <div className="field">
            <span>2 · Convocatoria ({n} seleccionados)</span>
            {players.length === 0 && <div className="muted">Este grupo no tiene jugadores todavía.</div>}
            <div className="stack">
              {players.map((p) => (
                <button key={p.id} className={`pick ${sel.includes(p.id) ? 'on' : ''}`} onClick={() => toggle(p.id)}>
                  <span className="ck">✓</span>
                  <Avatar name={p.name} photo={p.photoUrl} />
                  <span className="nm">{p.name}</span>
                  <span className="muted">{num(p.stars)} ★</span>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span>3 · Modalidad (titulares por equipo)</span>
            <select value={format} onChange={(e) => { setFormat(e.target.value); setPreview(null); }}>
              {Object.keys(STARTERS).map((f) => <option key={f} value={f}>{FORMAT_LABEL[f]}</option>)}
            </select>
          </div>
          <div className="hint">{hint}</div>

          <label className="field"><span>Fecha y hora</span>
            <input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field"><span>Lugar (opcional)</span>
            <input type="text" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Pabellón municipal" />
          </label>

          <button className="btn" disabled={n < 2 || busy} onClick={generate}>
            {preview ? '🔀 Regenerar equipos' : 'Generar equipos'}
          </button>

          {preview && (
            <>
              <Roster roster={[...asRoster(preview.teamA, 'A'), ...asRoster(preview.teamB, 'B')]} />
              <div className="stats">
                <span>Dif. suma: {num(preview.stats.diffSum, 2)}</span>
                <span>Dif. media: {num(preview.stats.diffMean, 2)}</span>
              </div>
              <button className="btn" disabled={busy || !date} onClick={save}>Guardar partido</button>
            </>
          )}
        </>
      )}
    </Sheet>
  );
}

/* ============================ Detalle partido ============================ */
function MatchDetail({ id, call, onClose, onChanged, flash }: {
  id: string; call: Call; onClose: () => void; onChanged: () => void; flash: (m: string) => void;
}) {
  const [d, setD] = useState<Detail | null>(null);

  useEffect(() => {
    call<Detail>(`/api/matches/${id}`).then(setD).catch((e) => flash(msg(e)));
  }, [id, call, flash]);

  const cancel = async () => {
    if (!confirm('¿Cancelar este partido? Esta acción no se puede deshacer.')) return;
    try {
      await call(`/api/matches/${id}/cancel`, 'POST');
      flash('Partido cancelado');
      onChanged();
    } catch (e) {
      flash(msg(e));
    }
  };

  return (
    <Sheet title={d ? d.groupName : 'Partido'} onClose={onClose}>
      {!d ? <div className="muted">Cargando…</div> : (
        <>
          <div className="muted">{when(d.scheduledAt)}{d.location ? ` · ${d.location}` : ''}</div>
          <Roster roster={d.roster} />
          <BalanceLine b={d.balanceStats} />
          {d.status === 'pending' && <button className="btn danger" onClick={cancel}>Cancelar partido</button>}
        </>
      )}
    </Sheet>
  );
}

/* ============================ Registrar resultado ============================ */
function ResultSheet({ row, call, onClose, onSaved, flash }: {
  row: HistRow; call: Call; onClose: () => void; onSaved: () => void; flash: (m: string) => void;
}) {
  const [a, setA] = useState(row.scoreA ?? 0);
  const [b, setB] = useState(row.scoreB ?? 0);
  const [mvp, setMvp] = useState('');

  const save = async () => {
    try {
      await call(`/api/matches/${row.id}/result`, 'POST', { scoreA: a, scoreB: b, mvpEntryId: mvp || undefined });
      flash('Resultado guardado ✅');
      onSaved();
    } catch (e) {
      flash(msg(e));
    }
  };

  return (
    <Sheet title="Resultado y MVP" onClose={onClose}>
      <div className="muted">{row.groupName} · {when(row.scheduledAt)}</div>
      <div className="teams">
        <label className="field"><span style={{ color: 'var(--A)' }}>Equipo A</span>
          <input type="number" min={0} max={99} value={a} onChange={(e) => setA(Number(e.target.value))} />
        </label>
        <label className="field"><span style={{ color: 'var(--B)' }}>Equipo B</span>
          <input type="number" min={0} max={99} value={b} onChange={(e) => setB(Number(e.target.value))} />
        </label>
      </div>
      <label className="field"><span>MVP del partido</span>
        <select value={mvp} onChange={(e) => setMvp(e.target.value)}>
          <option value="">Sin MVP</option>
          {row.roster.map((r) => <option key={r.entryId} value={r.entryId}>{r.name} (Equipo {r.team})</option>)}
        </select>
      </label>
      <button className="btn" onClick={save}>Guardar</button>
    </Sheet>
  );
}

/* ================================ Pestañas ================================ */
function Partidos({ rows, loaded, onOpen }: { rows: MatchRow[]; loaded: boolean; onOpen: (id: string) => void }) {
  if (!loaded) return <div className="empty">Cargando…</div>;
  if (rows.length === 0)
    return <div className="empty"><div className="big">📅</div>No hay partidos pendientes.<br />Pulsa “Crear partido” para empezar.</div>;
  return (
    <>
      {rows.map((m) => (
        <button key={m.id} className="card tap" onClick={() => onOpen(m.id)}>
          <div className="row">
            <span className="title">{m.groupName}</span>
            <span className="badge">{FORMAT_LABEL[m.format] ?? m.format}</span>
          </div>
          <div className="muted">{when(m.scheduledAt)}{m.location ? ` · ${m.location}` : ''}</div>
          <div className="row" style={{ marginTop: 6 }}>
            <span className="muted">{m.playersCount} convocados</span>
            <BalanceLine b={m.balanceStats} />
          </div>
        </button>
      ))}
    </>
  );
}

function Historial({ rows, loaded, onResult }: { rows: HistRow[]; loaded: boolean; onResult: (r: HistRow) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!loaded) return <div className="empty">Cargando…</div>;
  if (rows.length === 0)
    return <div className="empty"><div className="big">🏁</div>Todavía no hay partidos jugados.<br />Aparecerán aquí cuando pase su hora.</div>;
  return (
    <>
      {rows.map((m) => (
        <div key={m.id} className="card stack">
          <button className="row" style={{ background: 'none', border: 0, padding: 0, width: '100%', textAlign: 'left' }}
            onClick={() => setOpen(open === m.id ? null : m.id)}>
            <span className="stack" style={{ gap: 2 }}>
              <span className="title">{m.groupName}</span>
              <span className="muted">{when(m.scheduledAt)}{m.location ? ` · ${m.location}` : ''}</span>
            </span>
            {m.needsResult
              ? <span className="badge warn">Sin resultado</span>
              : <span className="score">{m.scoreA} – {m.scoreB}</span>}
          </button>
          {m.mvpName && <div className="row" style={{ justifyContent: 'flex-start' }}>
            <Avatar name={m.mvpName} photo={m.mvpPhoto} /><span>🏆 MVP: <b>{m.mvpName}</b></span>
          </div>}
          {m.needsResult && <button className="btn small" onClick={() => onResult(m)}>Registrar resultado y MVP</button>}
          {open === m.id && (
            <>
              <Roster roster={m.roster} />
              <BalanceLine b={m.balanceStats} />
            </>
          )}
          {open !== m.id && <span className="muted" style={{ fontSize: '.78rem' }}>Toca para ver los equipos</span>}
        </div>
      ))}
    </>
  );
}

function Grupos({ groups, call, refresh, flash }: { groups: Group[]; call: Call; refresh: () => void; flash: (m: string) => void }) {
  const [name, setName] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [players, setPlayers] = useState<GPlayer[]>([]);
  const [pName, setPName] = useState('');
  const [pStars, setPStars] = useState(5);
  const [everyone, setEveryone] = useState<{ id: string; name: string; groupIds: string[] }[]>([]);
  const [existingId, setExistingId] = useState('');
  const [existingStars, setExistingStars] = useState(5);
  const group = groups.find((g) => g.id === openId) ?? null;

  const load = useCallback(
    (id: string) => {
      call<{ id: string; name: string; groupIds: string[] }[]>('/api/players').then(setEveryone).catch(() => setEveryone([]));
      return call<GPlayer[]>(`/api/groups/${id}/players`).then(setPlayers).catch((e) => flash(msg(e)));
    },
    [call, flash]
  );
  useEffect(() => { if (openId) load(openId); }, [openId, load]);
  const others = everyone.filter((p) => !!openId && !p.groupIds.includes(openId));

  const addExisting = async () => {
    if (!openId || !existingId) return;
    try {
      await call(`/api/groups/${openId}/players`, 'POST', { playerId: existingId, stars: existingStars });
      setExistingId(''); await load(openId); refresh();
    } catch (e) { flash(msg(e)); }
  };

  const addGroup = async () => {
    try { await call('/api/groups', 'POST', { name }); setName(''); refresh(); } catch (e) { flash(msg(e)); }
  };
  const addPlayer = async () => {
    if (!openId) return;
    try {
      await call(`/api/groups/${openId}/players`, 'POST', { name: pName, stars: pStars });
      setPName(''); await load(openId); refresh();
    } catch (e) { flash(msg(e)); }
  };
  const setStars = async (p: GPlayer, v: number) => {
    if (!openId) return;
    setPlayers((l) => l.map((x) => (x.id === p.id ? { ...x, stars: v } : x)));
    try { await call(`/api/groups/${openId}/players/${p.id}`, 'PATCH', { stars: v }); } catch (e) { flash(msg(e)); load(openId); }
  };
  const remove = async (p: GPlayer) => {
    if (!openId || !confirm(`¿Quitar a ${p.name} del grupo? Seguirá apareciendo en el historial de partidos.`)) return;
    try { await call(`/api/groups/${openId}/players/${p.id}`, 'DELETE'); await load(openId); refresh(); } catch (e) { flash(msg(e)); }
  };

  if (group) {
    return (
      <>
        <button className="btn sec small" onClick={() => setOpenId(null)}>← Grupos</button>
        <h2 style={{ margin: '4px 0' }}>{group.name}</h2>
        {players.length === 0 && <div className="muted">Aún no hay jugadores. Añade el primero abajo.</div>}
        {players.map((p) => (
          <div key={p.id} className="card row">
            <span className="row" style={{ justifyContent: 'flex-start', minWidth: 0 }}>
              <Avatar name={p.name} photo={p.photoUrl} /><span className="title">{p.name}</span>
            </span>
            <span className="row" style={{ gap: 6 }}>
              <Stepper value={p.stars} onChange={(v) => setStars(p, v)} />
              <button className="x" onClick={() => remove(p)} aria-label={`Quitar a ${p.name}`}>🗑</button>
            </span>
          </div>
        ))}
        <div className="card stack">
          <span className="title">Añadir jugador</span>
          <input type="text" placeholder="Nombre" value={pName} onChange={(e) => setPName(e.target.value)} />
          <div className="row"><span className="muted">Nivel</span><Stepper value={pStars} onChange={setPStars} /></div>
          <button className="btn" disabled={!pName.trim()} onClick={addPlayer}>Añadir</button>
        </div>
        {others.length > 0 && (
          <div className="card stack">
            <span className="title">Añadir jugador de otro grupo</span>
            <select value={existingId} onChange={(e) => setExistingId(e.target.value)}>
              <option value="">Elige un jugador…</option>
              {others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <div className="row"><span className="muted">Nivel en este grupo</span><Stepper value={existingStars} onChange={setExistingStars} /></div>
            <button className="btn" disabled={!existingId} onClick={addExisting}>Añadir a {group.name}</button>
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {groups.length === 0 && <div className="empty"><div className="big">👥</div>Crea tu primer grupo, por ejemplo “Fútbol Jueves”.</div>}
      {groups.map((g) => (
        <button key={g.id} className="card tap row" onClick={() => setOpenId(g.id)}>
          <span className="title">{g.name}</span>
          <span className="muted">{g.players} jugadores ›</span>
        </button>
      ))}
      <div className="card stack">
        <span className="title">Nuevo grupo</span>
        <input type="text" placeholder="Nombre del grupo" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={!name.trim()} onClick={addGroup}>Crear grupo</button>
      </div>
    </>
  );
}

/* ================================ Principal ================================ */
function Main({ apiKey, onLogout }: { apiKey: string; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('partidos');
  const [groups, setGroups] = useState<Group[]>([]);
  const [pending, setPending] = useState<MatchRow[]>([]);
  const [history, setHistory] = useState<HistRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [creating, setCreating] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [resultRow, setResultRow] = useState<HistRow | null>(null);

  const call: Call = useCallback(
    <T,>(path: string, method = 'GET', body?: unknown) => api<T>(apiKey, path, method, body),
    [apiKey]
  );
  const flash = useCallback((m: string) => setToast(m), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const refresh = useCallback(async () => {
    try {
      const [g, p, h] = await Promise.all([
        call<Group[]>('/api/groups'), call<MatchRow[]>('/api/matches'), call<HistRow[]>('/api/history'),
      ]);
      setGroups(g); setPending(p); setHistory(h); setError(''); setLoaded(true);
    } catch (e) {
      if (e instanceof AuthError) onLogout();
      else setError(msg(e));
    }
  }, [call, onLogout]);

  // Refresco cada 30 s: así un partido pasa solo de "Pendiente" a "Historial" cuando llega su hora.
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30000);
    return () => clearInterval(t);
  }, [refresh]);

  const toResult = history.filter((h) => h.needsResult);
  const titles: Record<Tab, string> = { partidos: 'Próximos partidos', historial: 'Historial', grupos: 'Grupos' };

  return (
    <div className="shell">
      <header className="top">
        <div><div className="eyebrow">Equilibrio FC</div><h1>{titles[tab]}</h1></div>
        <button className="ghost" onClick={onLogout}>Salir</button>
      </header>

      <main className="content">
        {error && <div className="banner err">No se pudo conectar con el servidor: {error}</div>}

        {toResult.length > 0 && tab !== 'historial' && (
          <div className="banner">
            <b>El partido ya se ha jugado. ¡Vota al MVP y registra el resultado!</b>
            <span>{toResult.length === 1 ? '1 partido espera' : `${toResult.length} partidos esperan`} resultado.</span>
            <button className="btn small" onClick={() => setTab('historial')}>Ir al Historial</button>
          </div>
        )}

        {tab === 'partidos' && <Partidos rows={pending} loaded={loaded} onOpen={setDetailId} />}
        {tab === 'historial' && <Historial rows={history} loaded={loaded} onResult={setResultRow} />}
        {tab === 'grupos' && <Grupos groups={groups} call={call} refresh={refresh} flash={flash} />}
      </main>

      {tab === 'partidos' && <button className="btn fab" onClick={() => setCreating(true)}>＋ Crear partido</button>}

      <nav className="nav">
        <div className="nav-in">
          <button className={tab === 'partidos' ? 'on' : ''} onClick={() => setTab('partidos')}><Icon d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />Partidos</button>
          <button className={tab === 'historial' ? 'on' : ''} onClick={() => setTab('historial')}>
            <Icon d="M8 4h8v5a4 4 0 0 1-8 0V4zM5 5h3M16 5h3M12 13v4M8 20h8M10 17h4" />Historial{toResult.length > 0 && <span className="dot">{toResult.length}</span>}
          </button>
          <button className={tab === 'grupos' ? 'on' : ''} onClick={() => setTab('grupos')}><Icon d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 19a6 6 0 0 1 12 0M16 6a3 3 0 0 1 0 6M18 19a6 6 0 0 0-3-5" />Grupos</button>
        </div>
      </nav>

      {creating && (
        <CreateMatch groups={groups} call={call} flash={flash} onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); refresh(); }} />
      )}
      {detailId && (
        <MatchDetail id={detailId} call={call} flash={flash} onClose={() => setDetailId(null)}
          onChanged={() => { setDetailId(null); refresh(); }} />
      )}
      {resultRow && (
        <ResultSheet row={resultRow} call={call} flash={flash} onClose={() => setResultRow(null)}
          onSaved={() => { setResultRow(null); refresh(); }} />
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
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
