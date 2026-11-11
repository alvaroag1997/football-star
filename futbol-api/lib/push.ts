/**
 * Envío de notificaciones push.
 *
 * PENDIENTE: conectar un proveedor real (Firebase Cloud Messaging v1 o Expo Push).
 * Mientras no esté conectado devuelve false y el partido queda sin marcar como
 * notificado, así se enviará en cuanto implementes esta función.
 */
export async function sendPush(
  token: string,
  title: string,
  body: string,
  data: Record<string, string> = {}
): Promise<boolean> {
  console.log('[push] proveedor no configurado, no se envía:', { token: token.slice(0, 8) + '…', title, body, data });
  return false;
}
