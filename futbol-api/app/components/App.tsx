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
type Group = { id: string; name: string; players: number; role: Role; unreadChat: number; newMatches: number; iconUrl?: string | null };
type Player = {
  id: string; name: string; nick: string | null; pos: Pos; photoUrl: string | null; stars: number;
  role: Role; hasAccount: boolean; lastName: string | null; displayName: string;
};
type Me = {
  id: string; name: string; nick: string | null; lastName: string | null; displayName: string;
  pos: Pos; level: number; email: string | null; photoUrl: string | null;
  notifyChat: boolean; notifyPolls: boolean; notifyMatches: boolean;
};
type Notif = {
  id: string; groupId: string | null; groupName: string | null; type: 'chat' | 'poll' | 'match_created' | 'match_updated';
  title: string; body: string; data: { matchId?: string; pollId?: string }; readAt: string | null; createdAt: string;
};
type GuestDraft = { name: string; stars: number; pos: Pos };
type GroupInfo = { id: string; name: string; iconUrl: string | null; players: number; role: Role; invite: { url: string; expiresAt: string | null } | null };
type Choice = 'yes' | 'no' | 'maybe';
type PollUser = { id: string; name: string; nick: string | null; pos: Pos; votedAt: string; guest?: boolean; stars?: number };
type Poll = {
  id: string; groupId: string; question: string; matchAt: string; format: string | null; maxSlots: number | null;
  status: 'open' | 'closed'; matchId: string | null; createdBy: string | null; createdAt: string;
  location: string | null; notes: string | null; quorum: number; quorumNotified: boolean;
  counts: { yes: number; waitlist: number; maybe: number; no: number; guests?: number };
  confirmed: PollUser[]; waitlist: PollUser[]; maybe: PollUser[]; no: PollUser[];
  myVote: Choice | null; myStatus: Choice | 'waitlist' | null;
};
type ChatMsg = {
  id: string; groupId: string; playerId: string | null; type: 'text' | 'poll' | 'system'; content: string;
  pollId: string | null; metadata: { event?: string; matchId?: string; [k: string]: unknown }; createdAt: string;
  authorName: string | null; authorNick: string | null; authorPhoto?: string | null; poll?: Poll | null;
};
/** Datos con los que se abre "Nuevo partido" desde una encuesta del chat */
type Prefill = {
  groupId: string; when: string; playerIds: string[]; guests: GuestDraft[]; pollId: string; format: string | null;
  location: string | null; notes: string | null;
};
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
type Tab = 'matches' | 'chat' | 'squad' | 'profile';
type View = null | { t: 'new'; prefill?: Prefill } | { t: 'match'; id: string; pack?: boolean } | { t: 'edit'; id: string };
type PlayerInit = { id?: string; name: string; nick: string; lastName: string; pos: Pos; stars: number; role?: Role; hasAccount?: boolean };
type SheetState =
  | null
  | { t: 'player'; init: PlayerInit; accounts: Player[] }
  | { t: 'text'; text: string }
  | { t: 'group' }
  | { t: 'existing' }
  | { t: 'groupSettings' }
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
/** Jugadores necesarios por modalidad (aviso de quórum y cupo sugerido de la encuesta) */
const QUORUM_N: Record<string, number> = { '5v5': 10, '7v7': 14, '11v11': 22 };
const SEG_LABEL: Record<string, string> = { '5v5': 'Sala (5v5)', '7v7': 'Fútbol 7', '11v11': 'Fútbol 11' };

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
  shield: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4M8.2 13.2l7.6 4"/>',
  camera: '<path d="M4 8h3l2-2.5h6L17 8h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  chevd: '<path d="M6 9l6 6 6-6"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4.2 3.9-6.5 8-6.5s7.2 2.3 8 6.5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  more: '<g fill="currentColor" stroke="none"><circle cx="5.5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="18.5" cy="12" r="1.8"/></g>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>',
  logout: '<path d="M14 4h4a2 2 0 012 2v12a2 2 0 01-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>',
  ball: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5l4 2.9-1.5 4.7h-5L8 10.4z"/><path d="M12 3v4.5M16 10.4l4.3-1.4M14.5 15.1l2.6 3.7M9.5 15.1l-2.6 3.7M8 10.4L3.7 9"/>',
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

function Av({ name, url, size }: { name: string; url?: string | null; size?: number }) {
  const dim = size ? ({ width: size, height: size, fontSize: Math.round(size * 0.36) } as CSSProperties) : undefined;
  // eslint-disable-next-line @next/next/no-img-element
  if (url) return <img className="av img" src={url} alt="" style={dim} loading="lazy" />;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 90;
  return <span className="av" style={{ '--h': 95 + h, ...dim } as CSSProperties}>{name.slice(0, 2).toUpperCase()}</span>;
}

/** Escudo del grupo: su foto o un escudo de color con el que se reconoce de un vistazo. */
function GroupIcon({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  const dim = { width: size, height: size } as CSSProperties;
  // eslint-disable-next-line @next/next/no-img-element
  if (url) return <img className="gicon img" src={url} alt="" style={dim} loading="lazy" />;
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 37 + name.charCodeAt(i)) % 360;
  return <span className="gicon" style={{ ...dim, '--gh': h } as CSSProperties}><Icon n="shield" /></span>;
}

/* ============================ Desplegables propios (v1.6) ============================ */
type PickOpt = { value: string; label: string; sub?: string; badge?: string; icon?: ReactNode };

/**
 * Sustituye a los <select> del navegador: botón + hoja inferior animada con la opción activa
 * marcada. Se cierra al tocar fuera, con la X o con Escape.
 */
function Picker({ value, options, onChange, title, subtitle, placeholder = 'Elige…', id, footer, big, hdr, disabled }: {
  value: string; options: PickOpt[]; onChange: (v: string) => void; title: string; subtitle?: string;
  placeholder?: string; id?: string; footer?: ReactNode; big?: boolean; hdr?: boolean; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const cur = options.find((o) => o.value === value);
  const close = useCallback(() => {
    setClosing(true);
    setTimeout(() => { setOpen(false); setClosing(false); }, 170);
  }, []);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, close]);

  return (
    <>
      <button type="button" id={id} className={`picker${big ? ' big' : ''}${hdr ? ' hdrpick' : ''}`} disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen(true)}>
        {cur?.icon}
        <span className="pk-txt">
          <b>{cur ? cur.label : placeholder}{cur?.badge && <span className="chip ok">{cur.badge}</span>}</b>
          {cur?.sub && !hdr && <small>{cur.sub}</small>}
        </span>
        <span className="pk-caret"><Icon n="chevd" /></span>
      </button>
      {open && (
        <div className={`pk-scrim${closing ? ' out' : ''}`} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
          <div className="pk-sheet" role="dialog" aria-label={title}>
            <i className="pk-grab" />
            <div className="pk-head">
              <div><b>{title}</b>{subtitle && <small>{subtitle}</small>}</div>
              <button className="iconbtn round" onClick={close} aria-label="Cerrar"><Icon n="x" /></button>
            </div>
            <div className="pk-list" role="listbox">
              {options.map((o) => (
                <button key={o.value} role="option" aria-selected={o.value === value} className={`pk-opt${o.value === value ? ' on' : ''}`}
                  onClick={() => { onChange(o.value); close(); }}>
                  {o.icon}
                  <span className="pk-txt"><b>{o.label}{o.badge && <span className="chip ok">{o.badge}</span>}</b>{o.sub && <small>{o.sub}</small>}</span>
                  {o.value === value && <span className="pk-check"><Icon n="check" /></span>}
                </button>
              ))}
              {options.length === 0 && <div className="empty">No hay opciones</div>}
            </div>
            {footer && <div className="pk-foot" onClick={close}>{footer}</div>}
          </div>
        </div>
      )}
    </>
  );
}

const STAR_OPTS: PickOpt[] = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((v) => ({
  value: String(v), label: `${f1(v)} ★`, sub: v >= 4.5 ? 'Crack' : v >= 3.5 ? 'Bueno' : v >= 2.5 ? 'Normal' : 'Aprendiendo',
}));

/* ============================ Fotos (Supabase Storage) ============================ */
/** Recorta al centro y reduce a 400x400 (WebP, o JPEG si el navegador no sabe WebP). */
async function compressImage(file: File, size = 400): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, ko) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => ko(new Error('No se pudo leer la imagen'));
      i.src = url;
    });
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = Math.min(size, side);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Tu navegador no puede procesar la imagen');
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, canvas.width, canvas.height);
    const toBlob = (type: string) => new Promise<Blob | null>((ok) => canvas.toBlob(ok, type, 0.85));
    const webp = await toBlob('image/webp');
    const out = webp && webp.type === 'image/webp' ? webp : await toBlob('image/jpeg');
    if (!out) throw new Error('No se pudo comprimir la imagen');
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Borra las fotos anteriores de la carpeta (se guarda solo la actual). */
async function cleanFolder(folder: string, keep?: string) {
  const bucket = sb().storage.from('avatars');
  const { data } = await bucket.list(folder);
  const old = (data ?? []).map((f: { name: string }) => `${folder}/${f.name}`).filter((p: string) => p !== keep);
  if (old.length) await bucket.remove(old);
}

/**
 * Elegir, previsualizar (círculo) y guardar una foto: perfil (users/<cuenta>) o escudo (groups/<grupo>).
 * La imagen se comprime en el móvil antes de subirla, así carga al instante.
 */
function ImageUploader({ current, name, folder, kind, flash, onSave }: {
  current: string | null; name: string; folder: string | null; kind: 'user' | 'group';
  flash: (m: string) => void; onSave: (url: string | null) => Promise<void>;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const pick = async (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith('image/')) { flash('Elige una imagen'); return; }
    try {
      const b = await compressImage(f);
      setBlob(b);
      setPreview(URL.createObjectURL(b));
    } catch (e) { flash(msg(e)); }
  };
  const save = async () => {
    if (!blob || !folder) return;
    setBusy(true);
    try {
      const path = `${folder}/${Date.now()}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`;
      const bucket = sb().storage.from('avatars');
      const { error } = await bucket.upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false });
      if (error) throw new Error(error.message);
      await onSave(bucket.getPublicUrl(path).data.publicUrl);
      cleanFolder(folder, path).catch(() => undefined);
      setBlob(null);
      setPreview(null);
      flash(kind === 'user' ? 'Foto de perfil guardada' : 'Escudo del grupo guardado');
    } catch (e) { flash(msg(e)); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!folder || !confirm('¿Quitar la foto?')) return;
    setBusy(true);
    try {
      await onSave(null);
      cleanFolder(folder).catch(() => undefined);
      flash('Foto eliminada');
    } catch (e) { flash(msg(e)); } finally { setBusy(false); }
  };

  const shown = preview ?? current;
  return (
    <div className="uploader">
      <button type="button" className={`upl-pic${preview ? ' pending' : ''}`} onClick={() => input.current?.click()} aria-label="Elegir foto">
        {kind === 'user' ? <Av name={name} url={shown} size={76} /> : <GroupIcon name={name} url={shown} size={76} />}
        <span className="upl-cam"><Icon n="camera" /></span>
      </button>
      <div className="upl-actions">
        {preview ? (
          <>
            <span className="note">Vista previa · aún sin guardar</span>
            <div className="two">
              <button className="btn primary sm" disabled={busy} onClick={save}>{busy ? 'Subiendo…' : 'Guardar foto'}</button>
              <button className="btn ghost sm" disabled={busy} onClick={() => { setPreview(null); setBlob(null); }}>Cancelar</button>
            </div>
          </>
        ) : (
          <div className="two">
            <button className="btn sm" onClick={() => input.current?.click()}>{current ? 'Cambiar foto' : 'Subir foto'}</button>
            {current && <button className="btn ghost sm" disabled={busy} onClick={remove}>Quitar</button>}
          </div>
        )}
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
    </div>
  );
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

const groupOpts = (groups: Group[]): PickOpt[] => groups.map((g) => ({
  value: g.id, label: g.name, icon: <GroupIcon name={g.name} url={g.iconUrl} />,
  badge: g.role === 'member' ? undefined : ROLE_LABEL[g.role],
  sub: `${g.players} jugadores${g.unreadChat ? ` · ${badgeTxt(g.unreadChat)} sin leer` : ''}`,
}));

/* ============================ v1.7 · piezas comunes ============================ */
type Theme = 'dark' | 'light';
const THEME_KEY = 'eqfc-theme';
const readTheme = (): Theme => {
  try { return localStorage.getItem(THEME_KEY) === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
};
/** Aplica el tema a toda la página (y al color de la barra del móvil) y lo recuerda en este dispositivo. */
function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#f4f6f5' : '#080d0a');
  try { localStorage.setItem(THEME_KEY, t); } catch { /* sin almacenamiento */ }
}

/** Esqueletos de carga con la forma de lo que va a aparecer. */
function SkMatches({ n = 3 }: { n?: number }) {
  return (
    <div className="sk-list" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: n }, (_, i) => (
        <div className="card mcard sk-card" key={i}>
          <span className="sk sk-box" />
          <span className="minfo"><span className="sk sk-line w60" /><span className="sk sk-line w80 thin" /><span className="sk sk-line w40 thin" /></span>
        </div>
      ))}
    </div>
  );
}
function SkRows({ n = 6 }: { n?: number }) {
  return (
    <div className="card list sk-list" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: n }, (_, i) => (
        <div className="sk-row" key={i}>
          <span className="sk sk-av" />
          <span className="minfo"><span className="sk sk-line w50" /><span className="sk sk-line w30 thin" /></span>
        </div>
      ))}
    </div>
  );
}
function SkChat() {
  return (
    <div className="sk-chat" aria-busy="true" aria-label="Cargando">
      {[62, 44, 70, 38, 55].map((w, i) => <span key={i} className={`sk sk-bubble${i % 2 ? ' mine' : ''}`} style={{ width: w + '%' }} />)}
    </div>
  );
}

/** Estado vacío: icono sutil, una frase y (como mucho) una acción principal. */
function Empty({ icon, title, text, action }: { icon: string; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="emptystate">
      <span className="es-ico"><Icon n={icon} /></span>
      <b>{title}</b>
      {text && <span>{text}</span>}
      {action}
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
  return (
    <button className="card mcard" onClick={onOpen}>
      <span className="dbox"><b>{d.getDate()}</b><small>{fmtD(m.scheduledAt, { month: 'short' })}</small></span>
      <span className="minfo">
        <span className="mtop"><b>{MOD[m.format]?.label ?? m.format}</b>{fresh && <span className="chip new">Nuevo</span>}</span>
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
  const [err, setErr] = useState('');
  const resend = async () => {
    setErr('');
    try {
      const { error } = await sb().auth.resend({ type: 'signup', email, options: { emailRedirectTo: window.location.href } });
      if (error) throw error;
      setSent(true);
    } catch (e) { setErr(msg(e)); }
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
        {err && <span className="errtxt">{err}</span>}
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
      <Picker value={String(stars)} onChange={(v) => setStars(Number(v))} options={STAR_OPTS} title="Valoración del invitado"
        subtitle="Por defecto 3 estrellas" />
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
  const [venue, setVenue] = useState(prefill?.location ?? '');
  const [notes, setNotes] = useState(prefill?.notes ?? '');
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
        groupId, format: mod, playerIds: sel, guests, location: venue.trim() || null, notes: notes.trim() || null,
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
              <div className="lbl">Grupo</div>
              <Picker big id="d-group" value={groupId} onChange={setGroupId} options={groupOpts(groups)} title="¿En qué grupo?"
                subtitle="Grupos en los que eres admin o co-admin" placeholder="Elige un grupo…" />
              {groups.length === 0 && <div className="warnbox" style={{ marginTop: 6 }}><Icon n="warn" /><span>No administras ningún grupo. Crea uno en la pestaña Plantilla.</span></div>}
              {prefill && <div className="note" style={{ marginTop: 6 }}><Icon n="poll" /><span>Datos de la encuesta ya puestos: fecha, modalidad{prefill.location ? ', lugar' : ''}{prefill.notes ? ', notas' : ''} y {prefill.playerIds.length} confirmados{prefill.guests.length ? ` + ${prefill.guests.length} invitados` : ''}. Revisa y pulsa “Elegir jugadores”.</span></div>}
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
                <label htmlFor="d-notes" style={{ marginTop: 6 }}>Notas / precio <span className="lockt">opcional</span></label>
                <input id="d-notes" placeholder="4 € por persona · traed peto blanco y oscuro" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} autoComplete="off" />
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
                  <Av name={p.displayName ?? p.name} url={p.photoUrl} />
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
      <Av name={p.name} url={p.photo} />
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
    return (<><Hdr eyebrow="Partido" title="Equipos" onBack={onBack} /><main className="main"><SkMatches n={1} /><SkRows n={5} /></main></>);
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
      <Hdr eyebrow={d.groupName} title="Equipos" onBack={onBack} />
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

  if (!d) return (<><Hdr eyebrow="Editar partido" title="Editar partido" onBack={onClose} /><main className="main"><SkRows n={6} /></main></>);

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
  const addMember = (id: string) => {
    const m = members.find((x) => x.id === id);
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
            {Object.keys(MOD).map((k) => <button key={k} className={mod === k ? 'on' : ''} onClick={() => setMod(k)}>{SEG_LABEL[k]}</button>)}
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
          <Picker value={addId} onChange={addMember} title="Añadir jugador del grupo" subtitle="Entra como suplente si su equipo ya está completo"
            placeholder={available.length ? 'Elige un jugador…' : 'Ya están todos convocados'} disabled={!available.length}
            options={available.map((m) => ({
              value: m.id, label: m.displayName ?? m.name, sub: `${POS[m.pos].label} · ${f1(m.stars)}★`,
              icon: <Av name={m.displayName ?? m.name} url={m.photoUrl} />,
            }))} />
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
    <div className="card form">
      <div className="lbl"><Icon n="bell" /> En este dispositivo</div>
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
        ['notifyMatches', 'Partidos nuevos, cambios y “¡ya somos 10!”'],
        ['notifyPolls', 'Encuestas nuevas y nuevos miembros'],
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
          <Picker id="f-merge" value={mergeInto} onChange={setMergeInto} title="¿Cuál es su cuenta?" placeholder="Elige su cuenta…"
            options={accounts.map((a) => ({ value: a.id, label: a.displayName ?? a.name, icon: <Av name={a.displayName ?? a.name} url={a.photoUrl} /> }))} />
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

/** Marcador editable libremente (se puede borrar del todo) con botones −/+ para el móvil. */
function ScoreInput({ id, label, color, value, onChange }: {
  id: string; label: string; color: string; value: string; onChange: (v: string) => void;
}) {
  const n = value === '' ? null : Number(value);
  const step = (d: number) => onChange(String(Math.min(99, Math.max(0, (n ?? 0) + d))));
  return (
    <div className="score-in">
      <label htmlFor={id} style={{ color }}>{label}</label>
      <div className="score-row">
        <button type="button" className="iconbtn" onClick={() => step(-1)} disabled={!n} aria-label={`Restar gol a ${label}`}>−</button>
        <input id={id} type="text" inputMode="numeric" pattern="[0-9]*" autoComplete="off" placeholder="–" value={value}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 2))} aria-label={`Goles ${label}`} />
        <button type="button" className="iconbtn" onClick={() => step(1)} disabled={n === 99} aria-label={`Sumar gol a ${label}`}>+</button>
      </div>
    </div>
  );
}

function ResultSheet({ s, call, flash, onClose }: {
  s: Extract<SheetState, { t: 'result' }>; call: Call; flash: (m: string) => void; onClose: () => void;
}) {
  // Los goles se guardan como texto: '' = sin rellenar (no un 0 forzado que obligue a escribir "01")
  const [a, setA] = useState(s.scoreA == null ? '' : String(s.scoreA));
  const [b, setB] = useState(s.scoreB == null ? '' : String(s.scoreB));
  const [mvp, setMvp] = useState(s.mvp ?? '');
  const [busy, setBusy] = useState(false);
  const missing = a === '' || b === '';
  const save = async () => {
    if (missing) return;
    setBusy(true);
    try {
      await call(`/api/matches/${s.id}/result`, 'POST', { scoreA: Number(a), scoreB: Number(b), mvpEntryId: mvp || undefined });
      flash('Resultado guardado');
      s.onSaved();
      onClose();
    } catch (e) { flash(msg(e)); setBusy(false); }
  };
  const list = [...s.roster].sort((x, y) => x.team.localeCompare(y.team) || x.name.localeCompare(y.name));
  return (
    <SheetShell title="Resultado y MVP" onClose={onClose}>
      <div className="note" style={{ marginBottom: 6 }}><span>{s.title}</span></div>
      <div className="score-grid">
        <ScoreInput id="r-a" label="Equipo A" color="var(--grass)" value={a} onChange={setA} />
        <span className="score-sep">–</span>
        <ScoreInput id="r-b" label="Equipo B" color="var(--sky)" value={b} onChange={setB} />
      </div>
      {missing && <div className="errtxt">Falta el marcador de {a === '' && b === '' ? 'los dos equipos' : a === '' ? 'el Equipo A' : 'el Equipo B'}.</div>}
      <div className="lbl" style={{ marginTop: 6 }}>MVP del partido</div>
      <Picker id="r-mvp" value={mvp} onChange={setMvp} title="MVP del partido" subtitle="El mejor jugador del partido"
        options={[
          { value: '', label: 'Sin MVP' },
          ...list.map((r) => ({ value: r.entryId, label: r.name, sub: `Equipo ${r.team}${r.isGuest ? ' · invitado' : ''}`, icon: <Av name={r.name} url={r.photo} /> })),
        ]} />
      <div className="sheet-actions"><button className="btn primary" disabled={missing || busy} onClick={save}>{busy ? 'Guardando…' : 'Guardar'}</button></div>
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
      {all === null ? <SkRows n={3} /> : all.length === 0 ? (
        <div className="empty">No hay jugadores de tus otros grupos que añadir.</div>
      ) : (
        <>
          <label htmlFor="e-sel">Jugador</label>
          <Picker id="e-sel" value={pid} onChange={setPid} title="Jugador de otro grupo" subtitle="Solo jugadores activos de tus otros grupos"
            placeholder="Elige un jugador…"
            options={all.map((p) => ({ value: p.id, label: p.name, sub: p.fromGroups.join(' · '), icon: <Av name={p.name} /> }))} />
          <div className="lbl" style={{ marginTop: 6 }}>Valoración en este grupo</div>
          <div className="starbox"><Stars v={stars} size={34} onPick={(v) => setStars(Math.max(1, v))} /><b className="big">{f1(stars)}</b></div>
          <div className="sheet-actions"><button className="btn primary" disabled={!pid} onClick={save}>Añadir al grupo</button></div>
        </>
      )}
    </SheetShell>
  );
}

/** Pestaña Perfil: foto, nombre, apodo/apellido, posición, nivel, tema, notificaciones y cerrar sesión. */
function ProfileView({ me, call, flash, onUpdate, onLogout, theme, onTheme }: {
  me: Me; call: Call; flash: (m: string) => void; onUpdate: (m: Me) => void; onLogout: () => void;
  theme: Theme; onTheme: (t: Theme) => void;
}) {
  const initial = { name: me.name, nick: me.nick ?? '', lastName: me.lastName ?? '', pos: me.pos, level: me.level };
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [authId, setAuthId] = useState<string | null>(null); // carpeta de su foto: users/<id de la cuenta>
  useEffect(() => { sb().auth.getSession().then(({ data }) => setAuthId(data.session?.user.id ?? null)); }, []);
  const preview = s.nick.trim() ? `${s.name.trim()} '${s.nick.trim()}'` : s.lastName.trim() ? `${s.name.trim()} ${s.lastName.trim().charAt(0).toUpperCase()}.` : '';
  const dirty = s.name !== me.name || s.nick !== (me.nick ?? '') || s.lastName !== (me.lastName ?? '') || s.pos !== me.pos || s.level !== me.level;
  const valid = !!s.name.trim() && (!!s.nick.trim() || !!s.lastName.trim());
  const save = async () => {
    if (!s.name.trim()) { flash('Escribe tu nombre'); return; }
    if (!s.nick.trim() && !s.lastName.trim()) { flash('Pon un apodo o un apellido'); return; }
    setBusy(true);
    try {
      const m = await call<Me>('/api/me', 'PATCH', { name: s.name.trim(), nick: s.nick.trim(), lastName: s.lastName.trim(), pos: s.pos, level: s.level });
      onUpdate(m);
      setS({ name: m.name, nick: m.nick ?? '', lastName: m.lastName ?? '', pos: m.pos, level: m.level });
      flash('Perfil actualizado');
    } catch (e) { flash(msg(e)); } finally { setBusy(false); }
  };

  return (
    <main className="main profile">
      <section className="phero">
        <ImageUploader kind="user" name={me.displayName ?? me.name} current={me.photoUrl} folder={authId ? `users/${authId}` : null} flash={flash}
          onSave={async (url) => onUpdate(await call<Me>('/api/me', 'PATCH', { photoUrl: url }))} />
        <div className="phero-txt"><b>{me.displayName ?? me.name}</b><small>{me.email}</small></div>
      </section>

      <h2 className="sec">Tus datos</h2>
      <div className="card form">
        <label htmlFor="m-name">Nombre</label>
        <input id="m-name" value={s.name} maxLength={60} onChange={(e) => setS({ ...s, name: e.target.value })} />
        <div className="two" style={{ marginTop: 6 }}>
          <div><label htmlFor="m-last">Apellido</label><input id="m-last" value={s.lastName} maxLength={60} onChange={(e) => setS({ ...s, lastName: e.target.value })} /></div>
          <div><label htmlFor="m-nick">Apodo</label><input id="m-nick" value={s.nick} maxLength={60} onChange={(e) => setS({ ...s, nick: e.target.value })} /></div>
        </div>
        {preview
          ? <span className="note">En tus grupos te verán como <b>&nbsp;{preview}</b>{s.nick.trim() && s.lastName.trim() ? ' (manda el apodo)' : ''}</span>
          : <span className="errtxt">Obligatorio: pon un apodo o un apellido para que no haya dos iguales en el grupo.</span>}
        <div className="lbl" style={{ marginTop: 8 }}>Posición preferida</div>
        <div className="seg">
          {(['GK', 'DEF', 'ATT'] as Pos[]).map((k) => (
            <button key={k} className={s.pos === k ? 'on' : ''} onClick={() => setS({ ...s, pos: k })}>{POS[k].label}</button>
          ))}
        </div>
        <div className="lbl" style={{ marginTop: 8 }}>Tu nivel<span className="lockt">el admin de cada grupo puede ajustarlo</span></div>
        <div className="starbox"><Stars v={s.level} size={30} onPick={(v) => setS({ ...s, level: Math.max(1, v) })} /><b className="big">{f1(s.level)}</b></div>
        {dirty && (
          <div className="two" style={{ marginTop: 8 }}>
            <button className="btn ghost" disabled={busy} onClick={() => setS(initial)}>Descartar</button>
            <button className="btn primary" disabled={busy || !valid} onClick={save}>{busy ? 'Guardando…' : 'Guardar'}</button>
          </div>
        )}
      </div>

      <h2 className="sec">Apariencia</h2>
      <div className="seg themeseg">
        <button className={theme === 'dark' ? 'on' : ''} onClick={() => onTheme('dark')}><Icon n="moon" /> Oscuro</button>
        <button className={theme === 'light' ? 'on' : ''} onClick={() => onTheme('light')}><Icon n="sun" /> Claro</button>
      </div>

      <h2 className="sec">Notificaciones</h2>
      <PushSettings me={me} call={call} flash={flash} onSaved={onUpdate} />

      <button className="btn ghost block logout" onClick={onLogout}><Icon n="logout" /> Cerrar sesión</button>
      <small className="appver">Equilibrio FC · v1.7</small>
    </main>
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

/** Barra compacta de invitación: enlace, Copiar (→ ¡Copiado!) y compartir. Solo admin y co-admins. */
function InviteBar({ url, groupName, flash }: { url: string; groupName: string; flash: (m: string) => void }) {
  const [copied, setCopied] = useState(false);
  const shareText = `¡Únete a nuestro grupo de fútbol en Football Star! ${url}`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      flash('Enlace copiado');
      setTimeout(() => setCopied(false), 2000);
    } catch { flash('No se pudo copiar: mantén pulsado el enlace para copiarlo'); }
  };
  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: groupName, text: shareText }); } catch { /* cancelado */ }
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank', 'noopener');
    }
  };
  return (
    <div className="invbar">
      <span className="invbar-url" title={url}>{url.replace(/^https?:\/\//, '')}</span>
      <button className={`btn sm${copied ? ' copied' : ''}`} onClick={copy}>{copied ? <><Icon n="check" /> ¡Copiado!</> : 'Copiar'}</button>
      <button className="iconbtn" onClick={share} aria-label="Compartir por WhatsApp u otra app"><Icon n="share" /></button>
    </div>
  );
}

/** Ajustes del grupo (menú ⋯ de Plantilla): escudo y nombre (admin / co-admin), salir o eliminar. */
function GroupSettingsSheet({ group, call, flash, onClose, onChanged, onDelete, onLeave }: {
  group: Group; call: Call; flash: (m: string) => void; onClose: () => void; onChanged: () => void;
  onDelete: () => void; onLeave: () => void;
}) {
  const manage = isManager(group.role);
  const [name, setName] = useState(group.name);
  const [busy, setBusy] = useState(false);
  const [sure, setSure] = useState(false);
  const rename = async () => {
    setBusy(true);
    try {
      await call(`/api/groups/${group.id}`, 'PATCH', { name: name.trim() });
      flash('Grupo actualizado');
      onChanged();
    } catch (e) { flash(msg(e)); } finally { setBusy(false); }
  };
  return (
    <SheetShell title={manage ? 'Editar grupo' : 'Grupo'} onClose={onClose}>
      {manage ? (
        <>
          <ImageUploader kind="group" name={group.name} current={group.iconUrl ?? null} folder={`groups/${group.id}`} flash={flash}
            onSave={async (url) => { await call(`/api/groups/${group.id}`, 'PATCH', { iconUrl: url }); onChanged(); }} />
          <label htmlFor="gs-name" style={{ marginTop: 10 }}>Nombre del grupo</label>
          <div className="inline">
            <input id="gs-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            {name.trim() !== group.name && (
              <button className="btn primary" disabled={busy || !name.trim()} onClick={rename}>{busy ? '…' : 'Guardar'}</button>
            )}
          </div>
        </>
      ) : (
        <div className="gs-head">
          <GroupIcon name={group.name} url={group.iconUrl} size={52} />
          <span className="pname"><b>{group.name}</b><small>{group.players} jugadores · eres {ROLE_LABEL[group.role].toLowerCase()}</small></span>
        </div>
      )}
      <div className="sheet-actions col">
        {group.role === 'owner'
          ? <button className="btn danger block" onClick={onDelete}>Eliminar grupo</button>
          : <button className={`btn block${sure ? ' danger' : ' ghost'}`} onClick={() => (sure ? onLeave() : setSure(true))}>
            {sure ? `Pulsa otra vez para salir de “${group.name}”` : 'Salir del grupo'}
          </button>}
      </div>
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

/* ================================== Chat ================================== */
const whenLabel = (iso: string) => `${cap1(fmtD(iso, { weekday: 'long', day: 'numeric', month: 'short' }))} · ${hhmm(iso)}`;

type NameInfo = { name: string; nick: string | null; photo: string | null };
function rowToMsg(r: Record<string, unknown>, names: Map<string, NameInfo>): ChatMsg {
  const pid = (r.player_id as string | null) ?? null;
  const who = pid ? names.get(pid) : undefined;
  return {
    id: String(r.id), groupId: String(r.group_id), playerId: pid, type: r.type as ChatMsg['type'],
    content: String(r.content ?? ''), pollId: (r.poll_id as string | null) ?? null,
    metadata: (r.metadata as ChatMsg['metadata']) ?? {}, createdAt: String(r.created_at),
    authorName: who?.name ?? null, authorNick: who?.nick ?? null, authorPhoto: who?.photo ?? null,
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
  // Progreso hacia el mínimo de la modalidad (10 / 14 / 22): se pone verde al alcanzarlo
  const quorum = poll.quorum || QUORUM_N[poll.format ?? '5v5'] || MIN_PLAYERS;
  const reached = poll.counts.yes >= quorum;
  const fill = Math.min(100, (poll.counts.yes / quorum) * 100);
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
      {poll.location && <a className="maps" target="_blank" rel="noopener noreferrer" href={mapsUrl(poll.location)}><Icon n="pin" /> {poll.location}</a>}
      {poll.notes && <span className="mnotes">📝 {poll.notes}</span>}
      <div className="pcount">
        <b>{poll.counts.yes} / {quorum}</b>
        <span>jugadores{poll.maxSlots ? ` · cupo ${poll.maxSlots}` : ''}{poll.counts.waitlist > 0 ? ` · ${poll.counts.waitlist} en espera` : ''}</span>
        {closed ? <span className="chip">Cerrada</span> : reached && <span className="chip ok">¡Completo!</span>}
      </div>
      <div className={`qbar${reached ? ' done' : ''}`} role="progressbar" aria-valuemin={0} aria-valuemax={quorum} aria-valuenow={poll.counts.yes}>
        <i style={{ width: fill + '%' }} />
      </div>
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
  const [slots, setSlots] = useState(QUORUM_N['7v7']);
  const [venue, setVenue] = useState('');
  const [notes, setNotes] = useState('');
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
        location: venue.trim() || null, notes: notes.trim() || null,
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
      <div className="lbl" style={{ marginTop: 6 }}>Modalidad del encuentro</div>
      <div className="seg">
        {Object.keys(MOD).map((k) => (
          <button key={k} className={mod === k ? 'on' : ''} onClick={() => { setMod(k); setSlots(QUORUM_N[k]); }}>{SEG_LABEL[k]}</button>
        ))}
      </div>
      <div className="quorumhint"><span>{MOD[mod].label} · mínimo {QUORUM_N[mod]} jugadores</span><b>Cupo sugerido: {QUORUM_N[mod]}</b></div>
      <label htmlFor="p-venue" style={{ marginTop: 6 }}>Lugar / campo <span className="lockt">opcional</span></label>
      <input id="p-venue" value={venue} maxLength={200} onChange={(e) => setVenue(e.target.value)} placeholder="Polideportivo municipal, pista 3" autoComplete="off" />
      <label htmlFor="p-notes" style={{ marginTop: 6 }}>Notas / precio <span className="lockt">opcional</span></label>
      <input id="p-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} placeholder="4 € por persona · traed peto blanco y oscuro" autoComplete="off" />
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
      <div className="note"><span>Formato, lugar, notas, fecha y confirmados pasarán solos al partido con “Crear Partido con Confirmados”.</span></div>
      <div className="sheet-actions"><button className="btn primary" disabled={!ok || busy} onClick={save}>Publicar en el chat</button></div>
    </SheetShell>
  );
}

/** Chat del grupo en tiempo real (Supabase Realtime) con encuestas de asistencia. */
function ChatRoom({ groups, groupId, meId, call, flash, onOpenMatch, onCreateMatch, onRead, onCreateGroup }: {
  groups: Group[]; groupId: string; meId: string; onCreateGroup: () => void; call: Call; flash: (m: string) => void;
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
  const names = useRef(new Map<string, NameInfo>());
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
    l.forEach((p) => names.current.set(p.id, { name: p.displayName ?? p.name, nick: p.nick, photo: p.photoUrl }));
    setMsgs((prev) => prev.map((m) => (m.playerId && !m.authorName && names.current.has(m.playerId)
      ? { ...m, authorName: names.current.get(m.playerId)!.name, authorNick: names.current.get(m.playerId)!.nick, authorPhoto: names.current.get(m.playerId)!.photo } : m)));
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
    names.current = new Map<string, NameInfo>();
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
    return (
      <main className="main">
        <Empty icon="chat" title="Aún no tienes grupo" text="Crea uno o entra con el enlace de invitación que te pase tu admin."
          action={<button className="btn primary" onClick={onCreateGroup}><Icon n="plus" /> Crear grupo</button>} />
      </main>
    );
  }

  return (
    <>
      <main className="main chatlist" ref={scrollRef} onScroll={() => {
        const el = scrollRef.current;
        if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
      }}>
        {live && <span className="livepill"><i />En directo</span>}
        {hasMore && <button className="btn ghost sm" style={{ alignSelf: 'center' }} onClick={older}>Mensajes anteriores</button>}
        {loading ? <SkChat /> : msgs.length === 0 && (
          <Empty icon="chat" title="Todavía no hay mensajes"
            text={manage ? 'Abre la convocatoria con una encuesta de asistencia.' : '¡Saluda al grupo!'}
            action={manage ? <button className="btn primary" onClick={() => setPollOpen(true)}><Icon n="poll" /> Nueva encuesta</button> : undefined} />
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
              {showName && <div className="who"><Av name={m.authorName || 'Jugador'} url={m.authorPhoto} size={20} />{m.authorName || 'Jugador'}</div>}
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
                        groupId, when: p.matchAt, pollId: p.id, format: p.format, location: p.location, notes: p.notes,
                        playerIds: p.confirmed.filter((u) => !u.guest).map((u) => u.id),
                        guests: p.confirmed.filter((u) => u.guest).map((u) => ({ name: u.name, stars: u.stars ?? 3, pos: u.pos })),
                      });
                    }} />
                ) : <div className="card pollcard sk-poll"><span className="sk sk-line w60" /><span className="sk sk-line w80 thin" /><span className="sk sk-line w40 thin" /></div>
              ) : (
                <div className="bubble">{m.content}<small>{hhmm(m.createdAt)}</small></div>
              )}
            </div>
          );
        })}
      </main>
      <div className="chatbar">
        {manage && <button className="iconbtn" onClick={() => setPollOpen(true)} aria-label="Nueva encuesta de asistencia" title="Nueva encuesta"><Icon n="poll" /></button>}
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
/** Pestaña Plantilla: jugadores (buscador y filtros) o estadísticas; invitación compacta; ajustes en ⋯. */
function RosterView({ groups, groupId, call, flash, version, openPlayer, openNewPlayer, openExisting, openSettings, onCreateGroup, onAdjusted }: {
  groups: Group[]; groupId: string; call: Call; flash: (m: string) => void; version: number;
  openPlayer: (p: PlayerInit, accounts: Player[]) => void; openNewPlayer: () => void; openExisting: () => void;
  openSettings: () => void; onCreateGroup: () => void; onAdjusted: () => void;
}) {
  const role = groups.find((g) => g.id === groupId)?.role;
  const manage = isManager(role);
  const [sub, setSub] = useState<'players' | 'stats'>('players');
  const [players, setPlayers] = useState<Player[] | null>(null);
  const [info, setInfo] = useState<GroupInfo | null>(null);
  const [filter, setFilter] = useState<'ALL' | Pos>('ALL');
  const [q, setQ] = useState('');
  useEffect(() => {
    if (!groupId) { setPlayers([]); return; }
    setPlayers(null);
    call<Player[]>(`/api/groups/${groupId}/players`).then(setPlayers).catch((e) => { flash(msg(e)); setPlayers([]); });
  }, [groupId, call, flash, version]);
  useEffect(() => {
    setInfo(null);
    if (groupId) call<GroupInfo>(`/api/groups/${groupId}`).then(setInfo).catch(() => undefined);
  }, [groupId, call, version]);

  if (groups.length === 0) {
    return (
      <main className="main">
        <Empty icon="squad" title="Crea tu primer grupo" text="Por ejemplo “Fútbol Jueves”. Luego invita a tus jugadores con un enlace."
          action={<button className="btn primary" onClick={onCreateGroup}><Icon n="plus" /> Crear grupo</button>} />
      </main>
    );
  }

  const all = players ?? [];
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const list = all
    .filter((p) => (filter === 'ALL' || p.pos === filter) && (!q.trim() || norm(`${p.displayName ?? p.name} ${p.nick ?? ''} ${p.lastName ?? ''}`).includes(norm(q.trim()))))
    .sort((a, b) => b.stars - a.stars || a.name.localeCompare(b.name));
  const gk = all.filter((p) => p.pos === 'GK').length;
  const avg = all.length ? all.reduce((s, p) => s + p.stars, 0) / all.length : 0;
  const filtered = filter !== 'ALL' || !!q.trim();

  return (
    <main className="main roster" key={groupId}>
      <div className="toolbar">
        <div className="seg">
          <button className={sub === 'players' ? 'on' : ''} onClick={() => setSub('players')}>Jugadores</button>
          <button className={sub === 'stats' ? 'on' : ''} onClick={() => setSub('stats')}>Estadísticas</button>
        </div>
        <button className="iconbtn" onClick={openSettings} aria-label={manage ? 'Editar grupo' : 'Ajustes del grupo'} title={manage ? 'Editar grupo' : 'Grupo'}><Icon n="more" /></button>
      </div>

      {sub === 'stats' ? (
        <StatsPanel groups={groups} groupId={groupId} call={call} flash={flash} version={version} onAdjusted={onAdjusted} />
      ) : (
        <>
          {info?.invite && <InviteBar url={info.invite.url} groupName={info.name} flash={flash} />}
          <div className="searchbox">
            <Icon n="search" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar jugador" aria-label="Buscar jugador" autoComplete="off" />
            {q && <button className="iconbtn round sm" onClick={() => setQ('')} aria-label="Borrar búsqueda"><Icon n="x" /></button>}
          </div>
          <div className="filters">
            {([['ALL', 'Todos'], ['GK', 'Porteros'], ['DEF', 'Defensas'], ['ATT', 'Atacantes']] as [string, string][]).map(([k, l]) => (
              <button key={k} className={`fchip${filter === k ? ' on' : ''}`} onClick={() => setFilter(k as 'ALL' | Pos)}>{l}</button>
            ))}
          </div>
          {players !== null && all.length > 0 && (
            <span className="summary">
              {all.length} jugadores · {gk} porteros{manage ? ` · media ${f1(avg)}★` : ''}
              {manage && <span className="lockt"><Icon n="lock" /> estrellas solo visibles para admins</span>}
            </span>
          )}
          {players === null ? <SkRows /> : list.length === 0 ? (
            filtered ? (
              <Empty icon="search" title="Ningún jugador coincide"
                action={<button className="btn" onClick={() => { setQ(''); setFilter('ALL'); }}>Quitar filtros</button>} />
            ) : (
              <Empty icon="squad" title="Todavía no hay jugadores"
                text={manage ? 'Añade al primero o comparte el enlace de invitación.' : 'Cuando se unan aparecerán aquí.'}
                action={manage ? <button className="btn primary" onClick={openNewPlayer}><Icon n="plus" /> Añadir jugador</button> : undefined} />
            )
          ) : (
            <div className="card list">
              {list.map((p) => {
                const inner = (
                  <>
                    <Av name={p.displayName ?? p.name} url={p.photoUrl} />
                    <span className="pname">
                      <b>{p.displayName ?? p.name}</b>
                      <small>{[POS[p.pos].label, p.role !== 'member' ? ROLE_LABEL[p.role] : '', p.hasAccount ? '' : 'sin cuenta'].filter(Boolean).join(' · ')}</small>
                    </span>
                    <PosChip pos={p.pos} />
                    {manage ? <span><Stars v={p.stars} size={12} /></span> : <span />}
                  </>
                );
                return manage ? (
                  <button key={p.id} className="prow" onClick={() => openPlayer(
                    { id: p.id, name: p.name, nick: p.nick ?? '', lastName: p.lastName ?? '', pos: p.pos, stars: Math.min(5, Math.max(1, p.stars)), role: p.role, hasAccount: p.hasAccount },
                    all.filter((x) => x.hasAccount && x.id !== p.id)
                  )}>{inner}</button>
                ) : <div key={p.id} className="prow">{inner}</div>;
              })}
            </div>
          )}
          {manage && all.length > 0 && (
            <div className="two">
              <button className="btn primary" onClick={openNewPlayer}><Icon n="plus" /> Jugador</button>
              <button className="btn" onClick={openExisting}>De otro grupo</button>
            </div>
          )}
        </>
      )}
    </main>
  );
}

const ADJ_KEY = 'eqfc-adj';
function readAdj(): string[] {
  try { return JSON.parse(localStorage.getItem(ADJ_KEY) || '[]'); } catch { return []; }
}

function StatsPanel({ groups, groupId, call, flash, version, onAdjusted }: {
  groups: Group[]; groupId: string; call: Call; flash: (m: string) => void; version: number; onAdjusted: () => void;
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

  if (rows === null) return <SkRows n={5} />;
  return (
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
      {ranked.length === 0 ? (
        <Empty icon="stats" title="Aún no hay estadísticas" text="Aparecerán cuando se registre el resultado del primer partido." />
      ) : (
        <>
          <h2 className="sec">Ranking del grupo</h2>
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
          <span className="summary">Partidos finalizados con resultado. Las sugerencias se basan en victorias y votos MVP.</span>
        </>
      )}
    </>
  );
}

/* ================================ Principal ================================ */
const TITLES: Record<Tab, string> = { matches: 'Partidos', chat: 'Chat', squad: 'Plantilla', profile: 'Perfil' };
const GROUP_KEY = 'eqfc-group';

/** Cabecera fija: selector compacto del grupo activo (con su escudo) y la campana. */
function TopHeader({ groups, groupId, setGroupId, onCreateGroup, unread, onBell }: {
  groups: Group[]; groupId: string; setGroupId: (id: string) => void; onCreateGroup: () => void; unread: number; onBell: () => void;
}) {
  return (
    <header className="tophdr">
      {groups.length ? (
        <Picker hdr value={groupId} onChange={setGroupId} options={groupOpts(groups)} title="Cambiar de grupo"
          subtitle="El grupo activo se usa en Chat y Plantilla" placeholder="Elige un grupo…"
          footer={<button className="btn primary block" onClick={onCreateGroup}><Icon n="plus" /> Crear nuevo grupo</button>} />
      ) : (
        <span className="brand"><span className="brand-ico"><Icon n="ball" /></span>Equilibrio FC</span>
      )}
      <button className="iconbtn bellbtn" onClick={onBell} aria-label={`Avisos${unread ? ` (${unread} sin leer)` : ''}`}>
        <Icon n="bell" />{unread > 0 && <span className="dot">{badgeTxt(unread)}</span>}
      </button>
    </header>
  );
}

/** Barra inferior de 4 pestañas con sus contadores. */
function BottomNav({ tab, setTab, me, badges }: {
  tab: Tab; setTab: (t: Tab) => void; me: Me | null;
  badges: { chat: number; matches: number; matchesNew: boolean; profile: boolean };
}) {
  return (
    <nav className="nav bnav" aria-label="Secciones">
      {(['matches', 'chat', 'squad', 'profile'] as Tab[]).map((k) => (
        <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}
          aria-label={`${TITLES[k]}${k === 'chat' && badges.chat ? ` (${badges.chat} sin leer)` : ''}`}>
          {k === 'profile' && me?.photoUrl ? <span className="navav"><Av name={me.displayName ?? me.name} url={me.photoUrl} size={24} /></span> : <Icon n={k} />}
          <span>{TITLES[k]}</span>
          {k === 'chat' && badges.chat > 0 && <span className="dot">{badgeTxt(badges.chat)}</span>}
          {k === 'matches' && badges.matches > 0 && <span className="dot">{badges.matches}</span>}
          {k === 'matches' && !badges.matches && badges.matchesNew && <span className="dot new" aria-label="Partidos nuevos" />}
          {k === 'profile' && badges.profile && <span className="dot new" aria-label="Completa tu perfil" />}
        </button>
      ))}
    </nav>
  );
}

/** Pestaña Partidos: próximos e historial, nada más. */
function MatchesView({ loaded, error, pending, history, groups, managed, toResult, freshIds, sub, setSub, onNew, onOpen, onCreateGroup, call, flash }: {
  loaded: boolean; error: string; pending: MatchRow[]; history: HistRow[]; groups: Group[]; managed: Group[]; toResult: HistRow[];
  freshIds: string[]; sub: 'next' | 'history'; setSub: (s: 'next' | 'history') => void; onNew: () => void; onOpen: (id: string) => void;
  onCreateGroup: () => void; call: Call; flash: (m: string) => void;
}) {
  const canCreate = managed.length > 0;
  return (
    <main className="main matches">
      {error && <div className="alert err">No se pudo conectar con el servidor: {error}</div>}
      {loaded && <PushBanner call={call} flash={flash} />}
      {toResult.length > 0 && sub === 'next' && (
        <button className="nudge" onClick={() => setSub('history')}>
          <span className="nudge-ico"><Icon n="ball" /></span>
          <span className="pname"><b>¡Vota al MVP y registra el resultado!</b><small>{toResult.length === 1 ? '1 partido espera' : `${toResult.length} partidos esperan`} resultado</small></span>
          <Icon n="chev" />
        </button>
      )}
      <div className="toolbar">
        <div className="seg">
          <button className={sub === 'next' ? 'on' : ''} onClick={() => setSub('next')}>Próximos{loaded && pending.length > 0 && <span className="segn">{pending.length}</span>}</button>
          <button className={sub === 'history' ? 'on' : ''} onClick={() => setSub('history')}>Historial{toResult.length > 0 && <span className="segn warn">{toResult.length}</span>}</button>
        </div>
        {canCreate && <button className="btn primary sm" onClick={onNew} aria-label="Nuevo partido"><Icon n="plus" /> Nuevo</button>}
      </div>

      {!loaded ? <SkMatches /> : groups.length === 0 ? (
        <Empty icon="squad" title="Aún no estás en ningún grupo" text="Crea el tuyo o pide a tu admin el enlace de invitación."
          action={<button className="btn primary" onClick={onCreateGroup}><Icon n="plus" /> Crear grupo</button>} />
      ) : sub === 'next' ? (
        pending.length === 0 ? (
          <Empty icon="matches" title="No hay partidos próximos" text="Convoca con una encuesta en el Chat o crea uno directamente."
            action={canCreate ? <button className="btn primary" onClick={onNew}><Icon n="plus" /> Nuevo partido</button> : undefined} />
        ) : pending.map((m) => (
          <MatchCard key={m.id} m={m} count={m.playersCount} fresh={!!m.isNew || freshIds.includes(m.id)}
            right={<Icon n="chev" />} onOpen={() => onOpen(m.id)} />
        ))
      ) : history.length === 0 ? (
        <Empty icon="history" title="Todavía no hay partidos jugados" text="Aparecerán aquí cuando pase su hora." />
      ) : history.map((m) => (
        <MatchCard key={m.id} m={m} played onOpen={() => onOpen(m.id)}
          right={m.needsResult ? <span className="chip warn">Sin resultado</span> : <span className="score">{m.scoreA}<i>–</i>{m.scoreB}</span>} />
      ))}
    </main>
  );
}

function Main({ onLogout, startGroupId }: { onLogout: () => void; startGroupId?: string | null }) {
  const [tab, setTab] = useState<Tab>(startGroupId ? 'chat' : 'matches');
  const [matchesSub, setMatchesSub] = useState<'next' | 'history'>('next');
  const [theme, setThemeState] = useState<Theme>('dark');
  const [view, setView] = useState<View>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [pending, setPending] = useState<MatchRow[]>([]);
  const [history, setHistory] = useState<HistRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [toastKey, setToastKey] = useState(0);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [groupId, setGroupIdState] = useState(startGroupId ?? '');
  const [version, setVersion] = useState(0);
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [bellOpen, setBellOpen] = useState(false);
  const [freshIds, setFreshIds] = useState<string[]>([]); // partidos nuevos/modificados que se están viendo ahora

  useEffect(() => { const t = readTheme(); setThemeState(t); if (t === 'light') applyTheme(t); }, []);
  const setTheme = (t: Theme) => { setThemeState(t); applyTheme(t); };

  // El grupo elegido se recuerda en este navegador y es el mismo en Chat y Plantilla.
  const setGroupId = useCallback((id: string) => {
    setGroupIdState(id);
    try { localStorage.setItem(GROUP_KEY, id); } catch { /* sin almacenamiento */ }
  }, []);
  useEffect(() => {
    if (startGroupId) { setGroupId(startGroupId); return; }
    try { const g = localStorage.getItem(GROUP_KEY); if (g) setGroupIdState(g); } catch { /* sin almacenamiento */ }
  }, [startGroupId, setGroupId]);

  const call: Call = useCallback(<T,>(path: string, method = 'GET', body?: unknown) => api<T>(path, method, body), []);
  // Toast discreto arriba: desaparece solo a los 2,5 s
  const flash = useCallback((m: string) => { setToastMsg(m); setToastKey((k) => k + 1); }, []);
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(''), 2500);
    return () => clearTimeout(t);
  }, [toastMsg, toastKey]);

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

  // Refresco cada 30 s: un partido pasa solo de "Próximos" al "Historial" cuando llega su hora.
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
  const openGroupCreate = () => setSheet({ t: 'group' });

  const leaveGroup = async () => {
    if (!me || !current) return;
    try {
      await call(`/api/groups/${current.id}/players/${me.id}`, 'DELETE');
      flash('Has salido del grupo');
      setSheet(null);
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
        onCreated={(id) => { setView({ t: 'match', id, pack: true }); setTab('matches'); setMatchesSub('next'); refresh(); }} />
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
    let body: ReactNode;
    if (tab === 'chat') {
      body = (
        <ChatRoom groups={groups} groupId={groupId} meId={me?.id ?? ''} call={call} flash={flash}
          onOpenMatch={(id) => setView({ t: 'match', id })}
          onCreateMatch={(prefill) => setView({ t: 'new', prefill })}
          onRead={markChatRead} onCreateGroup={openGroupCreate} />
      );
    } else if (tab === 'squad') {
      body = (
        <RosterView groups={groups} groupId={groupId} call={call} flash={flash} version={version}
          openPlayer={(init, accounts) => setSheet({ t: 'player', init, accounts })}
          openNewPlayer={() => setSheet({ t: 'player', init: { name: '', nick: '', lastName: '', pos: 'DEF', stars: 3 }, accounts: [] })}
          openExisting={() => setSheet({ t: 'existing' })} openSettings={() => setSheet({ t: 'groupSettings' })}
          onCreateGroup={openGroupCreate} onAdjusted={bump} />
      );
    } else if (tab === 'profile') {
      body = me ? (
        <ProfileView key={me.id} me={me} call={call} flash={flash} onUpdate={setMe} onLogout={onLogout} theme={theme} onTheme={setTheme} />
      ) : <main className="main"><SkRows n={4} /></main>;
    } else {
      body = (
        <MatchesView loaded={loaded} error={error} pending={pending} history={history} groups={groups} managed={managed}
          toResult={toResult} freshIds={freshIds} sub={matchesSub} setSub={setMatchesSub}
          onNew={() => setView({ t: 'new' })} onOpen={(id) => setView({ t: 'match', id })}
          onCreateGroup={openGroupCreate} call={call} flash={flash} />
      );
    }
    screen = (
      <>
        <TopHeader groups={groups} groupId={groupId} setGroupId={setGroupId} onCreateGroup={openGroupCreate}
          unread={unreadNotifs} onBell={() => setBellOpen(true)} />
        <div className="tabbody" key={tab}>{body}</div>
        <BottomNav tab={tab} setTab={setTab} me={me}
          badges={{ chat: unreadChatTotal, matches: toResult.length, matchesNew: anyNewMatches && tab !== 'matches', profile: !!me && !me.nick && !me.lastName }} />
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
      {sheet && sheet.t === 'groupSettings' && current && (
        <GroupSettingsSheet key={current.id} group={current} call={call} flash={flash} onClose={() => setSheet(null)}
          onChanged={refresh} onDelete={() => setSheet({ t: 'deleteGroup' })} onLeave={leaveGroup} />
      )}
      {sheet && sheet.t === 'deleteGroup' && current && (
        <DeleteGroupSheet group={current} call={call} flash={flash} onClose={() => setSheet(null)}
          onDone={() => { setSheet(null); setGroupIdState(''); bump(); }} />
      )}
      {bellOpen && (
        <SheetShell title="Avisos" onClose={() => setBellOpen(false)}>
          {notifs.length === 0 ? <Empty icon="bell" title="No tienes avisos todavía" text="Aquí verás encuestas, partidos nuevos y cambios." /> : (
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
      <div key={toastKey} className={`toast${toastMsg ? ' show' : ''}`} role="status" aria-live="polite">{toastMsg}</div>
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
