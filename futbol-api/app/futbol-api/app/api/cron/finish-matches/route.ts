import { pool } from '@/lib/db';
import { handle } from '@/lib/http';
import { requireCron } from '@/lib/auth';
import { finishDueMatches } from '@/lib/queries';
import { sendPush } from '@/lib/push';

export const dynamic = 'force-dynamic';

// 1) Pasa a "finished" los partidos pendientes ya vencidos.
// 2) Notifica a los admins los finalizados que aún no se han notificado.
// Lo llama pg_cron de Supabase cada minuto (supabase/03_cron.sql) y Vercel Cron
// una vez al día como red de seguridad.
async function run(req: Request) {
  requireCron(req);
  await finishDueMatches(pool);

  const { rows } = await pool.query(
    `SELECT m.id, a.push_token
       FROM matches m
       JOIN groups g ON g.id = m.group_id
       JOIN admins a ON a.id = g.admin_id
      WHERE m.status = 'finished' AND m.result_notified_at IS NULL`
  );

  let sent = 0;
  for (const m of rows) {
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
