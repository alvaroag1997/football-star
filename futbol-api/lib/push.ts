import webpush from 'web-push';
import type { Db } from './queries';

/**
 * Notificaciones push en el móvil y el ordenador (Web Push con claves VAPID).
 * Funciona en Android/Chrome, ordenadores y iPhone (iOS 16.4+) con la app añadida a la
 * pantalla de inicio. Variables: NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT.
 */
export type PushPayload = {
  title: string;
  body: string;
  url: string;   // qué abrir al tocarla: '/?match=<id>' o '/?group=<id>&tab=chat'
  tag?: string;  // misma etiqueta = la nueva sustituye a la anterior (p. ej. un chat)
};

let configured: boolean | null = null;
function configure() {
  if (configured !== null) return configured;
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    console.warn('[push] Faltan NEXT_PUBLIC_VAPID_PUBLIC_KEY o VAPID_PRIVATE_KEY: no se envían notificaciones push');
    configured = false;
    return false;
  }
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'https://futbol-zeta-three.vercel.app', pub, priv);
  configured = true;
  return true;
}

/** Envía la notificación a todos los dispositivos de esos jugadores. Devuelve cuántos la recibieron. */
export async function pushToPlayers(db: Db, playerIds: string[], payload: PushPayload): Promise<number> {
  if (!playerIds.length || !configure()) return 0;
  const { rows } = await db.query(
    'SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE player_id = ANY($1::uuid[])',
    [playerIds]
  );
  if (!rows.length) return 0;

  const ok: string[] = [];
  const dead: string[] = [];
  await Promise.all(
    rows.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24, urgency: 'high' }
        );
        ok.push(s.id);
      } catch (e: any) {
        // 404/410: el usuario quitó el permiso o desinstaló la app → se borra el dispositivo
        if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(s.id);
        else console.error('[push] error', e?.statusCode, e?.body ?? e?.message);
      }
    })
  );
  if (dead.length) await db.query('DELETE FROM push_subscriptions WHERE id = ANY($1::uuid[])', [dead]);
  if (ok.length) await db.query('UPDATE push_subscriptions SET last_success_at = now() WHERE id = ANY($1::uuid[])', [ok]);
  return ok.length;
}
