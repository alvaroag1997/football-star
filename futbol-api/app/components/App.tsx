'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { sb } from '@/lib/supabaseBrowser';
import {
  currentSubscription, pushState, registerSW, subscribePush, unsubscribePush, type PushState,
} from '@/lib/webPushClient';

/* ================================ tipos ================================ */
type Pos = 'GK' | 'DEF' | 'ATT';
type Role = 'owner' | 'co_admin' | 'member';
type Group = { id: string; name: string; players: number; role: Role; unreadChat: number; newMatches: number };
type Player = {
  id: string; name: string; nick: string | null; pos: Pos; photoUrl: string | null; stars: number;
  role: Role; hasAccount: boolean; lastName: string | null; displayName: string;
};
type Me = {
  id: string; name: string; nick: string | null; lastName: string | null; displayName: string;
  pos: Pos; level: number; email: string | null;
  notifyChat: boolean; notifyPolls: boolean; notifyMatches: boolean;
};
type Notif = {
  id: string; groupId: string | null; groupName: string | null; type: 'chat' | 'poll' | 'match_created' | 'match_updated';
  title: string; body: string; data: { matchId?: string; pollId?: string }; readAt: string | null; createdAt: string;
};
type GuestDraft = { name: string; stars: number; pos: Pos };
type GroupInfo = { id: string; name: string; players: number; role: Role; invite: { url: string; expiresAt: string | null } | null };
type Choice = 'yes' | 'no' | 'maybe';
type PollUser = { id: string; name: string; nick: string | null; pos: Pos; votedAt: string; guest?: boolean; stars?: number };
type Poll = {
  id: string; groupId: string; question: string; matchAt: string; format: string | null; maxSlots: number | null;
  status: 'open' | 'closed'; matchId: string | null; createdBy: string | null; createdAt: string;
  counts: { yes: number; waitlist: number; maybe: number; no: number; guests?: number };
  confirmed: PollUser[]; waitlist: PollUser[]; maybe: PollUser[]; no: PollUser[];
  myVote: Choice | null; myStatus: Choice | 'waitlist' | null;
};
type ChatMsg = {
  id: string; groupId: string; playerId: string | null; type: 'text' | 'poll' | 'system'; content: string;
  pollId: string | null; metadata: { event?: string; matchId?: string; [k: string]: unknown }; createdAt: string;
  authorName: string | null; authorNick: string | null; poll?: Poll | null;
};
/** Datos con los que se abre "Nuevo partido" desde una encuesta del chat */
type Prefill = { groupId: string; when: string; playerIds: string[]; guests: GuestDraft[]; pollId: string; format: string | null };
type Entry = {
  entryId: string; name: string; nick: string | null; pos: Pos; stars: number; photo: string | null;
  team: 'A' | 'B'; isStarter: boolean; isGuest?: boolean; playerId?: string | null;
};
type Balance = {
  sumA: number; sumB: number; meanA: number; meanB: number; diffSum: number; diffMean: number; warnings?: string[];
} | null;
type MatchRow = {
  id: string; groupId: string; groupName: string; scheduledAt: string; location: string | null; format: string;
  startersPerSide: number; status: string; balanceStats: Balance; playersCount: number;
  guestsCount?: number; notes?: string | null; isNew?: boolean;
};
type Detail = {
  id: string; groupId: string; groupName: string; scheduledAt: string; location: string | null; format: string;
  startersPerSide: number; status: string; balanceStats: Balance; scoreA: number | null; scoreB: number | null;
  mvpEntryId: string | null; needsResult: boolean; roster: Entry[]; role: Role; canManage: boolean;
  notes: string | null; updatedAt: string | null;
};
type HistRow = {
  id: string; groupId: string; groupName: string; scheduledAt: string; location: string | null; format: string;
  scoreA: number | null; scoreB: number | null; needsResult: boolean; balanceStats: Balance;
  mvpName: string | null; mvpPhoto: string | null;
};
type StatRow = { playerId: string; name: string; nick: string | null; pos: Pos; stars: number; pj: number; w: number; mvp: number };
type Call = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type Tab = 'matches' | 'chat' | 'history' | 'squad' | 'stats';
type View = null | { t: 'new'; prefill?: Prefill } | { t: 'match'; id: string; pack?: boolean } | { t: 'edit'; id: string };
type PlayerInit = { id?: string; name: string; nick: string; lastName: string; pos: Pos; stars: number; role?: Role; hasAccount?: boolean };
type SheetState =
  | null
  | { t: 'player'; init: PlayerInit; accounts: Player[] }
  | { t: 'text'; text: string }
  | { t: 'group' }
  | { t: 'existing' }
  | { t: 'profile' }
  | { t: 'deleteGroup' }
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

/** Llama a /api con el token de la sesión de Supabase. */
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const { data: s } = await sb().auth.getSession();
  const token = s.session?.access_token;
  if (!token) throw new AuthError('Sesión caducada');
  const headers: Record<string, string> = { authorization: `Bearer ${token}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) throw new AuthError('Sesión caducada');
  if (!res.ok) throw new Error((data as { error?: string }).error ?? 'Error del servidor');
  return data as T;
}
const isManager = (r?: Role | null) => r === 'owner' || r === 'co_admin';
const ROLE_LABEL: Record<Role, string> = { owner: 'Admin', co_admin: 'Co-admin', member: 'Miembro' };

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
/** Valor de <input type="datetime-local"> en hora local */
const localDT = (d: Date) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** Mínimo seleccionable: el minuto siguiente (no se pueden crear partidos en el pasado) */
const minDT = () => { const d = new Date(); d.setSeconds(0, 0); d.setMinutes(d.getMinutes() + 1); return localDT(d); };
const isFutureDT = (v: string) => !!v && new Date(v).getTime() > Date.now();
/** Mínimo de jugadores para crear un partido (5 contra 5) */
const MIN_PLAYERS = 10;
const badgeTxt = (n: number) => (n > 99 ? '+99' : String(n));
const PENDING_INVITE = 'eqfc-pending-invite';
const PUSH_DISMISSED = 'eqfc-push-dismissed';

/** Titulares primero; dentro de cada bloque, el portero arriba y luego por estrellas. */
function sortTeam(list: Entry[]) {
  return [...list].sort(
    (a, b) => Number(b.isStarter) - Number(a.isStarter) || (a.pos === 'GK' ? 0 : 1) - (b.pos === 'GK' ? 0 : 1) || b.stars - a.stars
  );
}
const sumOf = (l: Entry[]) => l.reduce((a, p) => a + p.stars, 0);

/** Convocatoria lista para pegar en WhatsApp (negritas con *, emojis). */
function lineupText(d: Detail) {
  const L = [
    `⚽ *${d.groupName}* · ${MOD[d.format]?.label ?? d.format}`,
    `📅 ${cap1(fmtD(d.scheduledAt, { weekday: 'long', day: 'numeric', month: 'long' }))}`,
    `🕘 ${hhmm(d.scheduledAt)}h`,
  ];
  if (d.location) L.push(`📍 ${d.location}`);
  if (d.notes) L.push(`📝 ${d.notes}`);
  const line = (p: Entry) => `• ${p.name}${p.pos === 'GK' ? ' 🧤' : ''}${p.isGuest ? ' _(invitado)_' : ''}`;
  (['A', 'B'] as const).forEach((t) => {
    const list = sortTeam(d.roster.filter((r) => r.team === t));
    L.push('', t === 'A' ? '🟢 *EQUIPO A*' : '⚪ *EQUIPO B*');
    list.filter((p) => p.isStarter).forEach((p) => L.push(line(p)));
    const bench = list.filter((p) => !p.isStarter);
    if (bench.length) {
      L.push('🪑 _Suplentes:_');
      bench.forEach((p) => L.push(line(p)));
    }
  });
  const guests = d.roster.filter((p) => p.isGuest);
  if (guests.length) L.push('', `👤 Invitados: ${guests.map((g) => g.name).join(', ')}`);
  L.push('', `Total: ${d.roster.length} jugadores`);
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
  chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9.5h8M8 12.5h5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.2 3.9-6.5 8-6.5s7.2 2.3 8 6.5"/>',
  link: '<path d="M10 14a4.5 4.5 0 006.4 0l3-3a4.5 4.5 0 00-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 00-6.4 0l-3 3a4.5 4.5 0 006.4 6.4l1-1"/>',
  poll: '<path d="M5 20V10M10 20V4M15 20v-7M20 20v-4"/>',
  send: '<path d="M4 12l16-8-6 16-3-6.5z"/>',
  bell: '<path d="M6 16V11a6 6 0 0112 0v5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 004 0"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5"/>',
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

function MatchCard({ m, count, played, right, onOpen, fresh }: {
  m: { id: string; groupName: string; scheduledAt: string; location: string | null; format: string; balanceStats: Balance };
  count?: number; played?: boolean; right: ReactNode; onOpen: () => void; fresh?: boolean;
}) {
  const d = new Date(m.scheduledAt);
  const info = [m.groupName];
  if (count !== undefined) info.push(`${count} jugadores`);
  if (!played && m.balanceStats) info.push(`diferencia ${f1(m.balanceStats.diffSum)}★`);
  return (
    <button className="card mcard" onClick={onOpen}>
      <span className="dbox"><b>{d.getDate()}</b><small>{fmtD(m.scheduledAt, { month: 'short' })}</small></span>
      <span className="minfo">
        <span className="mtop"><b>{MOD[m.format]?.label ?? m.format}</b><span className="chip">{MOD[m.format]?.short ?? m.format}</span>{fresh && <span className="chip new">Nuevo</span>}</span>
        <span className="mmeta">{cap1(fmtD(m.scheduledAt, { weekday: 'long' }))} · {hhmm(m.scheduledAt)} · {m.location || 'Sin lugar'}</span>
        <span className="mmeta">{info.join(' · ')}</span>
      </span>
      {right}
    </button>
  );
}

/* ================================ Entrada ================================ */
type InvitePreview = { name: string; players: number; expired: boolean };

/** Inicio de sesión y registro con email + contraseña (Supabase Auth). */
function AuthScreen({ invite, onCheckEmail }: { invite?: InvitePreview | null; onCheckEmail: (email: string) => void }) {
  const [mode, setMode] = useState<'login' | 'signup'>(invite ? 'signup' : 'login');
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'last' | 'nick'>('last');
  const [second, setSecond] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  // Nombre visible: "Carlos M." (con apellido) o "Carlos 'El Mago'" (con apodo)
  const preview = !name.trim() || !second.trim() ? ''
    : kind === 'last' ? `${name.trim()} ${second.trim().charAt(0).toUpperCase()}.` : `${name.trim()} '${second.trim()}'`;

  const go = async () => {
    setBusy(true);
    setErr('');
    try {
      if (mode === 'login') {
        const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password: pass });
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Email o contraseña incorrectos.'
          : error.message === 'Email not confirmed' ? 'Aún no has confirmado tu email: revisa tu bandeja de entrada.' : error.message);
      } else {
        if (!name.trim()) throw new Error('Escribe tu nombre');
        if (!second.trim()) throw new Error(kind === 'last' ? 'Escribe tu apellido' : 'Escribe tu apodo');
        if (pass.length < 6) throw new Error('La contraseña debe tener al menos 6 caracteres');
        const meta: Record<string, string> = { name: name.trim() };
        meta[kind === 'last' ? 'last_name' : 'nick'] = second.trim();
        const { data, error } = await sb().auth.signUp({
          email: email.trim(),
          password: pass,
          options: { data: meta, emailRedirectTo: window.location.href },
        });
        if (error) throw new Error(error.message);
        // Sin sesión = hay que confirmar el email: pantalla dedicada (no se queda en el formulario)
        if (!data.session) onCheckEmail(email.trim());
      }
      // Con sesión, App lo detecta (onAuthStateChange) y entra solo.
    } catch (e) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };
  const ok = email.trim() && pass && (mode === 'login' || (name.trim() && second.trim()));

  return (
    <div className="app">
      <Hdr eyebrow="Equilibrio FC" title={mode === 'login' ? 'Entrar' : 'Crear cuenta'} />
      <main className="main">
        {invite && (
          <div className="card invite-hero">
            <span className="eyebrow">Te han invitado a</span>
            <b>{invite.name}</b>
            <small>{invite.players} jugadores · {mode === 'login' ? 'inicia sesión' : 'crea tu cuenta'} y entrarás al grupo</small>
          </div>
        )}
        <div className="card form">
          {mode === 'signup' && (
            <>
              <label htmlFor="a-name">Nombre</label>
              <input id="a-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" maxLength={60} />
              <label htmlFor="a-second" style={{ marginTop: 6 }}>Apodo o apellido <span className="lockt">obligatorio</span></label>
              <div className="seg">
                <button className={kind === 'last' ? 'on' : ''} onClick={() => setKind('last')}>Apellido</button>
                <button className={kind === 'nick' ? 'on' : ''} onClick={() => setKind('nick')}>Apodo</button>
              </div>
              <input id="a-second" value={second} onChange={(e) => setSecond(e.target.value)} maxLength={60}
                autoComplete={kind === 'last' ? 'family-name' : 'off'} placeholder={kind === 'last' ? 'Martínez' : 'El Mago'} />
              {preview && <span className="note">En el grupo te verán como <b>&nbsp;{preview}</b></span>}
            </>
          )}
          <label htmlFor="a-mail">Email</label>
          <input id="a-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          <label htmlFor="a-pass">Contraseña</label>
          <input id="a-pass" type="password" value={pass} onChange={(e) => setPass(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            onKeyDown={(e) => { if (e.key === 'Enter' && ok) go(); }} />
        </div>
        {err && <div className="alert err">{err}</div>}
        <button className="btn ghost sm" style={{ alignSelf: 'center' }} onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setErr(''); }}>
          {mode === 'login' ? '¿No tienes cuenta? Regístrate' : '¿Ya tienes cuenta? Inicia sesión'}
        </button>
      </main>
      <div className="foot">
        <button className="btn primary" disabled={!ok || busy} onClick={go}>
          {busy ? 'Un momento…' : mode === 'login' ? 'Entrar' : 'Crear cuenta'}
        </button>
      </div>
    </div>
  );
}

/** Pantalla "Revisa tu correo" tras registrarse (con o sin invitación pendiente). */
function CheckEmail({ email, invite, onBack }: { email: string; invite?: InvitePreview | null; onBack: () => void }) {
  const [sent, setSent] = useState(false);
  const resend = async () => {
    try {
      const { error } = await sb().auth.resend({ type: 'signup', email, options: { emailRedirectTo: window.location.href } });
      if (error) throw error;
      setSent(true);
    } catch (e) { alert(msg(e)); }
  };
  return (
    <div className="app">
      <Hdr eyebrow="Equilibrio FC" title="Revisa tu correo" />
      <main className="main">
        {invite && (
          <div className="card invite-hero">
            <span className="eyebrow">Ya casi estás en</span>
            <b>{invite.name}</b>
            <small>Confirma tu email y entrarás automáticamente al grupo</small>
          </div>
        )}
        <div className="card checkmail">
          <span className="bigicon"><Icon n="mail" /></span>
          <b>Te hemos enviado un enlace de confirmación</b>
          <span>a <b>{email}</b></span>
          <ol>
            <li>Abre el correo de <b>Supabase Auth</b> (mira también en spam).</li>
            <li>Pulsa el enlace <b>en este mismo dispositivo y navegador</b>.</li>
            <li>{invite ? `Entrarás directamente en “${invite.name}”.` : 'Entrarás directamente en la app.'}</li>
          </ol>
        </div>
        <button className="btn ghost sm" style={{ alignSelf: 'center' }} disabled={sent} onClick={resend}>
          {sent ? 'Correo reenviado' : '¿No te llega? Reenviar correo'}
        </button>
      </main>
      <div className="foot"><button className="btn primary" onClick={onBack}>Volver a Entrar</button></div>
    </div>
  );
}

/* ============================ Nuevo partido (2 pasos) ============================ */
/** Invitados externos (no registrados): nombre, valoración (3★ por defecto) y si es portero. */
function GuestForm({ onAdd, busy }: { onAdd: (g: GuestDraft) => void | Promise<void>; busy?: boolean }) {
  const [name, setName] = useState('');
  const [stars, setStars] = useState(3);
  const [gk, setGk] = useState(false);
  const add = async () => {
    if (!name.trim()) return;
    await onAdd({ name: name.trim(), stars, pos: gk ? 'GK' : 'DEF' });
    setName(''); setStars(3); setGk(false);
  };
  return (
    <div className="guestform">
      <input value={name} maxLength={60} placeholder="Nombre del invitado" onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') add(); }} aria-label="Nombre del invitado" />
      <select value={stars} onChange={(e) => setStars(Number(e.target.value))} aria-label="Estrellas del invitado">
        {[1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((v) => <option key={v} value={v}>{f1(v)}★</option>)}
      </select>
      <button className={`btn sm${gk ? ' primary' : ''}`} onClick={() => setGk(!gk)} title="¿Es portero?">🧤</button>
      <button className="btn sm" disabled={!name.trim() || busy} onClick={add}><Icon n="plus" /></button>
    </div>
  );
}

function GuestList({ guests, onChange }: { guests: GuestDraft[]; onChange: (g: GuestDraft[]) => void }) {
  return (
    <div className="card form">
      <div className="lbl">Invitados externos · {guests.length}</div>
      {guests.map((g, i) => (
        <div key={i} className="prow ro">
          <Av name={g.name} />
          <span className="pname"><b>{g.name}</b><small>Invitado{g.pos === 'GK' ? ' · portero' : ''}</small></span>
          <span className="rate">{f1(g.stars)}</span>
          <button className="iconbtn" onClick={() => onChange(guests.filter((_, j) => j !== i))} aria-label={`Quitar a ${g.name}`}><Icon n="x" /></button>
        </div>
      ))}
      <GuestForm onAdd={(g) => onChange([...guests, g])} />
    </div>
  );
}

/** Modalidad sugerida según cuántos se apuntaron (si la encuesta no la indicaba) */
const guessMod = (n: number) => (n >= 22 ? '11v11' : n >= 14 ? '7v7' : '5v5');

function NewMatch({ groups, prefill, call, flash, onClose, onCreated }: {
  groups: Group[]; prefill?: Prefill; call: Call; flash: (m: string) => void; onClose: () => void; onCreated: (id: string) => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [groupId, setGroupId] = useState(prefill?.groupId ?? '');
  const [mod, setMod] = useState(prefill
    ? (prefill.format && MOD[prefill.format] ? prefill.format : guessMod(prefill.playerIds.length + prefill.guests.length))
    : '7v7');
  const [guests, setGuests] = useState<GuestDraft[]>(prefill?.guests ?? []);
  const [when, setWhen] = useState(() => {
    const fromPoll = prefill ? localDT(new Date(prefill.when)) : '';
    return fromPoll && isFutureDT(fromPoll) ? fromPoll : `${nextThursday()}T21:00`;
  });
  const [minWhen, setMinWhen] = useState(minDT);
  const [venue, setVenue] = useState('');
  const [players, setPlayers] = useState<Player[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const preMod = useRef('');
  const keepSel = useRef(false); // la convocatoria viene de la encuesta: no se sustituye al cambiar de modalidad

  // Con varios grupos hay que elegir uno a propósito; con uno solo no hay duda posible.
  useEffect(() => { if (groups.length === 1 && !prefill) setGroupId(groups[0].id); }, [groups, prefill]);
  useEffect(() => {
    setPlayers([]);
    setSel([]);
    preMod.current = '';
    keepSel.current = false;
    if (!groupId) return;
    call<Player[]>(`/api/groups/${groupId}/players`)
      .then((l) => {
        setPlayers(l);
        if (prefill && prefill.groupId === groupId) {
          // Pre-rellenado con los que votaron "Me apunto" (en orden de voto)
          setSel(prefill.playerIds.filter((id) => l.some((p) => p.id === id)));
          keepSel.current = true;
        } else setSel([]);
      })
      .catch((e) => flash(msg(e)));
  }, [groupId, call, flash, prefill]);
  const futureOk = isFutureDT(when);

  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const n = sel.length + guests.length; // los invitados externos también juegan
  const enough = n >= MIN_PLAYERS;
  const starters = MOD[mod].n;
  const big = Math.ceil(n / 2);
  const small = Math.floor(n / 2);
  const bench = Math.max(0, big - starters);
  const gk = players.filter((p) => sel.includes(p.id) && p.pos === 'GK').length + guests.filter((g) => g.pos === 'GK').length;
  const plan = n < 2 ? 'Elige al menos 2 jugadores.'
    : bench === 0 ? `${big} vs ${small} · sin suplentes`
      : `${big} vs ${small} · ${starters} titulares + ${bench} suplente${bench > 1 ? 's' : ''} por equipo`;
  // La modalidad manda: se preselecciona justo 2 × titulares (5v5 → 10, 7v7 → 14, 11v11 → 22).
  // Después se pueden añadir más como suplentes con "Todos" o marcándolos a mano.
  const goStep2 = () => {
    if (!isFutureDT(when)) { flash('La fecha y hora deben ser posteriores a este momento'); return; }
    if (!keepSel.current && preMod.current !== `${groupId}|${mod}`) {
      const want = MOD[mod].n * 2;
      const gks = players.filter((p) => p.pos === 'GK').slice(0, 2);
      const rest = players.filter((p) => !gks.includes(p));
      setSel([...gks, ...rest].slice(0, want).map((p) => p.id));
      preMod.current = `${groupId}|${mod}`;
    }
    setStep(2);
  };
  const sorted = [...players].sort((a, b) => POS[a.pos].o - POS[b.pos].o || b.stars - a.stars);

  const generate = async () => {
    setBusy(true);
    try {
      const r = await call<{ id: string }>('/api/matches', 'POST', {
        groupId, format: mod, playerIds: sel, guests, location: venue.trim() || null,
        scheduledAt: new Date(when).toISOString(),
        pollId: prefill?.pollId ?? null,
      });
      onCreated(r.id);
    } catch (e) {
      flash(e instanceof RangeError ? 'Revisa la fecha y la hora' : msg(e));
      setBusy(false);
    }
  };

  return (
    <>
      <Hdr eyebrow={`${prefill ? 'Desde la encuesta · ' : ''}Paso ${step} de 2`} title={step === 1 ? 'Nuevo partido' : `Convocatoria · ${MOD[mod].short}`} onBack={() => (step === 2 ? setStep(1) : onClose())} />
      <main className="main">
        {step === 1 ? (
          <>
            <div className="card form">
              <label htmlFor="d-group">Grupo</label>
              <select id="d-group" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                <option value="">Elige un grupo…</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.players} jugadores)</option>)}
              </select>
              {groups.length === 0 && <div className="warnbox" style={{ marginTop: 6 }}><Icon n="warn" /><span>No administras ningún grupo. Crea uno en la pestaña Plantilla.</span></div>}
              {prefill && <div className="note" style={{ marginTop: 6 }}><Icon n="poll" /><span>{prefill.playerIds.length} confirmados{prefill.guests.length ? ` y ${prefill.guests.length} invitados` : ''} en la encuesta. Puedes ajustar la convocatoria en el paso 2 y, una vez creado, editarlo todo (equipos, titulares y suplentes).</span></div>}
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
                <label htmlFor="d-when" style={{ marginTop: 8 }}>Fecha y hora</label>
                <input id="d-when" type="datetime-local" value={when} min={minWhen}
                  onFocus={() => setMinWhen(minDT())} onChange={(e) => setWhen(e.target.value)} />
                {!futureOk && <div className="warnbox"><Icon n="warn" /><span>Elige una fecha y hora posteriores a este momento.</span></div>}
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
              {!enough && <div className="errtxt">No son suficientes jugadores para crear un partido (mínimo {MIN_PLAYERS})</div>}
            </div>
            <GuestList guests={guests} onChange={setGuests} />
            {players.length === 0 && <div className="empty">Este grupo no tiene jugadores todavía. Añádelos en la pestaña Plantilla.</div>}
            {sorted.map((p) => {
              const on = sel.includes(p.id);
              return (
                <button key={p.id} className={`prow sel${on ? ' on' : ''}`} onClick={() => toggle(p.id)} aria-pressed={on}>
                  <span className="cb"><Icon n="check" /></span>
                  <Av name={p.displayName ?? p.name} />
                  <span className="pname"><b>{p.displayName ?? p.name}</b><small>{POS[p.pos].label}{prefill?.playerIds.includes(p.id) ? ' · se apuntó' : ''}</small></span>
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
          <button className="btn primary" disabled={!groupId || !futureOk} onClick={goStep2}>Elegir jugadores</button>
        ) : (
          <>
            <button className="btn" onClick={() => setStep(1)}>Atrás</button>
            <button className="btn primary" disabled={!enough || busy} onClick={generate}>{busy ? 'Generando…' : 'Generar equipos'}</button>
          </>
        )}
      </div>
    </>
  );
}

/* ============================ Equipos de un partido ============================ */
function TeamPanel({ side, list, editable, anim, offset, onSwap, showStars = true }: {
  side: 'A' | 'B'; list: Entry[]; editable: boolean; anim: boolean; offset: number; onSwap: (eid: string) => void; showStars?: boolean;
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
      <span className="pname"><b>{p.name}</b><small>{p.isGuest ? 'Invitado' : p.nick && !p.name.includes(p.nick) ? p.nick : POS[p.pos].label}</small></span>
      <PosChip pos={p.pos} />
      {showStars ? <span className="rate">{f1(p.stars)}</span> : <span />}
      {editable && <button className="iconbtn" onClick={() => onSwap(p.entryId)} aria-label={`Pasar a Equipo ${other}`}><Icon n="swap" /></button>}
    </div>
  );
  return (
    <section className={`team t${side}`} data-team={side}>
      <div className="thead">
        <h3>Equipo {side}</h3>
        <span className={`chip ${hasGk ? 'ok' : 'warn'}`}>{hasGk ? 'Con portero' : 'Sin portero'}</span>
        <span className="tcount">{sorted.length} jug.{showStars ? ` · ${f1(sumOf(sorted))}★` : ''}</span>
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

function MatchView({ id, startPack, call, flash, onBack, onChanged, openText, openResult, onEdit }: {
  id: string; startPack: boolean; call: Call; flash: (m: string) => void; onBack: () => void; onChanged: () => void;
  onEdit: () => void;
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

  const editable = !!d && d.status === 'pending' && !pack && d.canManage;

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
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => flash('Convocatoria copiada: pégala en WhatsApp'), fallback);
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
          {d.notes && <span className="mnotes">📝 {d.notes}</span>}
          {d.updatedAt && <small className="lockt">Actualizado {cap1(fmtD(d.updatedAt, { weekday: 'short', day: 'numeric', month: 'short' }))} · {hhmm(d.updatedAt)}</small>}
        </div>
        {d.status === 'pending' && d.canManage && (
          <button className="btn block" onClick={onEdit}><Icon n="edit" /> Editar partido (fecha, lugar, jugadores, invitados y equipos)</button>
        )}

        {d.status === 'cancelled' && <div className="alert err">Este partido está cancelado.</div>}
        {finished && d.needsResult && (
          <div className="alert">
            <b>El partido ya se ha jugado. ¡Vota al MVP y registra el resultado!</b>
            {d.canManage
              ? <button className="btn primary sm" onClick={askResult} style={{ alignSelf: 'flex-start' }}>Registrar resultado y MVP</button>
              : <span>El admin del grupo registrará el resultado.</span>}
          </div>
        )}
        {finished && d.scoreA !== null && (
          <div className="card stack" style={{ display: 'grid', gap: 10 }}>
            <div className="resbox">
              <div className="big"><span className="a">{d.scoreA}</span> – <span className="b">{d.scoreB}</span></div>
              {d.canManage && <button className="btn sm" onClick={askResult}>Editar</button>}
            </div>
            {mvp && <div className="mvpline"><Av name={mvp.name} /><span>🏆 MVP: {mvp.name}{mvp.nick ? ` (${mvp.nick})` : ''}</span></div>}
          </div>
        )}

        {d.canManage && <div className="card meter">
          <div className="mrow">
            <div className="ta"><small>Equipo A</small>{f1(a)}★<span className="avg">media {meanA.toFixed(2)}</span></div>
            <div className={`verdict ${verdict[0]}`}>{verdict[1]}</div>
            <div className="tb"><small>Equipo B</small>{f1(b)}★<span className="avg">media {meanB.toFixed(2)}</span></div>
          </div>
          <div className="barwrap"><div className="bar"><i className="ba" style={{ width: pct + '%' }} /><i className="bb" /></div><u /></div>
        </div>}
        {warnings.map((w) => <div key={w} className="warnbox"><Icon n="warn" /><span>{w}</span></div>)}

        <TeamPanel side="A" list={A} editable={editable} anim={anim} offset={0} showStars={d.canManage} onSwap={(eid) => applyMove(eid, { team: 'B' })} />
        <TeamPanel side="B" list={B} editable={editable} anim={anim} offset={A.length} showStars={d.canManage} onSwap={(eid) => applyMove(eid, { team: 'A' })} />

        {editable && (
          <div className="note"><Icon n="lock" /><span>Arrastra el icono de la izquierda o usa el botón de flechas para cambiar a alguien de equipo. Si sueltas sobre otro jugador, se intercambian.</span></div>
        )}
        {d.status === 'pending' && d.canManage && <button className="btn danger block" onClick={cancelMatch}>Cancelar partido</button>}
      </main>
      <div className="foot">
        {d.status === 'pending' && d.canManage && <button className="btn" onClick={regenerate} disabled={busy}><Icon n="shuffle" /> Regenerar</button>}
        <button className="btn primary" onClick={copy}><Icon n="copy" /> Copiar para WhatsApp</button>
      </div>
    </>
  );
}

/* ============================ Editar partido (admin) ============================ */
type EdRow = {
  key: string; entryId?: string; playerId?: string | null; name: string; pos: Pos; stars: number;
  team: 'A' | 'B'; isStarter: boolean; isGuest: boolean;
};

function MatchEditor({ id, call, flash, onClose, onSaved }: {
  id: string; call: Call; flash: (m: string) => void; onClose: () => void; onSaved: () => void;
}) {
  const [d, setD] = useState<Detail | null>(null);
  const [members, setMembers] = useState<Player[]>([]);
  const [when, setWhen] = useState('');
  const [minWhen, setMinWhen] = useState(minDT);
  const [venue, setVenue] = useState('');
  const [notes, setNotes] = useState('');
  const [mod, setMod] = useState('7v7');
  const [rows, setRows] = useState<EdRow[]>([]);
  const [addId, setAddId] = useState('');
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    call<Detail>(`/api/matches/${id}`).then((m) => {
      setD(m);
      setWhen(localDT(new Date(m.scheduledAt)));
      setVenue(m.location ?? '');
      setNotes(m.notes ?? '');
      setMod(m.format);
      setRows(m.roster.map((r) => ({
        key: r.entryId, entryId: r.entryId, playerId: r.playerId ?? null, name: r.name, pos: r.pos, stars: r.stars,
        team: r.team, isStarter: r.isStarter, isGuest: !!r.isGuest,
      })));
      return call<Player[]>(`/api/groups/${m.groupId}/players`).then(setMembers);
    }).catch((e) => flash(msg(e)));
  }, [call, id, flash]);

  if (!d) return (<><Hdr eyebrow="Editar partido" title="Cargando…" onBack={onClose} /><main className="main"><div className="empty">Cargando…</div></main></>);

  const per = MOD[mod].n;
  const inTeam = (t: 'A' | 'B') => rows.filter((r) => r.team === t);
  const startersIn = (t: 'A' | 'B') => inTeam(t).filter((r) => r.isStarter).length;
  const smaller = (): 'A' | 'B' => (inTeam('A').length <= inTeam('B').length ? 'A' : 'B');
  const upd = (key: string, patch: Partial<EdRow>) => setRows((l) => l.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const available = members.filter((m) => !rows.some((r) => r.playerId === m.id));
  const total = rows.length;
  const sum = (t: 'A' | 'B') => inTeam(t).reduce((a, r) => a + r.stars, 0);

  const addRow = (r: Omit<EdRow, 'team' | 'isStarter'>) => {
    const team = smaller();
    setRows((l) => [...l, { ...r, team, isStarter: l.filter((x) => x.team === team && x.isStarter).length < per }]);
  };
  const addMember = () => {
    const m = members.find((x) => x.id === addId);
    if (!m) return;
    addRow({ key: `new:${m.id}`, playerId: m.id, name: m.displayName ?? m.name, pos: m.pos, stars: Math.min(5, Math.max(1, m.stars)), isGuest: false });
    setAddId('');
  };
  const addGuest = (g: GuestDraft) => addRow({ key: `guest:${++seq.current}`, name: g.name, pos: g.pos, stars: g.stars, isGuest: true });

  const rebalance = async () => {
    if (rows.length < 2) return;
    setBusy(true);
    try {
      const r = await call<{ assignment: { key: string; team: 'A' | 'B'; isStarter: boolean }[] }>(`/api/matches/${id}/rebalance`, 'POST', {
        format: mod, roster: rows.map((x) => ({ key: x.key, stars: x.stars, pos: x.pos })),
      });
      const by = new Map(r.assignment.map((a) => [a.key, a]));
      setRows((l) => l.map((x) => ({ ...x, team: by.get(x.key)?.team ?? x.team, isStarter: by.get(x.key)?.isStarter ?? x.isStarter })));
      flash('Equipos re-equilibrados (aún sin guardar)');
    } catch (e) { flash(msg(e)); } finally { setBusy(false); }
  };

  const save = async () => {
    if (!isFutureDT(when)) { flash('La fecha y hora deben ser posteriores a este momento'); return; }
    setBusy(true);
    try {
      const r = await call<Detail & { changes: string[] }>(`/api/matches/${id}`, 'PUT', {
        scheduledAt: new Date(when).toISOString(), location: venue.trim() || null, notes: notes.trim() || null, format: mod,
        roster: rows.map((x) => ({
          ...(x.entryId ? { entryId: x.entryId } : x.isGuest ? { guest: { name: x.name, pos: x.pos } } : { playerId: x.playerId }),
          team: x.team, isStarter: x.isStarter, stars: x.stars,
        })),
      });
      flash(r.changes.length ? 'Cambios guardados y avisados en el chat' : 'Sin cambios');
      onSaved();
    } catch (e) { flash(msg(e)); setBusy(false); }
  };

  const row = (r: EdRow) => (
    <div key={r.key} className={`edrow${r.isStarter ? '' : ' bench'}`}>
      <span className="pname"><b>{r.name}</b><small>{r.isGuest ? 'Invitado' : POS[r.pos].label}{r.entryId ? '' : ' · nuevo'}</small></span>
      <span className="stepper">
        <button onClick={() => upd(r.key, { stars: Math.max(0.5, r.stars - 0.5) })} aria-label="Menos estrellas">−</button>
        <b>{f1(r.stars)}</b>
        <button onClick={() => upd(r.key, { stars: Math.min(5, r.stars + 0.5) })} aria-label="Más estrellas">+</button>
      </span>
      <button className="btn sm" onClick={() => upd(r.key, { isStarter: !r.isStarter })}>{r.isStarter ? 'Titular' : 'Suplente'}</button>
      <button className="btn sm" onClick={() => upd(r.key, { team: r.team === 'A' ? 'B' : 'A' })} aria-label="Cambiar de equipo">→ {r.team === 'A' ? 'B' : 'A'}</button>
      <button className="iconbtn" onClick={() => setRows((l) => l.filter((x) => x.key !== r.key))} aria-label={`Quitar a ${r.name}`}><Icon n="x" /></button>
    </div>
  );
  const team = (t: 'A' | 'B') => {
    const list = inTeam(t).sort((a, b) => Number(b.isStarter) - Number(a.isStarter) || b.stars - a.stars);
    const st = startersIn(t);
    return (
      <section className={`team t${t}`}>
        <div className="thead">
          <h3>Equipo {t}</h3>
          <span className={`chip ${st === per ? 'ok' : 'warn'}`}>{st}/{per} titulares</span>
          <span className="tcount">{list.length} jug. · {f1(sum(t))}★</span>
        </div>
        <div className="tlist">{list.map(row)}</div>
      </section>
    );
  };

  return (
    <>
      <Hdr eyebrow={`Editar partido · ${d.groupName}`} title="Editar partido" onBack={onClose} />
      <main className="main">
        <div className="card form">
          <label htmlFor="e-when">Fecha y hora</label>
          <input id="e-when" type="datetime-local" value={when} min={minWhen} onFocus={() => setMinWhen(minDT())} onChange={(e) => setWhen(e.target.value)} />
          {!isFutureDT(when) && <div className="warnbox"><Icon n="warn" /><span>Elige una fecha y hora posteriores a este momento.</span></div>}
          <div className="lbl" style={{ marginTop: 6 }}>Modalidad</div>
          <div className="seg">
            {Object.keys(MOD).map((k) => <button key={k} className={mod === k ? 'on' : ''} onClick={() => setMod(k)}>{MOD[k].short}</button>)}
          </div>
          <label htmlFor="e-venue" style={{ marginTop: 6 }}>Lugar / campo</label>
          <input id="e-venue" value={venue} maxLength={200} onChange={(e) => setVenue(e.target.value)} placeholder="Pista, polideportivo o dirección" />
          <label htmlFor="e-notes" style={{ marginTop: 6 }}>Notas</label>
          <textarea id="e-notes" value={notes} maxLength={500} rows={2} onChange={(e) => setNotes(e.target.value)} placeholder="Llevad peto blanco y oscuro, se paga en pista…" />
        </div>

        <div className="card">
          <div className="counter"><b>{total}</b><span>convocados · A {f1(sum('A'))}★ · B {f1(sum('B'))}★</span></div>
          {total < MIN_PLAYERS && <div className="errtxt">No son suficientes jugadores para un partido (mínimo {MIN_PLAYERS})</div>}
        </div>

        {team('A')}
        {team('B')}

        <div className="card form">
          <div className="lbl">Añadir jugador del grupo</div>
          <div className="two">
            <select value={addId} onChange={(e) => setAddId(e.target.value)} aria-label="Jugador del grupo">
              <option value="">{available.length ? 'Elige un jugador…' : 'Ya están todos convocados'}</option>
              {available.map((m) => <option key={m.id} value={m.id}>{m.displayName ?? m.name} · {f1(m.stars)}★</option>)}
            </select>
            <button className="btn sm" disabled={!addId} onClick={addMember}><Icon n="plus" /> Añadir</button>
          </div>
          <div className="lbl" style={{ marginTop: 6 }}>Añadir invitado externo</div>
          <GuestForm onAdd={addGuest} />
        </div>
        <div className="note"><Icon n="lock" /><span>Al guardar se publica un resumen de los cambios en el chat del grupo y se avisa a los convocados.</span></div>
      </main>
      <div className="foot">
        <button className="btn" onClick={rebalance} disabled={busy || rows.length < 2}><Icon n="shuffle" /> Re-equilibrar</button>
        <button className="btn primary" onClick={save} disabled={busy || rows.length < 2 || !isFutureDT(when)}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
      </div>
    </>
  );
}

/* ============================ Notificaciones push ============================ */
/** Activar/desactivar en este dispositivo + qué avisos quiere cada uno (se guardan en su perfil). */
function PushSettings({ me, call, flash, onSaved }: { me: Me; call: Call; flash: (m: string) => void; onSaved: (m: Me) => void }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [prefs, setPrefs] = useState({ notifyChat: me.notifyChat, notifyPolls: me.notifyPolls, notifyMatches: me.notifyMatches });
  useEffect(() => { pushState().then(setState); }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const sub = await subscribePush();
      await call('/api/push/subscribe', 'POST', sub);
      setState('on');
      flash('Notificaciones activadas en este dispositivo');
    } catch (e) { flash(msg(e)); setState(await pushState()); } finally { setBusy(false); }
  };
  const disable = async () => {
    setBusy(true);
    try {
      const endpoint = await unsubscribePush();
      if (endpoint) await call('/api/push/subscribe', 'DELETE', { endpoint });
      setState('off');
      flash('Notificaciones desactivadas en este dispositivo');
    } catch (e) { flash(msg(e)); } finally { setBusy(false); }
  };
  const test = async () => {
    try { await call('/api/push/test', 'POST'); flash('Enviada: debería llegarte en unos segundos'); } catch (e) { flash(msg(e)); }
  };
  const toggle = async (k: keyof typeof prefs) => {
    const next = { ...prefs, [k]: !prefs[k] };
    setPrefs(next);
    try { onSaved(await call<Me>('/api/me', 'PATCH', { [k]: next[k] })); } catch (e) { flash(msg(e)); setPrefs(prefs); }
  };

  return (
    <div className="card form" style={{ marginTop: 10 }}>
      <div className="lbl"><Icon n="bell" /> Notificaciones en el móvil</div>
      {state === null ? <span className="note">Comprobando…</span>
        : state === 'on' ? (
          <>
            <span className="note ok">✅ Activadas en este dispositivo. Te llegarán aunque tengas la app cerrada.</span>
            <div className="two">
              <button className="btn sm" onClick={test}>Enviar prueba</button>
              <button className="btn ghost sm" disabled={busy} onClick={disable}>Desactivar aquí</button>
            </div>
          </>
        ) : state === 'off' ? (
          <>
            <span className="note">Recibe los avisos como en WhatsApp: encuestas, partidos, cambios y mensajes.</span>
            <button className="btn primary sm" disabled={busy} onClick={enable}>{busy ? 'Activando…' : 'Activar notificaciones'}</button>
          </>
        ) : state === 'denied' ? (
          <span className="errtxt">Has bloqueado las notificaciones para esta web. Actívalas en los ajustes del navegador (icono del candado junto a la dirección) y vuelve aquí.</span>
        ) : state === 'ios-needs-install' ? <IosInstallSteps />
          : <span className="note">Este navegador no admite notificaciones. Prueba con Chrome, Edge, Firefox o Safari actualizado.</span>}

      <div className="lbl" style={{ marginTop: 8 }}>Avisarme de…</div>
      {([
        ['notifyMatches', 'Partidos nuevos y cambios'],
        ['notifyPolls', 'Encuestas nuevas'],
        ['notifyChat', 'Mensajes del chat'],
      ] as [keyof typeof prefs, string][]).map(([k, label]) => (
        <button key={k} className={`togglerow${prefs[k] ? ' on' : ''}`} onClick={() => toggle(k)} aria-pressed={prefs[k]}>
          <span>{label}</span><i />
        </button>
      ))}
      <span className="note">Se aplica a todos tus dispositivos. La campana de la app siempre guarda los avisos.</span>
    </div>
  );
}

function IosInstallSteps() {
  return (
    <div className="iosbox">
      <b>En iPhone hay que instalar la app primero</b>
      <ol>
        <li>Abre esta web en <b>Safari</b>.</li>
        <li>Pulsa <b>Compartir</b> (el cuadrado con la flecha hacia arriba).</li>
        <li>Elige <b>“Añadir a pantalla de inicio”</b>.</li>
        <li>Abre Equilibrio FC <b>desde el icono nuevo</b>, entra en tu perfil y pulsa “Activar notificaciones”.</li>
      </ol>
      <small>Hace falta iOS 16.4 o posterior.</small>
    </div>
  );
}

/** Aviso en Partidos para activar las notificaciones (o instalar la app en iPhone). */
function PushBanner({ call, flash }: { call: Call; flash: (m: string) => void }) {
  const [state, setState] = useState<PushState | null>(null);
  const [hidden, setHidden] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    try { setHidden(localStorage.getItem(PUSH_DISMISSED) === '1'); } catch { setHidden(false); }
    pushState().then(setState);
  }, []);
  const dismiss = () => { setHidden(true); try { localStorage.setItem(PUSH_DISMISSED, '1'); } catch { /* nada */ } };
  if (hidden || !state || (state !== 'off' && state !== 'ios-needs-install')) return null;
  if (state === 'ios-needs-install') {
    return (
      <div className="card pushbanner">
        <IosInstallSteps />
        <button className="btn ghost sm" onClick={dismiss}>Ahora no</button>
      </div>
    );
  }
  const enable = async () => {
    setBusy(true);
    try {
      await call('/api/push/subscribe', 'POST', await subscribePush());
      flash('Notificaciones activadas');
      setState('on');
    } catch (e) { flash(msg(e)); setState(await pushState()); } finally { setBusy(false); }
  };
  return (
    <div className="card pushbanner">
      <b><Icon n="bell" /> Activa las notificaciones</b>
      <span>Entérate al momento de encuestas, partidos nuevos, cambios y mensajes, aunque tengas la app cerrada.</span>
      <div className="two">
        <button className="btn primary sm" disabled={busy} onClick={enable}>{busy ? 'Activando…' : 'Activar'}</button>
        <button className="btn ghost sm" onClick={dismiss}>Ahora no</button>
      </div>
    </div>
  );
}

/* ================================== Hojas ================================== */
function PlayerSheet({ init, groupId, myRole, meId, accounts, call, flash, onClose, onDone }: {
  init: PlayerInit; groupId: string; myRole: Role; meId: string; accounts: Player[];
  call: Call; flash: (m: string) => void; onClose: () => void; onDone: () => void;
}) {
  const [s, setS] = useState(init);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mergeInto, setMergeInto] = useState('');
  const isMe = s.id === meId;
  const canRemove = !!s.id && s.role !== 'owner' && (myRole === 'owner' || s.role === 'member');
  const setRole = async (role: Role) => {
    setBusy(true);
    try {
      await call(`/api/groups/${groupId}/players/${s.id}/role`, 'PATCH', { role });
      flash(role === 'co_admin' ? `${s.name} ahora es co-admin` : `${s.name} ya no es co-admin`);
      onDone();
    } catch (e) { flash(msg(e)); setBusy(false); }
  };
  const merge = async () => {
    const target = accounts.find((a) => a.id === mergeInto);
    if (!target || !confirm(`¿${s.name} es la misma persona que ${target.name}? Su historial y sus grupos pasarán a la cuenta de ${target.name}.`)) return;
    setBusy(true);
    try {
      await call(`/api/groups/${groupId}/players/${s.id}/merge`, 'POST', { intoPlayerId: mergeInto });
      flash('Jugadores unidos');
      onDone();
    } catch (e) { flash(msg(e)); setBusy(false); }
  };
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!init.id) nameRef.current?.focus(); }, [init.id]);

  const save = async () => {
    if (!s.name.trim()) { flash('Escribe un nombre'); nameRef.current?.focus(); return; }
    setBusy(true);
    try {
      // Con cuenta, nombre/apodo/apellido son del propio jugador: aquí solo posición y estrellas
      const body = s.hasAccount ? { pos: s.pos, stars: s.stars }
        : { name: s.name.trim(), nick: s.nick.trim(), lastName: s.lastName.trim(), pos: s.pos, stars: s.stars };
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
      <label htmlFor="f-name">Nombre{s.hasAccount && <span className="lockt" style={{ marginLeft: 'auto' }}>lo cambia el jugador en su perfil</span>}</label>
      <input id="f-name" ref={nameRef} value={s.name} onChange={(e) => setS({ ...s, name: e.target.value })} autoComplete="off" disabled={!!s.hasAccount} />
      <div className="two" style={{ marginTop: 6 }}>
        <div><label htmlFor="f-last">Apellido</label>
          <input id="f-last" value={s.lastName} onChange={(e) => setS({ ...s, lastName: e.target.value })} autoComplete="off" disabled={!!s.hasAccount} /></div>
        <div><label htmlFor="f-nick">Apodo</label>
          <input id="f-nick" value={s.nick} onChange={(e) => setS({ ...s, nick: e.target.value })} autoComplete="off" disabled={!!s.hasAccount} /></div>
      </div>
      <span className="note">Con apodo se verá “{s.name || 'Nombre'} '{s.nick || 'apodo'}'”; con apellido, “{s.name || 'Nombre'} {(s.lastName || 'A').charAt(0).toUpperCase()}.”. No puede haber dos iguales en el grupo.</span>
      <div className="lbl" style={{ marginTop: 6 }}>Posición principal</div>
      <div className="seg">
        {(['GK', 'DEF', 'ATT'] as Pos[]).map((k) => (
          <button key={k} className={s.pos === k ? 'on' : ''} onClick={() => setS({ ...s, pos: k })}>{POS[k].label}</button>
        ))}
      </div>
      <div className="lbl" style={{ marginTop: 6 }}>Valoración<span className="lockt"><Icon n="lock" /> solo la ves tú</span></div>
      <div className="starbox"><Stars v={s.stars} size={34} onPick={(v) => setS({ ...s, stars: Math.max(1, v) })} /><b className="big">{f1(s.stars)}</b></div>
      {s.id && myRole === 'owner' && s.hasAccount && !isMe && s.role !== 'owner' && (
        <button className="btn block" style={{ marginTop: 10 }} disabled={busy} onClick={() => setRole(s.role === 'co_admin' ? 'member' : 'co_admin')}>
          {s.role === 'co_admin' ? 'Quitar co-admin' : 'Hacer co-admin (podrá crear partidos y gestionar la plantilla)'}
        </button>
      )}
      {s.id && !s.hasAccount && accounts.length > 0 && (
        <div className="card form" style={{ marginTop: 10 }}>
          <label htmlFor="f-merge">¿Se ha registrado? Unir con su cuenta</label>
          <select id="f-merge" value={mergeInto} onChange={(e) => setMergeInto(e.target.value)}>
            <option value="">Elige su cuenta…</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.displayName ?? a.name}</option>)}
          </select>
          <button className="btn sm" disabled={!mergeInto || busy} onClick={merge}>Unir (conserva su historial)</button>
        </div>
      )}
      <div className="sheet-actions">
        {canRemove && <button className="btn danger" onClick={del}>{confirmDel ? 'Pulsa otra vez' : isMe ? 'Salir del grupo' : 'Quitar del grupo'}</button>}
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
  type Sug = { id: string; name: string; nick: string | null; pos: Pos; fromGroups: string[] };
  const [all, setAll] = useState<Sug[] | null>(null);
  const [pid, setPid] = useState('');
  const [stars, setStars] = useState(3);
  useEffect(() => {
    // Solo jugadores ACTIVOS de tus OTROS grupos que no están ya aquí (sin huérfanos)
    call<Sug[]>(`/api/players?groupId=${groupId}`).then(setAll).catch((e) => { flash(msg(e)); setAll([]); });
  }, [call, flash, groupId]);
  const save = async () => {
    try {
      await call(`/api/groups/${groupId}/players`, 'POST', { playerId: pid, stars });
      flash('Jugador añadido al grupo');
      onDone();
    } catch (e) { flash(msg(e)); }
  };
  return (
    <SheetShell title="Jugador de otro grupo" onClose={onClose}>
      {all === null ? <div className="note">Cargando…</div> : all.length === 0 ? (
        <div className="empty">No hay jugadores de tus otros grupos que añadir.</div>
      ) : (
        <>
          <label htmlFor="e-sel">Jugador</label>
          <select id="e-sel" value={pid} onChange={(e) => setPid(e.target.value)}>
            <option value="">Elige un jugador…</option>
            {all.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.fromGroups.join(', ')}</option>)}
          </select>
          <div className="lbl" style={{ marginTop: 6 }}>Valoración en este grupo</div>
          <div className="starbox"><Stars v={stars} size={34} onPick={(v) => setStars(Math.max(1, v))} /><b className="big">{f1(stars)}</b></div>
          <div className="sheet-actions"><button className="btn primary" disabled={!pid} onClick={save}>Añadir al grupo</button></div>
        </>
      )}
    </SheetShell>
  );
}

function ProfileSheet({ me, call, flash, onClose, onSaved, onLogout }: {
  me: Me; call: Call; flash: (m: string) => void; onClose: () => void; onSaved: (m: Me) => void; onLogout: () => void;
}) {
  const [s, setS] = useState({ name: me.name, nick: me.nick ?? '', lastName: me.lastName ?? '', pos: me.pos, level: me.level });
  const [busy, setBusy] = useState(false);
  const preview = s.nick.trim() ? `${s.name.trim()} '${s.nick.trim()}'` : s.lastName.trim() ? `${s.name.trim()} ${s.lastName.trim().charAt(0).toUpperCase()}.` : '';
  const save = async () => {
    if (!s.name.trim()) { flash('Escribe tu nombre'); return; }
    if (!s.nick.trim() && !s.lastName.trim()) { flash('Pon un apodo o un apellido'); return; }
    setBusy(true);
    try {
      const m = await call<Me>('/api/me', 'PATCH', { name: s.name.trim(), nick: s.nick.trim(), lastName: s.lastName.trim(), pos: s.pos, level: s.level });
      flash('Perfil guardado');
      onSaved(m);
    } catch (e) { flash(msg(e)); setBusy(false); }
  };
  return (
    <SheetShell title="Mi perfil" onClose={onClose}>
      <div className="note" style={{ marginBottom: 6 }}><Icon n="user" /><span>{me.email}</span></div>
      <label htmlFor="m-name">Nombre</label>
      <input id="m-name" value={s.name} maxLength={60} onChange={(e) => setS({ ...s, name: e.target.value })} />
      <div className="two" style={{ marginTop: 6 }}>
        <div><label htmlFor="m-last">Apellido</label><input id="m-last" value={s.lastName} maxLength={60} onChange={(e) => setS({ ...s, lastName: e.target.value })} /></div>
        <div><label htmlFor="m-nick">Apodo</label><input id="m-nick" value={s.nick} maxLength={60} onChange={(e) => setS({ ...s, nick: e.target.value })} /></div>
      </div>
      {preview
        ? <span className="note">En tus grupos te verán como <b>&nbsp;{preview}</b>{s.nick.trim() && s.lastName.trim() ? ' (manda el apodo)' : ''}</span>
        : <span className="errtxt">Obligatorio: pon un apodo o un apellido para que no haya dos iguales en el grupo.</span>}
      <div className="lbl" style={{ marginTop: 6 }}>Posición preferida</div>
      <div className="seg">
        {(['GK', 'DEF', 'ATT'] as Pos[]).map((k) => (
          <button key={k} className={s.pos === k ? 'on' : ''} onClick={() => setS({ ...s, pos: k })}>{POS[k].label}</button>
        ))}
      </div>
      <div className="lbl" style={{ marginTop: 6 }}>Tu nivel<span className="lockt">el admin de cada grupo puede ajustarlo</span></div>
      <div className="starbox"><Stars v={s.level} size={34} onPick={(v) => setS({ ...s, level: Math.max(1, v) })} /><b className="big">{f1(s.level)}</b></div>
      <PushSettings me={me} call={call} flash={flash} onSaved={onSaved} />
      <div className="sheet-actions">
        <button className="btn ghost" onClick={onLogout}>Cerrar sesión</button>
        <button className="btn primary" onClick={save} disabled={busy}>Guardar</button>
      </div>
    </SheetShell>
  );
}

/** Eliminar grupo: irreversible, hay que escribir el nombre para confirmar (solo el creador). */
function DeleteGroupSheet({ group, call, flash, onClose, onDone }: {
  group: { id: string; name: string }; call: Call; flash: (m: string) => void; onClose: () => void; onDone: () => void;
}) {
  const [txt, setTxt] = useState('');
  const [busy, setBusy] = useState(false);
  const del = async () => {
    setBusy(true);
    try {
      await call(`/api/groups/${group.id}`, 'DELETE');
      flash('Grupo eliminado');
      onDone();
    } catch (e) { flash(msg(e)); setBusy(false); }
  };
  return (
    <SheetShell title="Eliminar grupo" onClose={onClose}>
      <div className="alert err">
        <b>Esta acción es irreversible.</b>
        <span>Se borrarán para siempre el chat, las encuestas, todos los partidos (también el historial y las estadísticas) y la lista de miembros de “{group.name}”.</span>
      </div>
      <label htmlFor="dg" style={{ marginTop: 10 }}>Escribe el nombre del grupo para confirmar</label>
      <input id="dg" value={txt} onChange={(e) => setTxt(e.target.value)} placeholder={group.name} autoComplete="off" />
      <div className="sheet-actions">
        <button className="btn" onClick={onClose}>Cancelar</button>
        <button className="btn danger" disabled={busy || txt.trim() !== group.name.trim()} onClick={del}>Eliminar para siempre</button>
      </div>
    </SheetShell>
  );
}

/** Enlace de invitación + acciones del grupo (Plantilla). */
function GroupAdmin({ groupId, call, flash, version, onDelete, onLeave }: {
  groupId: string; call: Call; flash: (m: string) => void; version: number; onDelete: () => void; onLeave: () => void;
}) {
  const [info, setInfo] = useState<GroupInfo | null>(null);
  const [days, setDays] = useState('7');
  const load = useCallback(() => { call<GroupInfo>(`/api/groups/${groupId}`).then(setInfo).catch((e) => flash(msg(e))); }, [call, groupId, flash]);
  useEffect(() => { setInfo(null); load(); }, [load, version]);
  if (!info) return null;
  const inv = info.invite;
  const expired = !!inv?.expiresAt && new Date(inv.expiresAt).getTime() < Date.now();

  const share = async () => {
    if (!inv) return;
    try {
      if (navigator.share && /Mobi|Android|iPhone/i.test(navigator.userAgent)) {
        await navigator.share({ title: info.name, text: `Únete a “${info.name}” en Equilibrio FC`, url: inv.url });
      } else {
        await navigator.clipboard.writeText(inv.url);
        flash('Enlace copiado');
      }
    } catch { /* cancelado */ }
  };
  const regenerate = async () => {
    if (!confirm('El enlace actual dejará de funcionar. ¿Crear uno nuevo?')) return;
    try {
      await call(`/api/groups/${groupId}/invite`, 'POST', { expiresInDays: days === 'never' ? null : Number(days) });
      flash('Nuevo enlace creado');
      load();
    } catch (e) { flash(msg(e)); }
  };

  return (
    <>
      {inv && (
        <div className="card form">
          <div className="lbl"><Icon n="link" /> Enlace de invitación</div>
          <input readOnly value={inv.url} onFocus={(e) => e.target.select()} style={{ fontSize: 12.5 }} />
          <span className={expired ? 'warnbox' : 'note'}>
            {inv.expiresAt ? `${expired ? 'Caducó' : 'Caduca'} el ${cap1(fmtD(inv.expiresAt, { weekday: 'long', day: 'numeric', month: 'long' }))}` : 'No caduca'}
            {' · '}quien lo abra se registra y entra al grupo.
          </span>
          <div className="two">
            <button className="btn primary sm" disabled={expired} onClick={share}>Compartir</button>
            <button className="btn sm" onClick={regenerate}>Nuevo enlace</button>
          </div>
          <select value={days} onChange={(e) => setDays(e.target.value)} aria-label="Caducidad del nuevo enlace" style={{ height: 38, fontSize: 13 }}>
            <option value="1">El nuevo enlace caduca en 1 día</option>
            <option value="7">El nuevo enlace caduca en 7 días</option>
            <option value="30">El nuevo enlace caduca en 30 días</option>
            <option value="never">El nuevo enlace no caduca</option>
          </select>
        </div>
      )}
      {info.role === 'owner'
        ? <button className="btn danger block" onClick={onDelete}>Eliminar grupo</button>
        : <button className="btn ghost block" onClick={onLeave}>Salir del grupo</button>}
    </>
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

/* ================================== Chat ================================== */
const whenLabel = (iso: string) => `${cap1(fmtD(iso, { weekday: 'long', day: 'numeric', month: 'short' }))} · ${hhmm(iso)}`;

function rowToMsg(r: Record<string, unknown>, names: Map<string, { name: string; nick: string | null }>): ChatMsg {
  const pid = (r.player_id as string | null) ?? null;
  const who = pid ? names.get(pid) : undefined;
  return {
    id: String(r.id), groupId: String(r.group_id), playerId: pid, type: r.type as ChatMsg['type'],
    content: String(r.content ?? ''), pollId: (r.poll_id as string | null) ?? null,
    metadata: (r.metadata as ChatMsg['metadata']) ?? {}, createdAt: String(r.created_at),
    authorName: who?.name ?? null, authorNick: who?.nick ?? null,
  };
}

function PollCard({ poll, meId, manage, onVote, onCreateMatch, onOpenMatch, onToggle, onAddGuest, onRemoveGuest }: {
  poll: Poll; meId: string; manage: boolean;
  onVote: (c: Choice) => Promise<void>; onCreateMatch: () => void; onOpenMatch: (id: string) => void; onToggle: () => Promise<void>;
  onAddGuest: (g: GuestDraft) => Promise<void>; onRemoveGuest: (guestId: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [guestOpen, setGuestOpen] = useState(false);
  const enough = poll.confirmed.length >= MIN_PLAYERS;
  const closed = poll.status === 'closed';
  const fill = poll.maxSlots ? Math.min(100, (poll.counts.yes / poll.maxSlots) * 100) : 0;
  const waitPos = poll.waitlist.findIndex((u) => u.id === meId);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };
  const OPTS: [Choice, string, number][] = [
    ['yes', '✅ Me apunto', poll.counts.yes + poll.counts.waitlist],
    ['no', '❌ No puedo', poll.counts.no],
    ['maybe', '🤔 Duda', poll.counts.maybe],
  ];
  const people = (title: string, list: PollUser[], cls: string, numbered = false) =>
    list.length > 0 && (
      <div className="plist">
        <div className={`plt ${cls}`}>{title} · {list.length}</div>
        <div className="pchips">
          {list.map((u, i) => (
            <span key={u.id} className={`pchip${u.guest ? ' guest' : ''}`}>
              {numbered ? `${i + 1}. ` : ''}{u.name}{u.pos === 'GK' ? ' 🧤' : ''}{u.guest ? ' · inv.' : ''}
              {u.guest && manage && !closed && (
                <button className="pchipx" aria-label={`Quitar invitado ${u.name}`} onClick={() => run(() => onRemoveGuest(u.id))}>×</button>
              )}
            </span>
          ))}
        </div>
      </div>
    );

  return (
    <div className="card pollcard">
      <div className="eyebrow">Encuesta de asistencia</div>
      <b className="pq">{poll.question}</b>
      <span className="note"><Icon n="matches" /><span>{whenLabel(poll.matchAt)}{poll.format && MOD[poll.format] ? ` · ${MOD[poll.format].label}` : ''}</span></span>
      <div className="pcount">
        <b>{poll.maxSlots ? `${poll.counts.yes}/${poll.maxSlots}` : poll.counts.yes}</b>
        <span>{poll.maxSlots ? 'plazas ocupadas' : 'se apuntan'}{poll.counts.waitlist > 0 ? ` · ${poll.counts.waitlist} en espera` : ''}</span>
        {closed && <span className="chip">Cerrada</span>}
      </div>
      {poll.maxSlots && <div className="wbar"><i style={{ width: fill + '%', background: fill >= 100 ? 'var(--warn)' : undefined }} /></div>}
      <div className="pvotes">
        {OPTS.map(([c, label, n]) => (
          <button key={c} className={`pvote${poll.myVote === c ? ' on ' + c : ''}`} disabled={closed || busy}
            onClick={() => poll.myVote !== c && run(() => onVote(c))}>
            <span>{label}</span><b>{n}</b>
          </button>
        ))}
      </div>
      {poll.myStatus === 'waitlist' && (
        <div className="warnbox"><Icon n="warn" /><span>Cupo completo: estás en lista de espera{waitPos >= 0 ? ` (nº ${waitPos + 1})` : ''}. Entras solo si alguien se borra.</span></div>
      )}
      {people('Confirmados', poll.confirmed, 'ok')}
      {people('Lista de espera', poll.waitlist, 'wait', true)}
      {people('Duda', poll.maybe, 'maybe')}
      {people('No pueden', poll.no, 'no')}
      {poll.matchId ? (
        <button className="btn sm" onClick={() => onOpenMatch(poll.matchId as string)}>Ver partido creado <Icon n="chev" /></button>
      ) : manage && (
        <>
          {!closed && (guestOpen
            ? <GuestForm busy={busy} onAdd={(g) => run(() => onAddGuest(g))} />
            : <button className="btn ghost sm" onClick={() => setGuestOpen(true)}><Icon n="plus" /> Añadir invitado</button>)}
          {!enough && <div className="errtxt">No son suficientes jugadores para crear un partido (mínimo {MIN_PLAYERS}). Ahora hay {poll.confirmed.length}.</div>}
          <button className="btn primary sm" disabled={!enough} onClick={onCreateMatch}>
            <Icon n="plus" /> Crear Partido con Confirmados
          </button>
          <button className="btn ghost sm" disabled={busy} onClick={() => run(onToggle)}>{closed ? 'Reabrir encuesta' : 'Cerrar encuesta'}</button>
        </>
      )}
    </div>
  );
}

function PollSheet({ groupId, call, flash, onClose, onCreated }: {
  groupId: string; call: Call; flash: (m: string) => void; onClose: () => void; onCreated: (m: ChatMsg) => void;
}) {
  const [when, setWhen] = useState(`${nextThursday()}T21:00`);
  const [minWhen, setMinWhen] = useState(minDT);
  const [mod, setMod] = useState('7v7');
  const [limit, setLimit] = useState(true);
  const [slots, setSlots] = useState(14);
  const [q, setQ] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!touched && isFutureDT(when)) setQ(`¿Quién se apunta al partido del ${fmtD(new Date(when).toISOString(), { weekday: 'long', day: 'numeric' })} a las ${hhmm(new Date(when).toISOString())}?`);
  }, [when, touched]);
  const ok = isFutureDT(when) && q.trim().length > 0;
  const save = async () => {
    if (!isFutureDT(when)) { flash('La fecha debe ser posterior a este momento'); return; }
    setBusy(true);
    try {
      const m = await call<ChatMsg>(`/api/groups/${groupId}/polls`, 'POST', {
        question: q.trim(), matchAt: new Date(when).toISOString(), format: mod, maxSlots: limit ? Math.max(1, slots) : null,
      });
      onCreated(m);
      onClose();
    } catch (e) { flash(msg(e)); setBusy(false); }
  };
  return (
    <SheetShell title="Nueva encuesta" onClose={onClose}>
      <label htmlFor="p-when">Fecha y hora del partido</label>
      <input id="p-when" type="datetime-local" value={when} min={minWhen} onFocus={() => setMinWhen(minDT())} onChange={(e) => setWhen(e.target.value)} />
      {!isFutureDT(when) && <div className="warnbox"><Icon n="warn" /><span>Elige una fecha y hora futuras.</span></div>}
      <div className="lbl" style={{ marginTop: 6 }}>Modalidad</div>
      <div className="seg">
        {Object.keys(MOD).map((k) => (
          <button key={k} className={mod === k ? 'on' : ''} onClick={() => { setMod(k); setSlots(MOD[k].n * 2); }}>{MOD[k].short}</button>
        ))}
      </div>
      <label htmlFor="p-q" style={{ marginTop: 6 }}>Pregunta</label>
      <input id="p-q" value={q} maxLength={200} onChange={(e) => { setTouched(true); setQ(e.target.value); }} />
      <div className="lbl" style={{ marginTop: 6 }}>Cupo</div>
      <div className="two">
        <div className="seg">
          <button className={limit ? 'on' : ''} onClick={() => setLimit(true)}>Con cupo</button>
          <button className={!limit ? 'on' : ''} onClick={() => setLimit(false)}>Sin límite</button>
        </div>
        <input type="number" min={1} max={60} value={slots} disabled={!limit} aria-label="Plazas" inputMode="numeric"
          onChange={(e) => setSlots(e.target.value === '' ? 0 : Math.min(60, Math.max(0, Math.floor(Number(e.target.value)) || 0)))}
          onBlur={() => setSlots((v) => Math.max(1, v))} />
      </div>
      <div className="note" style={{ marginTop: 6 }}><span>Al llenarse el cupo, los siguientes que se apunten pasan a lista de espera automáticamente.</span></div>
      {limit && slots > 0 && slots < MIN_PLAYERS && <div className="errtxt">Con {slots} plaza{slots === 1 ? '' : 's'} no se podrá crear el partido desde la encuesta (mínimo {MIN_PLAYERS} jugadores).</div>}
      <div className="sheet-actions"><button className="btn primary" disabled={!ok || busy} onClick={save}>Publicar en el chat</button></div>
    </SheetShell>
  );
}

/** Chat del grupo en tiempo real (Supabase Realtime) con encuestas de asistencia. */
function ChatRoom({ groups, groupId, setGroupId, meId, call, flash, onOpenMatch, onCreateMatch, onRead }: {
  groups: Group[]; groupId: string; setGroupId: (id: string) => void; meId: string; call: Call; flash: (m: string) => void;
  onOpenMatch: (id: string) => void; onCreateMatch: (p: Prefill) => void; onRead: (groupId: string) => void;
}) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [pollOpen, setPollOpen] = useState(false);
  const [live, setLive] = useState(false);
  const scrollRef = useRef<HTMLElement>(null);
  const stick = useRef(true);
  const keepFrom = useRef<number | null>(null);
  const names = useRef(new Map<string, { name: string; nick: string | null }>());
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const manage = isManager(groups.find((g) => g.id === groupId)?.role);

  const upsert = useCallback((m: ChatMsg) => {
    setMsgs((prev) => {
      const old = prev.find((x) => x.id === m.id);
      if (old) return prev.map((x) => (x.id === m.id ? { ...x, ...m, poll: m.poll ?? x.poll, authorName: m.authorName ?? x.authorName } : x));
      return [...prev, m].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    });
  }, []);
  const setPoll = useCallback((poll: Poll) => setMsgs((prev) => prev.map((m) => (m.pollId === poll.id ? { ...m, poll } : m))), []);
  const refreshPoll = useCallback((pollId: string) => {
    clearTimeout(timers.current.get(pollId));
    timers.current.set(pollId, setTimeout(() => {
      timers.current.delete(pollId);
      call<Poll>(`/api/polls/${pollId}`).then(setPoll).catch(() => undefined);
    }, 250));
  }, [call, setPoll]);
  const loadNames = useCallback(async () => {
    const l = await call<Player[]>(`/api/groups/${groupId}/players`).catch(() => [] as Player[]);
    l.forEach((p) => names.current.set(p.id, { name: p.displayName ?? p.name, nick: p.nick }));
    setMsgs((prev) => prev.map((m) => (m.playerId && !m.authorName && names.current.has(m.playerId)
      ? { ...m, authorName: names.current.get(m.playerId)!.name, authorNick: names.current.get(m.playerId)!.nick } : m)));
  }, [call, groupId]);

  // Leído: al abrir el chat y con cada mensaje nuevo mientras está abierto (badge a 0)
  const onReadRef = useRef(onRead);
  onReadRef.current = onRead;
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markRead = useCallback(() => {
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => { if (groupId) onReadRef.current(groupId); }, 800);
  }, [groupId]);
  useEffect(() => () => { if (readTimer.current) clearTimeout(readTimer.current); }, []);

  // carga inicial
  useEffect(() => {
    if (!groupId) return;
    markRead();
    let off = false;
    setLoading(true);
    setMsgs([]);
    stick.current = true;
    names.current = new Map();
    loadNames();
    call<{ messages: ChatMsg[]; hasMore: boolean }>(`/api/groups/${groupId}/messages?limit=50`)
      .then((d) => { if (!off) { setMsgs(d.messages); setHasMore(d.hasMore); } })
      .catch((e) => flash(msg(e)))
      .finally(() => { if (!off) setLoading(false); });
    return () => { off = true; };
  }, [groupId, call, flash, loadNames]);

  // tiempo real
  useEffect(() => {
    if (!groupId) return;
    const client = sb();
    let ch: ReturnType<typeof client.channel> | null = null;
    let active = true;
    (async () => {
      const { data } = await client.auth.getSession();
      if (!active) return;
      if (data.session) client.realtime.setAuth(data.session.access_token);
      ch = client
        .channel(`chat-${groupId}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `group_id=eq.${groupId}` },
          (payload: { new: Record<string, unknown> }) => {
            const m = rowToMsg(payload.new, names.current);
            upsert(m);
            if (m.pollId) refreshPoll(m.pollId);
            if (m.playerId && !m.authorName) loadNames();
            markRead();
          })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'poll_guests', filter: `group_id=eq.${groupId}` },
          (payload: { new: Record<string, unknown> }) => refreshPoll(String(payload.new.poll_id)))
        .on('postgres_changes', { event: '*', schema: 'public', table: 'poll_votes', filter: `group_id=eq.${groupId}` },
          (payload: { new: Record<string, unknown>; old: Record<string, unknown> }) => {
            const id = (payload.new?.poll_id ?? payload.old?.poll_id) as string | undefined;
            if (id) refreshPoll(id);
          })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'polls', filter: `group_id=eq.${groupId}` },
          (payload: { new: Record<string, unknown> }) => refreshPoll(String(payload.new.id)))
        .subscribe((st: string) => setLive(st === 'SUBSCRIBED'));
    })();
    return () => { active = false; setLive(false); if (ch) client.removeChannel(ch); };
  }, [groupId, upsert, refreshPoll, loadNames, markRead]);

  // scroll: abajo salvo que estés leyendo mensajes antiguos
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (keepFrom.current !== null) { el.scrollTop = el.scrollHeight - keepFrom.current; keepFrom.current = null; }
    else if (stick.current) el.scrollTop = el.scrollHeight;
  }, [msgs]);

  const older = async () => {
    if (!msgs.length) return;
    try {
      const d = await call<{ messages: ChatMsg[]; hasMore: boolean }>(`/api/groups/${groupId}/messages?limit=50&before=${encodeURIComponent(msgs[0].createdAt)}`);
      const el = scrollRef.current;
      keepFrom.current = el ? el.scrollHeight - el.scrollTop : null;
      setMsgs((prev) => [...d.messages.filter((m) => !prev.some((x) => x.id === m.id)), ...prev]);
      setHasMore(d.hasMore);
    } catch (e) { flash(msg(e)); }
  };
  const send = async () => {
    const c = text.trim();
    if (!c || sending) return;
    setSending(true);
    try {
      const m = await call<ChatMsg>(`/api/groups/${groupId}/messages`, 'POST', { content: c });
      stick.current = true;
      upsert(m);
      setText('');
    } catch (e) { flash(msg(e)); } finally { setSending(false); }
  };
  const vote = async (p: Poll, choice: Choice) => {
    try { setPoll(await call<Poll>(`/api/polls/${p.id}/vote`, 'POST', { choice })); } catch (e) { flash(msg(e)); }
  };
  const addGuest = async (p: Poll, g: GuestDraft) => {
    try { setPoll(await call<Poll>(`/api/polls/${p.id}/guests`, 'POST', g)); } catch (e) { flash(msg(e)); }
  };
  const removeGuest = async (p: Poll, guestId: string) => {
    try { setPoll(await call<Poll>(`/api/polls/${p.id}/guests/${guestId}`, 'DELETE')); } catch (e) { flash(msg(e)); }
  };
  const toggle = async (p: Poll) => {
    try { setPoll(await call<Poll>(`/api/polls/${p.id}/close`, 'POST', { reopen: p.status === 'closed' })); } catch (e) { flash(msg(e)); }
  };

  if (!groups.length) {
    return <main className="main"><div className="empty">Crea un grupo en Plantilla o entra con un enlace de invitación para chatear.</div></main>;
  }

  return (
    <>
      <GroupSelect groups={groups} value={groupId} onChange={setGroupId} label={live ? 'Grupo · en directo' : 'Grupo'} />
      <main className="main chatlist" ref={scrollRef} onScroll={() => {
        const el = scrollRef.current;
        if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      }}>
        {hasMore && <button className="btn ghost sm" style={{ alignSelf: 'center' }} onClick={older}>Mensajes anteriores</button>}
        {loading ? <div className="empty">Cargando…</div> : msgs.length === 0 && (
          <div className="empty">Aún no hay mensajes. Abre la convocatoria con una encuesta 📊</div>
        )}
        {msgs.map((m, i) => {
          const prev = msgs[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
          const day = newDay ? <div className="daysep" key={'d' + m.id}>{cap1(fmtD(m.createdAt, { weekday: 'long', day: 'numeric', month: 'long' }))}</div> : null;
          if (m.type === 'system') {
            return (
              <div key={m.id} className="msgwrap">
                {day}
                <div className="sysmsg">
                  <span>{m.content}</span>
                  {m.metadata?.matchId && <button className="maps" onClick={() => onOpenMatch(m.metadata.matchId as string)}>Ver partido <Icon n="chev" /></button>}
                </div>
              </div>
            );
          }
          const mine = m.playerId === meId;
          const showName = !mine && (newDay || prev?.playerId !== m.playerId || prev?.type !== 'text');
          return (
            <div key={m.id} className={`msgwrap${mine ? ' mine' : ''}`}>
              {day}
              {showName && <div className="who">{m.authorNick || m.authorName || 'Jugador'}</div>}
              {m.type === 'poll' ? (
                m.poll ? (
                  <PollCard poll={m.poll} meId={meId} manage={manage}
                    onVote={(c) => vote(m.poll as Poll, c)}
                    onToggle={() => toggle(m.poll as Poll)}
                    onAddGuest={(g) => addGuest(m.poll as Poll, g)}
                    onRemoveGuest={(gid) => removeGuest(m.poll as Poll, gid)}
                    onOpenMatch={onOpenMatch}
                    onCreateMatch={() => {
                      const p = m.poll as Poll;
                      // Confirmados (sin lista de espera): miembros por id e invitados externos por nombre
                      onCreateMatch({
                        groupId, when: p.matchAt, pollId: p.id, format: p.format,
                        playerIds: p.confirmed.filter((u) => !u.guest).map((u) => u.id),
                        guests: p.confirmed.filter((u) => u.guest).map((u) => ({ name: u.name, stars: u.stars ?? 3, pos: u.pos })),
                      });
                    }} />
                ) : <div className="card note">Cargando encuesta…</div>
              ) : (
                <div className="bubble">{m.content}<small>{hhmm(m.createdAt)}</small></div>
              )}
            </div>
          );
        })}
      </main>
      <div className="chatbar">
        <button className="iconbtn" onClick={() => setPollOpen(true)} aria-label="Nueva encuesta de asistencia" title="Nueva encuesta"><Icon n="poll" /></button>
        <textarea value={text} rows={1} maxLength={2000} placeholder="Escribe un mensaje…" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
        <button className="iconbtn send" onClick={send} disabled={!text.trim() || sending} aria-label="Enviar"><Icon n="send" /></button>
      </div>
      {pollOpen && <PollSheet groupId={groupId} call={call} flash={flash} onClose={() => setPollOpen(false)}
        onCreated={(m) => { stick.current = true; upsert(m); }} />}
    </>
  );
}

/* ================================ Pestañas ================================ */
function SquadTab({ groups, groupId, setGroupId, call, flash, version, openPlayer, openGroup, openExisting, onDeleteGroup, onLeaveGroup }: {
  groups: Group[]; groupId: string; setGroupId: (id: string) => void; call: Call; flash: (m: string) => void; version: number;
  openPlayer: (p: PlayerInit, accounts: Player[]) => void; openGroup: () => void; openExisting: () => void;
  onDeleteGroup: () => void; onLeaveGroup: () => void;
}) {
  const role = groups.find((g) => g.id === groupId)?.role;
  const manage = isManager(role);
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
          <div className="note"><Icon n="lock" /><span>{manage
            ? `${all.length} jugadores · ${gk} porteros · media ${f1(avg)}★. Las estrellas solo las ven el admin y los co-admins.`
            : `${all.length} jugadores · ${gk} porteros. Eres ${ROLE_LABEL[role ?? 'member'].toLowerCase()} de este grupo.`}</span></div>
          <div className="filters">
            {([['ALL', 'Todos'], ['GK', 'Porteros'], ['DEF', 'Defensas'], ['ATT', 'Atacantes']] as [string, string][]).map(([k, l]) => (
              <button key={k} className={`fchip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k as 'ALL' | Pos)}>{l}</button>
            ))}
          </div>
          {players === null ? <div className="empty">Cargando…</div> : list.length === 0 ? (
            <div className="empty">Todavía no hay jugadores aquí. Pulsa “Jugador” para añadir el primero.</div>
          ) : list.map((p) => {
            const inner = (
              <>
                <Av name={p.displayName ?? p.name} />
                <span className="pname">
                  <b>{p.displayName ?? p.name}</b>
                  <small>{[POS[p.pos].label, p.role !== 'member' ? ROLE_LABEL[p.role] : '', p.hasAccount ? '' : 'sin cuenta'].filter(Boolean).join(' · ')}</small>
                </span>
                <PosChip pos={p.pos} />
                {manage ? <span><Stars v={p.stars} size={13} /></span> : <span />}
              </>
            );
            return manage ? (
              <button key={p.id} className="prow" onClick={() => openPlayer(
                { id: p.id, name: p.name, nick: p.nick ?? '', lastName: p.lastName ?? '', pos: p.pos, stars: Math.min(5, Math.max(1, p.stars)), role: p.role, hasAccount: p.hasAccount },
                all.filter((x) => x.hasAccount && x.id !== p.id)
              )}>{inner}</button>
            ) : <div key={p.id} className="prow">{inner}</div>;
          })}
          {manage && <button className="btn block" onClick={openExisting}>Añadir jugador de otro grupo</button>}
          {groupId && <GroupAdmin groupId={groupId} call={call} flash={flash} version={version} onDelete={onDeleteGroup} onLeave={onLeaveGroup} />}
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
  const manage = isManager(groups.find((g) => g.id === groupId)?.role);
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
  (manage ? all : []).forEach((p) => { // los ajustes de estrellas solo los ve quien gestiona el grupo
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
const TITLES: Record<Tab, string> = { matches: 'Partidos', chat: 'Chat', history: 'Historial', squad: 'Plantilla', stats: 'Estadísticas' };
const GROUP_KEY = 'eqfc-group';

function Main({ onLogout, startGroupId }: { onLogout: () => void; startGroupId?: string | null }) {
  const [tab, setTab] = useState<Tab>(startGroupId ? 'chat' : 'matches');
  const [view, setView] = useState<View>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [pending, setPending] = useState<MatchRow[]>([]);
  const [history, setHistory] = useState<HistRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [sheet, setSheet] = useState<SheetState>(null);
  const [groupId, setGroupIdState] = useState(startGroupId ?? '');
  const [version, setVersion] = useState(0);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [freshIds, setFreshIds] = useState<string[]>([]); // partidos nuevos/modificados que se están viendo ahora

  // El grupo elegido se recuerda en este navegador y es el mismo en Chat, Plantilla y Estadísticas.
  const setGroupId = useCallback((id: string) => {
    setGroupIdState(id);
    try { localStorage.setItem(GROUP_KEY, id); } catch { /* sin almacenamiento */ }
  }, []);
  useEffect(() => {
    if (startGroupId) { setGroupId(startGroupId); return; }
    try { const g = localStorage.getItem(GROUP_KEY); if (g) setGroupIdState(g); } catch { /* sin almacenamiento */ }
  }, [startGroupId, setGroupId]);

  const call: Call = useCallback(<T,>(path: string, method = 'GET', body?: unknown) => api<T>(path, method, body), []);
  const flash = useCallback((m: string) => setToastMsg(m), []);
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(''), 2600);
    return () => clearTimeout(t);
  }, [toastMsg]);

  useEffect(() => { call<Me>('/api/me').then(setMe).catch((e) => { if (e instanceof AuthError) onLogout(); else setError(msg(e)); }); }, [call, onLogout]);

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
    if (!loaded) return;
    if (groups.length && !groups.some((g) => g.id === groupId)) setGroupId(groups[0].id);
    if (!groups.length && groupId) setGroupIdState('');
  }, [groups, groupId, loaded, setGroupId]);

  /* ---------- notificaciones push: service worker, enlaces de las notificaciones ---------- */
  const openUrl = useCallback((href: string) => {
    let u: URL;
    try { u = new URL(href, window.location.origin); } catch { return; }
    const match = u.searchParams.get('match');
    const group = u.searchParams.get('group');
    if (match) { setView({ t: 'match', id: match }); return; }
    if (group) { setGroupId(group); setView(null); setTab(u.searchParams.get('tab') === 'chat' ? 'chat' : 'matches'); }
  }, [setGroupId]);
  useEffect(() => {
    // Al abrir la app desde una notificación (/?match=… o /?group=…&tab=chat)
    if (window.location.search) { openUrl(window.location.href); window.history.replaceState(null, '', '/'); }
    registerSW().then(async () => {
      // Si este dispositivo ya tenía permiso, se vuelve a asociar a la cuenta (p. ej. tras cambiar de usuario)
      const sub = await currentSubscription().catch(() => null);
      if (sub) call('/api/push/subscribe', 'POST', sub).catch(() => undefined);
    });
    if (!('serviceWorker' in navigator)) return;
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'open' && typeof e.data.url === 'string') openUrl(e.data.url); };
    navigator.serviceWorker.addEventListener('message', onMsg);
    return () => navigator.serviceWorker.removeEventListener('message', onMsg);
  }, [openUrl, call]);

  /* ---------- avisos: campana, mensajes sin leer y partidos nuevos ---------- */
  const loadNotifs = useCallback(() => {
    call<{ items: Notif[]; unread: number }>('/api/notifications').then((r) => { setNotifs(r.items); setUnreadNotifs(r.unread); }).catch(() => undefined);
  }, [call]);
  useEffect(() => { loadNotifs(); }, [loadNotifs]);

  const markChatRead = useCallback((gid: string) => {
    setGroups((l) => l.map((g) => (g.id === gid ? { ...g, unreadChat: 0 } : g)));
    call(`/api/groups/${gid}/read`, 'POST', { what: 'chat' }).catch(() => undefined);
  }, [call]);

  // Al entrar en Partidos: se marcan como vistos, pero la etiqueta "Nuevo" se mantiene mientras sigas aquí
  const anyNewMatches = groups.some((g) => g.newMatches > 0);
  useEffect(() => {
    if (tab !== 'matches' || view || !loaded) { if (tab !== 'matches') setFreshIds([]); return; }
    if (!anyNewMatches) return;
    setFreshIds((f) => [...new Set([...f, ...pending.filter((m) => m.isNew).map((m) => m.id)])]);
    setGroups((l) => l.map((g) => ({ ...g, newMatches: 0 })));
    call('/api/matches/seen', 'POST', {}).catch(() => undefined);
  }, [tab, view, loaded, anyNewMatches, pending, call]);

  // Tiempo real de toda la app: mensajes de todos mis grupos (badges) y mis notificaciones (campana)
  const live = useRef({ tab, groupId, view });
  live.current = { tab, groupId, view };
  const groupIds = groups.map((g) => g.id).sort().join(',');
  useEffect(() => {
    if (!me || !groupIds) return;
    const client = sb();
    let ch: ReturnType<typeof client.channel> | null = null;
    let active = true;
    (async () => {
      const { data } = await client.auth.getSession();
      if (!active) return;
      if (data.session) client.realtime.setAuth(data.session.access_token);
      ch = client
        .channel(`app-${me.id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'chat_messages', filter: `group_id=in.(${groupIds})` },
          (payload: { new: Record<string, unknown> }) => {
            const r = payload.new;
            const gid = String(r.group_id);
            const meta = (r.metadata ?? {}) as { event?: string };
            if (meta.event === 'match_created' || meta.event === 'match_updated') refresh();
            if (r.player_id === me.id) return;
            const v = live.current;
            if (v.tab === 'chat' && !v.view && v.groupId === gid) return; // lo estás viendo
            setGroups((l) => l.map((g) => (g.id === gid ? { ...g, unreadChat: g.unreadChat + 1 } : g)));
          })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `player_id=eq.${me.id}` },
          () => loadNotifs())
        .subscribe();
    })();
    return () => { active = false; if (ch) client.removeChannel(ch); };
  }, [me, groupIds, refresh, loadNotifs]);

  const openNotif = (n: Notif) => {
    setBellOpen(false);
    if (!n.readAt) {
      setNotifs((l) => l.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)));
      setUnreadNotifs((u) => Math.max(0, u - 1));
      call('/api/notifications/read', 'POST', { ids: [n.id] }).catch(() => undefined);
    }
    if (n.data?.matchId) setView({ t: 'match', id: n.data.matchId });
    else if (n.groupId) { setGroupId(n.groupId); setView(null); setTab('chat'); }
  };
  const readAll = () => {
    setNotifs((l) => l.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })));
    setUnreadNotifs(0);
    call('/api/notifications/read', 'POST', { all: true }).catch(() => undefined);
  };
  const unreadChatTotal = groups.reduce((a, g) => a + (g.unreadChat || 0), 0);

  const managed = groups.filter((g) => isManager(g.role));
  const managedIds = new Set(managed.map((g) => g.id));
  const toResult = history.filter((h) => h.needsResult && managedIds.has(h.groupId));
  const current = groups.find((g) => g.id === groupId);
  const bump = () => { setVersion((v) => v + 1); refresh(); };

  const leaveGroup = async () => {
    if (!me || !current || !confirm(`¿Salir del grupo “${current.name}”?`)) return;
    try {
      await call(`/api/groups/${current.id}/players/${me.id}`, 'DELETE');
      flash('Has salido del grupo');
      setGroupIdState('');
      bump();
    } catch (e) { flash(msg(e)); }
  };

  let screen: ReactNode;
  if (view && view.t === 'edit') {
    screen = (
      <MatchEditor key={view.id} id={view.id} call={call} flash={flash}
        onClose={() => setView({ t: 'match', id: view.id })}
        onSaved={() => { setView({ t: 'match', id: view.id }); refresh(); }} />
    );
  } else if (view && view.t === 'new') {
    screen = (
      <NewMatch groups={managed} prefill={view.prefill} call={call} flash={flash} onClose={() => setView(null)}
        onCreated={(id) => { setView({ t: 'match', id, pack: true }); setTab('matches'); refresh(); }} />
    );
  } else if (view && view.t === 'match') {
    screen = (
      <MatchView key={view.id} id={view.id} startPack={!!view.pack} call={call} flash={flash}
        onBack={() => { setView(null); refresh(); }} onChanged={refresh}
        openText={(text) => setSheet({ t: 'text', text })}
        openResult={(info) => setSheet({ t: 'result', ...info })}
        onEdit={() => setView({ t: 'edit', id: view.id })} />
    );
  } else {
    const withGroup = tab === 'squad' || tab === 'stats' || tab === 'chat';
    const eyebrow = withGroup && current ? `Equilibrio FC · ${current.name}` : 'Equilibrio FC';
    const bell = (
      <button className="iconbtn bellbtn" onClick={() => setBellOpen(true)} aria-label={`Avisos${unreadNotifs ? ` (${unreadNotifs} sin leer)` : ''}`}>
        <Icon n="bell" />{unreadNotifs > 0 && <span className="dot">{badgeTxt(unreadNotifs)}</span>}
      </button>
    );
    const right = (
      <span className="hdr-actions">
        {tab === 'squad' && isManager(current?.role) && (
          <button className="btn primary sm" onClick={() => setSheet({ t: 'player', init: { name: '', nick: '', lastName: '', pos: 'DEF', stars: 3 }, accounts: [] })}><Icon n="plus" /> Jugador</button>
        )}
        {bell}
        {tab === 'matches' && <button className="iconbtn" onClick={() => setSheet({ t: 'profile' })} aria-label="Mi perfil"><Icon n="user" /></button>}
      </span>
    );
    screen = (
      <>
        <Hdr eyebrow={eyebrow} title={TITLES[tab]} right={right} />
        {tab === 'chat' ? (
          <ChatRoom groups={groups} groupId={groupId} setGroupId={setGroupId} meId={me?.id ?? ''} call={call} flash={flash}
            onOpenMatch={(id) => setView({ t: 'match', id })}
            onCreateMatch={(prefill) => setView({ t: 'new', prefill })}
            onRead={markChatRead} />
        ) : (
          <main className="main" key={tab}>
            {error && <div className="alert err">No se pudo conectar con el servidor: {error}</div>}
            {me && !me.nick && !me.lastName && (
              <div className="alert">
                <b>Completa tu perfil: añade un apodo o tu apellido</b>
                <span>Así nadie se confunde contigo en las convocatorias (p. ej. “{me.name} M.”).</span>
                <button className="btn primary sm" style={{ alignSelf: 'flex-start' }} onClick={() => setSheet({ t: 'profile' })}>Completar perfil</button>
              </div>
            )}
            {toResult.length > 0 && tab !== 'history' && (
              <div className="alert">
                <b>El partido ya se ha jugado. ¡Vota al MVP y registra el resultado!</b>
                <span>{toResult.length === 1 ? '1 partido espera' : `${toResult.length} partidos esperan`} resultado.</span>
                <button className="btn primary sm" style={{ alignSelf: 'flex-start' }} onClick={() => setTab('history')}>Ir al Historial</button>
              </div>
            )}

            {tab === 'matches' && (
              <>
                {loaded && <PushBanner call={call} flash={flash} />}
                {managed.length > 0 && <button className="btn primary block" onClick={() => setView({ t: 'new' })}><Icon n="plus" /> Nuevo partido</button>}
                {loaded && groups.length === 0 && (
                  <div className="empty">Aún no estás en ningún grupo. Crea el tuyo en Plantilla o pide a tu admin el enlace de invitación.</div>
                )}
                <h2 className="sec">Próximos</h2>
                {!loaded ? <div className="empty">Cargando…</div> : pending.length === 0 ? (
                  <div className="empty">No hay partidos próximos. Convoca con una encuesta en el Chat o crea uno directamente.</div>
                ) : pending.map((m) => (
                  <MatchCard key={m.id} m={m} count={m.playersCount} fresh={!!m.isNew || freshIds.includes(m.id)}
                    right={<Icon n="chev" />} onOpen={() => setView({ t: 'match', id: m.id })} />
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
                openPlayer={(init, accounts) => setSheet({ t: 'player', init, accounts })} openGroup={() => setSheet({ t: 'group' })}
                openExisting={() => setSheet({ t: 'existing' })}
                onDeleteGroup={() => setSheet({ t: 'deleteGroup' })} onLeaveGroup={leaveGroup} />
            )}
            {tab === 'stats' && (
              <StatsTab groups={groups} groupId={groupId} setGroupId={setGroupId} call={call} flash={flash} version={version} onAdjusted={bump} />
            )}
          </main>
        )}
        <nav className="nav n5" aria-label="Secciones">
          {(['matches', 'chat', 'history', 'squad', 'stats'] as Tab[]).map((k) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}
              aria-label={`${TITLES[k]}${k === 'chat' && unreadChatTotal ? ` (${unreadChatTotal} sin leer)` : ''}`}>
              <Icon n={k} />{TITLES[k]}
              {k === 'history' && toResult.length > 0 && <span className="dot">{toResult.length}</span>}
              {k === 'chat' && unreadChatTotal > 0 && <span className="dot">{badgeTxt(unreadChatTotal)}</span>}
              {k === 'matches' && anyNewMatches && tab !== 'matches' && <span className="dot new" aria-label="Partidos nuevos" />}
            </button>
          ))}
        </nav>
      </>
    );
  }

  return (
    <div className="app">
      {screen}
      {sheet && sheet.t === 'player' && current && me && (
        <PlayerSheet key={sheet.init.id ?? 'new'} init={sheet.init} groupId={groupId} myRole={current.role} meId={me.id}
          accounts={sheet.accounts} call={call} flash={flash} onClose={() => setSheet(null)}
          onDone={() => { setSheet(null); bump(); }} />
      )}
      {sheet && sheet.t === 'group' && (
        <GroupSheet call={call} flash={flash} onClose={() => setSheet(null)} onDone={async (id) => { setSheet(null); await refresh(); setGroupId(id); }} />
      )}
      {sheet && sheet.t === 'existing' && (
        <ExistingSheet groupId={groupId} call={call} flash={flash} onClose={() => setSheet(null)} onDone={() => { setSheet(null); bump(); }} />
      )}
      {sheet && sheet.t === 'profile' && me && (
        <ProfileSheet me={me} call={call} flash={flash} onClose={() => setSheet(null)} onLogout={onLogout}
          onSaved={(m) => { setMe(m); setSheet(null); bump(); }} />
      )}
      {sheet && sheet.t === 'deleteGroup' && current && (
        <DeleteGroupSheet group={current} call={call} flash={flash} onClose={() => setSheet(null)}
          onDone={() => { setSheet(null); setGroupIdState(''); bump(); }} />
      )}
      {bellOpen && (
        <SheetShell title="Avisos" onClose={() => setBellOpen(false)}>
          {notifs.length === 0 ? <div className="empty">No tienes avisos todavía.</div> : (
            <>
              {unreadNotifs > 0 && <button className="btn ghost sm" style={{ alignSelf: 'flex-end' }} onClick={readAll}>Marcar todas como leídas</button>}
              <div className="notiflist">
                {notifs.map((n) => (
                  <button key={n.id} className={`notif${n.readAt ? '' : ' unread'}`} onClick={() => openNotif(n)}>
                    <b>{n.title}</b>
                    {n.body && <span>{n.body}</span>}
                    <small>{n.groupName ? `${n.groupName} · ` : ''}{cap1(fmtD(n.createdAt, { weekday: 'short', day: 'numeric', month: 'short' }))} · {hhmm(n.createdAt)}</small>
                  </button>
                ))}
              </div>
            </>
          )}
        </SheetShell>
      )}
      {sheet && sheet.t === 'text' && <TextSheet text={sheet.text} onClose={() => setSheet(null)} />}
      {sheet && sheet.t === 'result' && <ResultSheet s={sheet} call={call} flash={flash} onClose={() => setSheet(null)} />}
      <div className={`toast${toastMsg ? ' show' : ''}`} role="status">{toastMsg}</div>
    </div>
  );
}

function Splash({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="app">
      <Hdr eyebrow="Equilibrio FC" title={title} />
      <main className="main">{children}</main>
    </div>
  );
}

/**
 * Raíz: sesión de Supabase + flujo de invitación.
 * En /join/<token>: sin sesión muestra la invitación y el registro; al identificarse entra en el grupo.
 */
export default function App({ inviteToken }: { inviteToken?: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const [fatal, setFatal] = useState('');
  // Invitación: la de la URL (/join/<token>) o una pendiente de confirmar el email (guardada en este navegador)
  const [token, setToken] = useState<string | null>(inviteToken ?? null);
  const [invite, setInvite] = useState<InvitePreview | null>(null);
  const [inviteErr, setInviteErr] = useState('');
  const [joining, setJoining] = useState(!!inviteToken);
  const [joinedGroup, setJoinedGroup] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState<string | null>(null);

  useEffect(() => {
    if (inviteToken) return;
    try {
      const pending = localStorage.getItem(PENDING_INVITE);
      if (pending) { setToken(pending); setJoining(true); }
    } catch { /* sin almacenamiento */ }
  }, [inviteToken]);

  useEffect(() => {
    let client: ReturnType<typeof sb> | null = null;
    try { client = sb(); } catch (e) { setFatal(msg(e)); }
    if (!client) { setReady(true); return; }
    client.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data } = client.auth.onAuthStateChange((_event, s) => { setSession(s); if (s) setCheckEmail(null); });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!token) return;
    fetch(`/api/invites/${token}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((d as { error?: string }).error ?? 'Invitación no válida');
        setInvite(d as InvitePreview);
      })
      .catch((e) => setInviteErr(msg(e)));
  }, [token]);

  // Con sesión iniciada, la invitación se acepta sola y se abre el grupo.
  useEffect(() => {
    if (!token || !session) return;
    const clear = () => { try { localStorage.removeItem(PENDING_INVITE); } catch { /* nada */ } };
    api<{ groupId: string }>(`/api/invites/${token}/accept`, 'POST')
      .then((r) => { setJoinedGroup(r.groupId); clear(); window.history.replaceState(null, '', '/'); })
      .catch((e) => { setInviteErr(msg(e)); if (!(e instanceof AuthError)) clear(); })
      .finally(() => setJoining(false));
  }, [token, session]);

  const logout = useCallback(() => { sb().auth.signOut(); }, []);
  const onCheckEmail = (email: string) => {
    // Si venía de una invitación, se guarda para terminar de unirse al confirmar el email
    if (token) { try { localStorage.setItem(PENDING_INVITE, token); } catch { /* nada */ } }
    setCheckEmail(email);
  };

  if (!ready) return null;
  if (fatal) return <Splash title="Configuración"><div className="alert err">{fatal}</div></Splash>;

  const inviteProblem = inviteErr || (invite?.expired ? 'Este enlace de invitación ha caducado. Pide uno nuevo al admin del grupo.' : '');
  if (token && inviteProblem) {
    return (
      <Splash title="Invitación">
        <div className="alert err">{inviteProblem}</div>
        <a className="btn block" href="/" onClick={() => { try { localStorage.removeItem(PENDING_INVITE); } catch { /* nada */ } }}>Ir a la app</a>
      </Splash>
    );
  }
  if (!session && checkEmail) return <CheckEmail email={checkEmail} invite={token ? invite : null} onBack={() => setCheckEmail(null)} />;
  if (!session) return <AuthScreen invite={token ? invite : null} onCheckEmail={onCheckEmail} />;
  if (token && joining) return <Splash title="Entrando…"><div className="empty">Uniéndote a {invite?.name ?? 'el grupo'}…</div></Splash>;
  return <Main key={session.user.id} startGroupId={joinedGroup} onLogout={logout} />;
}
