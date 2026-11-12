-- =====================================================================
-- Migración v1.5: notificaciones push en el móvil (Web Push)
-- EJECUTAR UNA VEZ en Supabase (SQL Editor) ANTES de desplegar el código v1.5.
-- No borra datos. Es seguro repetirlo.
-- =====================================================================

-- Dispositivos de cada usuario (móvil, ordenador…): uno por navegador / app instalada.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  endpoint        TEXT NOT NULL UNIQUE,     -- URL del servicio push (Google, Apple, Mozilla…)
  p256dh          TEXT NOT NULL,            -- claves de cifrado del dispositivo
  auth            TEXT NOT NULL,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_success_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_player ON push_subscriptions (player_id);

-- Qué quiere recibir cada uno en el móvil (la campana de la app recibe siempre todo)
ALTER TABLE players ADD COLUMN IF NOT EXISTS notify_chat    BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE players ADD COLUMN IF NOT EXISTS notify_polls   BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE players ADD COLUMN IF NOT EXISTS notify_matches BOOLEAN NOT NULL DEFAULT TRUE;

-- Solo la API (DATABASE_URL) toca esta tabla
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
