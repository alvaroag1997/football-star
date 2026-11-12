/**
 * Notificaciones push en el navegador (lado cliente).
 *  - Android / ordenador: basta con aceptar el permiso.
 *  - iPhone / iPad (iOS 16.4+): SOLO con la app añadida a la pantalla de inicio y abierta desde ahí.
 */
export type PushState = 'unsupported' | 'ios-needs-install' | 'denied' | 'off' | 'on';

export const isIOS = () =>
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const isStandalone = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64url: string) {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerSW() {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch (e) {
    console.warn('[push] no se pudo registrar el service worker', e);
    return null;
  }
}

export async function pushState(): Promise<PushState> {
  if (!pushSupported()) return isIOS() && !isStandalone() ? 'ios-needs-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Pide permiso (debe llamarse desde un toque del usuario) y devuelve la suscripción para guardarla en la API. */
export async function subscribePush(): Promise<PushSubscriptionJSON> {
  const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!key) throw new Error('Falta NEXT_PUBLIC_VAPID_PUBLIC_KEY en la configuración');
  if (!pushSupported()) throw new Error(isIOS() ? 'En iPhone, añade la app a la pantalla de inicio y ábrela desde ahí' : 'Este navegador no admite notificaciones');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('No has dado permiso para las notificaciones');
  const reg = (await registerSW()) ?? (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) as BufferSource }));
  return sub.toJSON();
}

/** Suscripción actual de este dispositivo (para re-registrarla al abrir la app). */
export async function currentSubscription(): Promise<PushSubscriptionJSON | null> {
  if (!pushSupported() || Notification.permission !== 'granted') return null;
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? sub.toJSON() : null;
}

export async function unsubscribePush(): Promise<string | null> {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}
