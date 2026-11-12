-- =====================================================================
-- Migración v1.4: nombre visible, invitados externos, edición de partidos,
-- notificaciones y avisos de "no leído".
-- EJECUTAR UNA VEZ en Supabase (SQL Editor) ANTES de desplegar el código v1.4.
-- No borra datos. Es seguro repetirlo.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. NOMBRE VISIBLE: nombre + apodo o apellido
--    "Carlos 'El Mago'" (con apodo) · "Carlos M." (con apellido) · "Carlos"
--    Se calcula solo (columna generada) y es lo que se ve en chat, plantilla y convocatorias.
-- ---------------------------------------------------------------------
ALTER TABLE players ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_last_name_len;
ALTER TABLE players ADD CONSTRAINT players_last_name_len CHECK (last_name IS NULL OR char_length(last_name) <= 60);

ALTER TABLE players DROP COLUMN IF EXISTS display_name;
ALTER TABLE players ADD COLUMN display_name TEXT GENERATED ALWAYS AS (
  CASE
    WHEN nullif(btrim(nick), '') IS NOT NULL THEN btrim(name) || ' ''' || btrim(nick) || ''''
    WHEN nullif(btrim(last_name), '') IS NOT NULL THEN btrim(name) || ' ' || upper(left(btrim(last_name), 1)) || '.'
    ELSE btrim(name)
  END
) STORED;

-- ---------------------------------------------------------------------
-- 2. LECTURA POR USUARIO Y GRUPO (badges del chat y de partidos nuevos)
--    Empiezan en "ahora" para que lo antiguo no salga como no leído.
-- ---------------------------------------------------------------------
ALTER TABLE group_players ADD COLUMN IF NOT EXISTS last_read_chat_at    TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE group_players ADD COLUMN IF NOT EXISTS last_seen_matches_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ---------------------------------------------------------------------
-- 3. CUPO DE ENCUESTAS DESDE 1 (el mínimo de 10 se exige al crear el partido)
-- ---------------------------------------------------------------------
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_max_slots_check;
ALTER TABLE polls ADD CONSTRAINT polls_max_slots_check CHECK (max_slots BETWEEN 1 AND 60);

-- ---------------------------------------------------------------------
-- 4. INVITADOS EXTERNOS EN ENCUESTAS (solo admin / co-admin)
--    Cuentan para el cupo y pasan al partido al pulsar "Crear Partido con Confirmados".
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS poll_guests (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id    UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,   -- filtro de Realtime
  name       TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 60),
  stars      NUMERIC(2,1) NOT NULL DEFAULT 3 CHECK (stars BETWEEN 1 AND 5),
  pos        TEXT NOT NULL DEFAULT 'DEF' CHECK (pos IN ('GK', 'DEF', 'ATT')),
  added_by   UUID REFERENCES players(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()        -- orden de llegada (cupo / lista de espera)
);
CREATE INDEX IF NOT EXISTS idx_poll_guests_poll ON poll_guests (poll_id);

-- ---------------------------------------------------------------------
-- 5. INVITADOS EXTERNOS EN PARTIDOS
--    Van en match_players con player_id NULL e is_guest = TRUE: así entran solos en el
--    reparto de equipos, titulares/suplentes, MVP y alineación (snapshot de nombre y estrellas).
-- ---------------------------------------------------------------------
ALTER TABLE match_players ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------------
-- 6. EDICIÓN DE PARTIDOS: notas y fecha de última modificación
-- ---------------------------------------------------------------------
ALTER TABLE matches ADD COLUMN IF NOT EXISTS notes      TEXT CHECK (notes IS NULL OR char_length(notes) <= 500);
ALTER TABLE matches ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_matches_group_status ON matches (group_id, status);

-- ---------------------------------------------------------------------
-- 7. NOTIFICACIONES (campana in-app; el push usa players.push_token)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,   -- destinatario
  group_id   UUID REFERENCES groups(id) ON DELETE CASCADE,
  type       TEXT NOT NULL CHECK (type IN ('chat', 'poll', 'match_created', 'match_updated')),
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,     -- {"matchId": "..."} / {"pollId": "..."}
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notifications_player ON notifications (player_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (player_id) WHERE read_at IS NULL;

-- ---------------------------------------------------------------------
-- 8. RLS (solo lectura, para Realtime) y publicación
-- ---------------------------------------------------------------------
ALTER TABLE poll_guests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS poll_guests_select ON poll_guests;
CREATE POLICY poll_guests_select ON poll_guests FOR SELECT TO authenticated USING (is_group_member(group_id));

CREATE OR REPLACE FUNCTION is_my_player(p_player_id UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM players WHERE id = p_player_id AND auth_user_id = auth.uid())
$$;
DROP POLICY IF EXISTS notifications_select ON notifications;
CREATE POLICY notifications_select ON notifications FOR SELECT TO authenticated USING (is_my_player(player_id));

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE poll_guests;   EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE notifications; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
