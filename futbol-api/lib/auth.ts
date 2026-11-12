import { HttpError } from './http';
import { pool, tx } from './db';

/**
 * Autenticación v1.3: Supabase Auth.
 * El navegador envía `Authorization: Bearer <access_token>` y aquí se valida contra
 * Supabase. Cada cuenta tiene su fila en `players` (players.auth_user_id): esa es su
 * identidad dentro de la app (perfil, convocatorias, chat, votos).
 */
export type Me = { playerId: string; authId: string; email: string | null; name: string };

type AuthUser = { id: string; email?: string | null; user_metadata?: Record<string, unknown> };

// Caché corta por token: evita una llamada a Supabase en cada petición de la misma pantalla.
const cache = new Map<string, { user: AuthUser; exp: number }>();

async function verifyToken(token: string): Promise<AuthUser> {
  const hit = cache.get(token);
  if (hit && hit.exp > Date.now()) return hit.user;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new HttpError(500, 'Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY');

  const res = await fetch(`${url.replace(/\/$/, '')}/auth/v1/user`, {
    headers: { apikey: key, Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new HttpError(401, 'Sesión caducada. Vuelve a iniciar sesión.');
  const user = (await res.json()) as AuthUser;
  if (cache.size > 500) cache.clear();
  cache.set(token, { user, exp: Date.now() + 60_000 });
  return user;
}

/** Devuelve el usuario autenticado (y crea su perfil de jugador la primera vez). */
export async function requireUser(req: Request): Promise<Me> {
  const header = req.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) throw new HttpError(401, 'No autenticado');
  const user = await verifyToken(token);

  const { rows } = await pool.query('SELECT id, name, email FROM players WHERE auth_user_id = $1', [user.id]);
  if (rows.length) return { playerId: rows[0].id, authId: user.id, email: rows[0].email ?? user.email ?? null, name: rows[0].name };
  return ensureProfile(user);
}

/**
 * Primer acceso: crea el jugador de la cuenta. Si el email coincide con el de la tabla
 * `admins` (instalación v1.2), esa cuenta pasa a ser owner de todos los grupos antiguos.
 */
async function ensureProfile(user: AuthUser): Promise<Me> {
  return tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.id]);
    const again = await c.query('SELECT id, name, email FROM players WHERE auth_user_id = $1', [user.id]);
    if (again.rows.length) return { playerId: again.rows[0].id, authId: user.id, email: again.rows[0].email, name: again.rows[0].name };

    const email = user.email ?? null;
    const legacy = email
      ? await c.query(
          'SELECT id, display_name, push_token FROM admins WHERE lower(email) = lower($1) AND claimed_player_id IS NULL FOR UPDATE',
          [email]
        )
      : { rows: [] as any[] };
    const admin = legacy.rows[0];

    const metaName = typeof user.user_metadata?.name === 'string' ? (user.user_metadata.name as string).trim() : '';
    const name = (metaName || admin?.display_name || email?.split('@')[0] || 'Jugador').slice(0, 60);

    const p = await c.query(
      `INSERT INTO players (auth_user_id, email, name, pos, admin_id, push_token)
       VALUES ($1, $2, $3, 'DEF', $4, $5) RETURNING id`,
      [user.id, email, name, admin?.id ?? null, admin?.push_token ?? null]
    );
    const playerId: string = p.rows[0].id;

    if (admin) {
      await c.query('UPDATE admins SET claimed_player_id = $2 WHERE id = $1', [admin.id, playerId]);
      await c.query(
        `INSERT INTO group_players (group_id, player_id, stars, role)
         SELECT g.id, $2, 3, 'owner' FROM groups g WHERE g.admin_id = $1
         ON CONFLICT (group_id, player_id) DO UPDATE SET role = 'owner', is_active = TRUE, left_at = NULL`,
        [admin.id, playerId]
      );
      await c.query('UPDATE groups SET created_by = $2 WHERE admin_id = $1 AND created_by IS NULL', [admin.id, playerId]);
      await c.query('UPDATE players SET created_by = $2 WHERE admin_id = $1 AND created_by IS NULL AND id <> $2', [admin.id, playerId]);
    }
    return { playerId, authId: user.id, email, name };
  });
}

export function requireCron(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    throw new HttpError(401, 'No autorizado');
  }
}
