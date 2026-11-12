import { pool } from '@/lib/db';
import { handle } from '@/lib/http';
import { requireCron } from '@/lib/auth';
import { finishDueMatches, systemMessage } from '@/lib/queries';
import { sendPush } from '@/lib/push';

export const dynamic = 'force-dynamic';

// 1) Pasa a "finished" los partidos pendientes ya vencidos.
// 2) Notifica al admin (owner) de cada grupo y avisa en el chat los finalizados que aún no se han notificado.
// Lo llama pg_cron de Supabase cada minuto (supabase/03_cron.sql) y Vercel Cron
// una vez al día como red de seguridad.
async function run(req: Request) {
  requireCron(req);
  await finishDueMatches(pool);

  const { rows } = await pool.query(
    `SELECT m.id, m.group_id, o.push_token,
            (m.result_notified_at IS NULL) AS "needsPush", (m.chat_notified_at IS NULL) AS "needsChat"
       FROM matches m
       LEFT JOIN group_players gp ON gp.group_id = m.group_id AND gp.role = 'owner'
       LEFT JOIN players o ON o.id = gp.player_id
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
    // Sin token no hay a quién avisar: la app lo mostrará igualmente como aviso
    // dentro de la app (needsResult = true en /api/history).
    const ok = m.push_token
      ? await sendPush(m.push_token, 'Partido finalizado', 'El partido ya se ha jugado. ¡Vota al MVP y registra el resultado!', { matchId: m.id })
      : true;
    if (ok) {
      await pool.query('UPDATE matches SET result_notified_at = now() WHERE id = $1', [m.id]);
      sent++;
    }
  }
  return Response.json({ finishedPendingNotification: rows.length, notified: sent });
}

export const GET = handle(run);
export const POST = handle(run);
