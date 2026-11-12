-- =====================================================================
-- Migración: cuentas de usuario, roles, invitaciones, chat y encuestas
-- EJECUTAR UNA VEZ en Supabase (SQL Editor), DESPUÉS de 01_schema.sql y
-- 04_migracion_v1.3.sql, y ANTES de desplegar el código nuevo.
-- No borra datos. Es seguro repetirlo.
--
-- Qué hace:
--   1. Vincula cada jugador (players) con una cuenta de Supabase Auth (opcional:
--      los jugadores "manuales" siguen sin cuenta).
--   2. Roles por grupo en group_players: owner / co_admin / member.
--   3. Enlace de invitación por grupo (token regenerable con caducidad opcional).
--   4. Chat por grupo + encuestas de asistencia con cupo y lista de espera.
--   5. Borrado de grupo en cascada (miembros, partidos, chat, encuestas).
--   6. Fecha futura obligatoria en partidos y encuestas (trigger).
--   7. Limpieza de jugadores huérfanos y fusión jugador manual → cuenta.
--   8. RLS en TODAS las tablas: la clave pública (anon) ya va en el navegador,
--      así que nadie puede leer/escribir por la API REST de Supabase. El backend
--      usa DATABASE_URL (rol postgres) y no se ve afectado.
--
-- Tus grupos actuales: al iniciar sesión por primera vez con el MISMO email que
-- tienes en la tabla admins, pasas a ser owner de todos ellos automáticamente.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. JUGADORES ↔ CUENTAS
-- ---------------------------------------------------------------------
ALTER TABLE players ADD COLUMN IF NOT EXISTS auth_user_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE players ADD COLUMN IF NOT EXISTS email        TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS level        NUMERIC(2,1) NOT NULL DEFAULT 3;   -- nivel que declara el propio jugador (1-5)
ALTER TABLE players ADD COLUMN IF NOT EXISTS push_token   TEXT;
ALTER TABLE players ADD COLUMN IF NOT EXISTS created_by   UUID REFERENCES players(id) ON DELETE SET NULL;
ALTER TABLE players ALTER COLUMN admin_id DROP NOT NULL;                                  -- legado v1.2
ALTER TABLE players DROP CONSTRAINT IF EXISTS players_level_check;
ALTER TABLE players ADD CONSTRAINT players_level_check CHECK (level BETWEEN 1 AND 5);

ALTER TABLE admins ADD COLUMN IF NOT EXISTS claimed_player_id UUID REFERENCES players(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- 2. GRUPOS: creador + invitación
-- ---------------------------------------------------------------------
ALTER TABLE groups ALTER COLUMN admin_id DROP NOT NULL;                                   -- legado v1.2
ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_admin_id_name_key;                    -- dos usuarios pueden tener "Fútbol Jueves"
ALTER TABLE groups ADD COLUMN IF NOT EXISTS created_by        UUID REFERENCES players(id) ON DELETE SET NULL;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS invite_token      UUID NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE groups ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ;               -- NULL = no caduca
CREATE UNIQUE INDEX IF NOT EXISTS uq_groups_invite_token ON groups (invite_token);

-- ---------------------------------------------------------------------
-- 3. ROLES (RBAC) en la membresía
-- ---------------------------------------------------------------------
ALTER TABLE group_players ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE group_players DROP CONSTRAINT IF EXISTS group_players_role_check;
ALTER TABLE group_players ADD CONSTRAINT group_players_role_check CHECK (role IN ('owner', 'co_admin', 'member'));
CREATE UNIQUE INDEX IF NOT EXISTS uq_group_owner ON group_players (group_id) WHERE role = 'owner';
CREATE INDEX IF NOT EXISTS idx_group_players_player ON group_players (player_id) WHERE is_active;

-- ---------------------------------------------------------------------
-- 4. BORRADO EN CASCADA desde groups
--    groups → group_players, matches (→ match_players, mvp_votes), polls, poll_votes, chat_messages
-- ---------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname, conrelid::regclass AS tbl
      FROM pg_constraint
     WHERE contype = 'f'
       AND confrelid = 'public.groups'::regclass
       AND conrelid IN ('public.group_players'::regclass, 'public.matches'::regclass)
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
  END LOOP;
END $$;
ALTER TABLE group_players ADD CONSTRAINT group_players_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;
ALTER TABLE matches ADD CONSTRAINT matches_group_id_fkey
  FOREIGN KEY (group_id) REFERENCES groups(id) ON DELETE CASCADE;

-- Aviso automático en el chat cuando un partido pasa a "Finalizado" (una vez por partido).
-- Los partidos que ya estaban finalizados se marcan como avisados para no llenar el chat.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS chat_notified_at TIMESTAMPTZ;
UPDATE matches SET chat_notified_at = now() WHERE status = 'finished' AND chat_notified_at IS NULL;

-- ---------------------------------------------------------------------
-- 5. FECHA FUTURA OBLIGATORIA (además de la validación del backend y del input)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION validate_match_schedule() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at) AND NEW.scheduled_at <= now() THEN
    RAISE EXCEPTION 'scheduled_at must be in the future' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_matches_future ON matches;
CREATE TRIGGER trg_matches_future BEFORE INSERT OR UPDATE OF scheduled_at ON matches
  FOR EACH ROW EXECUTE FUNCTION validate_match_schedule();

-- ---------------------------------------------------------------------
-- 6. ENCUESTAS DE ASISTENCIA
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS polls (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  created_by UUID REFERENCES players(id) ON DELETE SET NULL,
  question   TEXT NOT NULL CHECK (char_length(question) BETWEEN 1 AND 200),
  match_at   TIMESTAMPTZ NOT NULL,
  format     TEXT,                                        -- '5v5' | '7v7' | '11v11' (opcional)
  max_slots  INT CHECK (max_slots BETWEEN 2 AND 60),      -- NULL = sin cupo
  status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  match_id   UUID REFERENCES matches(id) ON DELETE SET NULL,  -- partido creado desde la encuesta
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_polls_group ON polls (group_id);

CREATE OR REPLACE FUNCTION validate_poll_date() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.match_at <= now() THEN
    RAISE EXCEPTION 'match_at must be in the future' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_polls_future ON polls;
CREATE TRIGGER trg_polls_future BEFORE INSERT ON polls FOR EACH ROW EXECUTE FUNCTION validate_poll_date();

CREATE TABLE IF NOT EXISTS poll_votes (
  poll_id    UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,  -- copiado de la encuesta (filtro de Realtime)
  player_id  UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  choice     TEXT NOT NULL CHECK (choice IN ('yes', 'no', 'maybe')),
  voted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),   -- orden de llegada: cupo y lista de espera
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (poll_id, player_id)
);
CREATE INDEX IF NOT EXISTS idx_poll_votes_group ON poll_votes (group_id);

-- voted_at solo cambia si cambia el voto: quien pasa a "Me apunto" entra al final de la cola
CREATE OR REPLACE FUNCTION poll_votes_before_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT group_id INTO NEW.group_id FROM polls WHERE id = NEW.poll_id;
    NEW.voted_at := now();
  ELSIF NEW.choice IS DISTINCT FROM OLD.choice THEN
    NEW.voted_at := now();
  ELSE
    NEW.voted_at := OLD.voted_at;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_poll_votes ON poll_votes;
CREATE TRIGGER trg_poll_votes BEFORE INSERT OR UPDATE ON poll_votes
  FOR EACH ROW EXECUTE FUNCTION poll_votes_before_write();

-- ---------------------------------------------------------------------
-- 7. CHAT DEL GRUPO
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  player_id  UUID REFERENCES players(id) ON DELETE SET NULL,   -- NULL en mensajes del sistema
  type       TEXT NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'poll', 'system')),
  content    TEXT NOT NULL DEFAULT '' CHECK (char_length(content) <= 2000),
  poll_id    UUID REFERENCES polls(id) ON DELETE CASCADE,
  metadata   JSONB NOT NULL DEFAULT '{}'::jsonb,                -- p. ej. {"matchId": "..."}
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_group ON chat_messages (group_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 8. JUGADORES HUÉRFANOS Y FUSIÓN
-- ---------------------------------------------------------------------
-- Un jugador manual (sin cuenta) que ya no está activo en ningún grupo activo
-- se desactiva: desaparece de las sugerencias pero el historial lo conserva.
CREATE OR REPLACE FUNCTION deactivate_orphans(p_ids UUID[]) RETURNS int LANGUAGE sql AS $$
  WITH d AS (
    UPDATE players p SET is_active = FALSE, deleted_at = now()
     WHERE p.id = ANY(p_ids) AND p.is_active AND p.auth_user_id IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM group_players gp JOIN groups g ON g.id = gp.group_id
          WHERE gp.player_id = p.id AND gp.is_active AND g.is_active)
    RETURNING 1)
  SELECT count(*)::int FROM d;
$$;

-- Une un jugador manual con la cuenta de esa misma persona: pasa su historial,
-- sus grupos (con sus estrellas) y sus votos a la cuenta, y desactiva el manual.
CREATE OR REPLACE FUNCTION merge_players(p_from UUID, p_into UUID) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_from = p_into THEN RAISE EXCEPTION 'merge_same_player' USING ERRCODE = '22023'; END IF;

  UPDATE match_players mp SET player_id = p_into
   WHERE mp.player_id = p_from
     AND NOT EXISTS (SELECT 1 FROM match_players x WHERE x.match_id = mp.match_id AND x.player_id = p_into);

  INSERT INTO group_players (group_id, player_id, stars, is_active, joined_at, left_at, role)
  SELECT group_id, p_into, stars, is_active, joined_at, left_at, 'member'
    FROM group_players WHERE player_id = p_from
  ON CONFLICT (group_id, player_id) DO UPDATE
     SET stars     = EXCLUDED.stars,
         is_active = group_players.is_active OR EXCLUDED.is_active,
         left_at   = CASE WHEN group_players.is_active OR EXCLUDED.is_active THEN NULL ELSE group_players.left_at END;
  UPDATE group_players SET is_active = FALSE, left_at = now() WHERE player_id = p_from AND is_active;

  UPDATE poll_votes v SET player_id = p_into
   WHERE v.player_id = p_from
     AND NOT EXISTS (SELECT 1 FROM poll_votes x WHERE x.poll_id = v.poll_id AND x.player_id = p_into);

  UPDATE players i
     SET nick = COALESCE(i.nick, f.nick), pos = f.pos, photo_url = COALESCE(i.photo_url, f.photo_url)
    FROM players f
   WHERE i.id = p_into AND f.id = p_from;
  UPDATE players SET is_active = FALSE, deleted_at = now() WHERE id = p_from;
END $$;

-- Limpieza única de los huérfanos que dejó el bug de la v1.2
SELECT deactivate_orphans(ARRAY(SELECT id FROM players WHERE auth_user_id IS NULL AND is_active));

-- ---------------------------------------------------------------------
-- 9. RLS — lectura para miembros (necesaria para Supabase Realtime)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_group_member(p_group_id UUID) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_players gp JOIN players p ON p.id = gp.player_id
     WHERE gp.group_id = p_group_id AND gp.is_active AND p.auth_user_id = auth.uid()
  )
$$;

ALTER TABLE admins        ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups        ENABLE ROW LEVEL SECURITY;
ALTER TABLE players       ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches       ENABLE ROW LEVEL SECURITY;
ALTER TABLE match_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE mvp_votes     ENABLE ROW LEVEL SECURITY;
ALTER TABLE polls         ENABLE ROW LEVEL SECURITY;
ALTER TABLE poll_votes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;

-- Solo SELECT y solo en las tablas que escucha el chat. Sin políticas de escritura:
-- todo se escribe a través de la API (DATABASE_URL).
DROP POLICY IF EXISTS chat_select ON chat_messages;
CREATE POLICY chat_select ON chat_messages FOR SELECT TO authenticated USING (is_group_member(group_id));
DROP POLICY IF EXISTS polls_select ON polls;
CREATE POLICY polls_select ON polls FOR SELECT TO authenticated USING (is_group_member(group_id));
DROP POLICY IF EXISTS poll_votes_select ON poll_votes;
CREATE POLICY poll_votes_select ON poll_votes FOR SELECT TO authenticated USING (is_group_member(group_id));

REVOKE EXECUTE ON FUNCTION deactivate_orphans(UUID[])   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION merge_players(UUID, UUID)    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION finish_due_matches()         FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- 10. REALTIME
-- ---------------------------------------------------------------------
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE poll_votes;    EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE polls;         EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;
