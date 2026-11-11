-- EJECUTAR UNA VEZ en Supabase (SQL Editor) ANTES de desplegar la nueva interfaz.
-- Añade posiciones (portero/defensa/atacante) y apodos a los jugadores y los congela
-- también en el snapshot de cada partido. Es seguro repetirlo: no duplica nada.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS pos  TEXT NOT NULL DEFAULT 'DEF',
  ADD COLUMN IF NOT EXISTS nick TEXT;

ALTER TABLE players DROP CONSTRAINT IF EXISTS players_pos_check;
ALTER TABLE players ADD CONSTRAINT players_pos_check CHECK (pos IN ('GK', 'DEF', 'ATT'));

ALTER TABLE match_players
  ADD COLUMN IF NOT EXISTS pos_snapshot  TEXT NOT NULL DEFAULT 'DEF',
  ADD COLUMN IF NOT EXISTS nick_snapshot TEXT;
