import { pool } from '@/lib/db';
import { handle, readBody, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';

// Guarda este dispositivo para recibir notificaciones push.
// Body: la suscripción del navegador (PushSubscription.toJSON()): { endpoint, keys: { p256dh, auth } }
export const POST = handle(async (req) => {
  const me = await requireUser(req);
  const b = await readBody(req);
  const endpoint = typeof b.endpoint === 'string' ? b.endpoint : '';
  const p256dh = typeof b.keys?.p256dh === 'string' ? b.keys.p256dh : '';
  const auth = typeof b.keys?.auth === 'string' ? b.keys.auth : '';
  if (!/^https:\/\//.test(endpoint) || !p256dh || !auth) throw new HttpError(400, 'Suscripción push no válida');
  const ua = (req.headers.get('user-agent') || '').slice(0, 300);
  // Si el dispositivo ya estaba guardado (p. ej. con otra cuenta), pasa a esta cuenta
  await pool.query(
    `INSERT INTO push_subscriptions (player_id, endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (endpoint) DO UPDATE
       SET player_id = EXCLUDED.player_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent`,
    [me.playerId, endpoint, p256dh, auth, ua]
  );
  const n = await pool.query('SELECT count(*)::int AS n FROM push_subscriptions WHERE player_id = $1', [me.playerId]);
  return Response.json({ ok: true, devices: n.rows[0].n }, { status: 201 });
});

// Deja de recibir notificaciones en este dispositivo. Body: { endpoint }
export const DELETE = handle(async (req) => {
  const me = await requireUser(req);
  const { endpoint } = await readBody(req);
  if (typeof endpoint !== 'string' || !endpoint) throw new HttpError(400, 'endpoint es obligatorio');
  await pool.query('DELETE FROM push_subscriptions WHERE player_id = $1 AND endpoint = $2', [me.playerId, endpoint]);
  return Response.json({ ok: true });
});
