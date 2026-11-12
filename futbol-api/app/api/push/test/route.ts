import { pool } from '@/lib/db';
import { handle, HttpError } from '@/lib/http';
import { requireUser } from '@/lib/auth';
import { pushToPlayers } from '@/lib/push';

// "Enviar notificación de prueba" a todos tus dispositivos.
export const POST = handle(async (req) => {
  const me = await requireUser(req);
  const sent = await pushToPlayers(pool, [me.playerId], {
    title: '⚽ Equilibrio FC',
    body: '¡Las notificaciones funcionan! Así te avisaremos de encuestas, partidos y mensajes.',
    url: '/',
    tag: 'test',
  });
  if (!sent) throw new HttpError(409, 'No se pudo enviar: activa las notificaciones en este dispositivo y vuelve a probar');
  return Response.json({ sent });
});
