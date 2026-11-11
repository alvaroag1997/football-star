-- =====================================================================
-- Esquema relacional v1.2 (PostgreSQL)
-- Novedades: multigrupo, soft delete, snapshots de jugadores en partidos,
-- ciclo de vida del partido, MVP y resultado.
-- =====================================================================

CREATE TYPE match_status AS ENUM ('pending', 'finished', 'cancelled');
CREATE TYPE team_side    AS ENUM ('A', 'B');

-- ---------------------------------------------------------------------
-- Administradores
-- ---------------------------------------------------------------------
CREATE TABLE admins (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email        TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  push_token   TEXT,                       -- FCM/APNs para la notificación de fin de partido
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- GRUPOS (multigrupo): "Fútbol Jueves", "Liga de Verano", ...
-- ---------------------------------------------------------------------
CREATE TABLE groups (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   UUID NOT NULL REFERENCES admins(id),
  name       TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,   -- soft delete también para grupos
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (admin_id, name)
);

-- ---------------------------------------------------------------------
-- JUGADORES: identidad de la persona (única, reutilizable entre grupos)
-- ---------------------------------------------------------------------
CREATE TABLE players (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id   UUID NOT NULL REFERENCES admins(id),
  name       TEXT NOT NULL,
  photo_url  TEXT,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,   -- SOFT DELETE: nunca se hace DELETE físico
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- MEMBRESÍA jugador <-> grupo (N:M). Las estrellas viven aquí, así un
-- mismo jugador puede tener nivel distinto en cada grupo si se desea.
-- ---------------------------------------------------------------------
CREATE TABLE group_players (
  group_id   UUID NOT NULL REFERENCES groups(id),
  player_id  UUID NOT NULL REFERENCES players(id),
  stars      NUMERIC(3,1) NOT NULL CHECK (stars BETWEEN 0 AND 10),
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,   -- salir del grupo = false, no borrar
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  left_at    TIMESTAMPTZ,
  PRIMARY KEY (group_id, player_id)
);
CREATE INDEX idx_group_players_active ON group_players (group_id) WHERE is_active;

-- ---------------------------------------------------------------------
-- PARTIDOS
-- ---------------------------------------------------------------------
CREATE TABLE matches (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id           UUID NOT NULL REFERENCES groups(id),
  scheduled_at       TIMESTAMPTZ NOT NULL,
  location           TEXT,
  format             TEXT NOT NULL,            -- '5v5' | '7v7' | '11v11' (modalidad base)
  starters_per_side  SMALLINT NOT NULL,        -- 5, 7 u 11: titulares por equipo
  status             match_status NOT NULL DEFAULT 'pending',
  finished_at        TIMESTAMPTZ,              -- cuándo pasó a 'finished'
  cancelled_at       TIMESTAMPTZ,
  score_a            SMALLINT,                 -- NULL hasta que se registre
  score_b            SMALLINT,
  mvp_entry_id       UUID,                     -- FK a match_players (se añade abajo)
  result_notified_at TIMESTAMPTZ,              -- idempotencia de la notificación
  -- Estadísticas del balanceo guardadas para mostrarlas en el historial
  balance_stats      JSONB,                    -- {sumA, sumB, meanA, meanB, diffSum, diffMean}
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (status <> 'finished'  OR finished_at  IS NOT NULL),
  CHECK (status <> 'cancelled' OR cancelled_at IS NOT NULL)
);
CREATE INDEX idx_matches_group_status ON matches (group_id, status, scheduled_at DESC);
-- Para el job automático: partidos pendientes ya vencidos
CREATE INDEX idx_matches_due ON matches (scheduled_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------
-- CONVOCATORIA DEL PARTIDO = SNAPSHOT del jugador en ese momento.
-- Se copian nombre, estrellas y foto: el historial NO depende de que el
-- jugador siga existiendo ni de que cambie de nivel después.
-- player_id es solo una referencia "blanda" (SET NULL por si algún día
-- se purga físicamente al jugador).
-- ---------------------------------------------------------------------
CREATE TABLE match_players (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id        UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id       UUID REFERENCES players(id) ON DELETE SET NULL,
  -- ---- snapshot ----
  name_snapshot   TEXT NOT NULL,
  stars_snapshot  NUMERIC(3,1) NOT NULL,
  photo_snapshot  TEXT,
  -- ---- asignación ----
  team            team_side NOT NULL,
  is_starter      BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE = suplente (banquillo)
  UNIQUE (match_id, player_id)
);
CREATE INDEX idx_match_players_match ON match_players (match_id, team);

ALTER TABLE matches
  ADD CONSTRAINT fk_matches_mvp
  FOREIGN KEY (mvp_entry_id) REFERENCES match_players(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------
-- VOTOS AL MVP (un voto por votante y partido)
-- Si solo vota el admin, basta con matches.mvp_entry_id; esta tabla permite
-- ampliarlo a votación de los jugadores sin cambiar el modelo.
-- ---------------------------------------------------------------------
CREATE TABLE mvp_votes (
  match_id         UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  voter_entry_id   UUID NOT NULL REFERENCES match_players(id) ON DELETE CASCADE,
  voted_entry_id   UUID NOT NULL REFERENCES match_players(id) ON DELETE CASCADE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, voter_entry_id),
  CHECK (voter_entry_id <> voted_entry_id)
);

-- =====================================================================
-- CICLO DE VIDA
-- =====================================================================

-- Transición automática pending -> finished (ejecutar cada minuto con pg_cron,
-- Cloud Scheduler o un cron del backend). Devuelve los partidos recién
-- finalizados para disparar la notificación push.
-- Es idempotente: solo toca partidos 'pending' ya vencidos.
CREATE OR REPLACE FUNCTION finish_due_matches() RETURNS SETOF matches AS $$
  UPDATE matches
     SET status = 'finished', finished_at = now()
   WHERE status = 'pending' AND scheduled_at <= now()
  RETURNING *;
$$ LANGUAGE sql;

-- Notificación: tras finish_due_matches(), el backend envía a admins.push_token:
--   "El partido ya se ha jugado. ¡Vota al MVP y registra el resultado!"
-- y marca matches.result_notified_at = now() para no repetirla.

-- Cancelar/eliminar: solo permitido si está pendiente.
--   UPDATE matches SET status='cancelled', cancelled_at=now()
--    WHERE id = $1 AND status = 'pending';          -- 0 filas = no se puede
-- (Cancelar es un soft delete; si se prefiere borrado físico:
--   DELETE FROM matches WHERE id = $1 AND status = 'pending';
--  match_players cae en cascada.)

-- Registrar resultado y MVP (solo partidos finalizados):
--   UPDATE matches SET score_a=$2, score_b=$3, mvp_entry_id=$4
--    WHERE id=$1 AND status='finished';

-- =====================================================================
-- CONSULTAS CLAVE
-- =====================================================================

-- Vista principal: solo pendientes
--   SELECT * FROM matches WHERE status='pending' AND group_id=$1 ORDER BY scheduled_at;

-- Pestaña Historial: finalizados con equipos, resultado y MVP (todo desde snapshots)
--   SELECT m.*, mp.name_snapshot AS mvp_name, mp.photo_snapshot AS mvp_photo
--     FROM matches m LEFT JOIN match_players mp ON mp.id = m.mvp_entry_id
--    WHERE m.status='finished' ORDER BY m.scheduled_at DESC;

-- Selector de jugadores al crear partido: solo los del grupo elegido
--   SELECT p.id, p.name, p.photo_url, gp.stars
--     FROM group_players gp JOIN players p ON p.id = gp.player_id
--    WHERE gp.group_id = $1 AND gp.is_active AND p.is_active
--    ORDER BY p.name;

-- Al guardar un partido, el backend copia por cada convocado (en una transacción):
--   INSERT INTO match_players (match_id, player_id, name_snapshot, stars_snapshot,
--                              photo_snapshot, team, is_starter)
--   SELECT $match, p.id, p.name, gp.stars, p.photo_url, $team, $is_starter
--     FROM group_players gp JOIN players p ON p.id = gp.player_id
--    WHERE gp.group_id = $group AND p.id = $player;
