-- Ejecuta esto DESPUÉS de desplegar en Vercel (necesitas la URL real).
-- Sustituye TU-PROYECTO.vercel.app y TU_CRON_SECRET (el mismo valor que CRON_SECRET en Vercel).
-- En Supabase, activa antes las extensiones desde Database -> Extensions si no lo están.
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Cada minuto: pasar partidos vencidos a "Finalizado" y lanzar la notificación.
SELECT cron.schedule(
  'finish-matches-every-minute',
  '* * * * *',
  $$
  SELECT net.http_get(
    url     := 'https://TU-PROYECTO.vercel.app/api/cron/finish-matches',
    headers := '{"Authorization": "Bearer TU_CRON_SECRET"}'::jsonb
  );
  $$
);

-- Para quitarlo:  SELECT cron.unschedule('finish-matches-every-minute');
