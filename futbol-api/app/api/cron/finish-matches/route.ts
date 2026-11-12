import { pool } from '@/lib/db';
import { handle } from '@/lib/http';
import { requireCron } from '@/lib/auth';
import { finishDueMatches, systemMessage } from '@/lib/queries';
import { pushToPlayers } from '@/lib/push';

export const dynamic = 'force-dynamic';

// 1) Pasa a "finished" los partidos pendientes ya vencidos.
// 2) Avisa en el chat y con notificación push al admin y co-admins de los finalizados que aún no se han notificado.
// Lo llama pg_cron de Supabase cada minuto (supabase/03_cron.sql) y Vercel Cron
// una vez al día como red de seguridad.
async function run(req: Request) {
  requireCron(req);
  await finishDueMatches(pool);

  const { rows } = await pool.query(
    `SELECT m.id, m.group_id, g.name AS "groupName",
            (m.result_notified_at IS NULL) AS "needsPush", (m.chat_notified_at IS NULL) AS "needsChat",
            ARRAY(SELECT gp.player_id FROM group_players gp
                   WHERE gp.group_id = m.group_id AND gp.is_active AND gp.role IN ('owner', 'co_admin')) AS managers
       FROM matches m JOIN groups g ON g.id = m.group_id
      WHERE m.status = 'finished' AND (m.result_notified_at IS NULL OR m.chat_notified_at IS NULL)`
  );

  let sent = 0;
  for (const m of rows) {
    // Aviso en el chat del grupo (una sola vez por partido)
    if (m.needsChat) {
      await systemMessage(pool, m.group_id, '🏁 El partido ya se ha jugado. ¡Vota al MVP y registra el resultado!', {
        event: 'match_finished', matchId: m.id,
      });
      await pool.query('UPDATE matches SET chat_notified_at = now() WHERE id = $1', [m.id]);
    }
    if (!m.needsPush) continue;
    // Push al admin y co-admins (los que registran el resultado). Se marca siempre para no repetirlo;
    // quien no tenga notificaciones activadas lo verá igualmente dentro de la app (Historial).
    sent += await pushToPlayers(pool, m.managers ?? [], {
      title: `🏁 Partido finalizado · ${m.groupName}`,
      body: 'El partido ya se ha jugado. ¡Vota al MVP y registra el resultado!',
      url: `/?match=${m.id}`,
      tag: `match-${m.id}`,
    }).catch(() => 0);
    await pool.query('UPDATE matches SET result_notified_at = now() WHERE id = $1', [m.id]);
  }
  return Response.json({ finishedPendingNotification: rows.length, notified: sent });
}

export const GET = handle(run);
export const POST = handle(run);
