-- =====================================================================
-- Migración v1.6: encuestas completas, quórum, fotos (Supabase Storage)
-- EJECUTAR UNA VEZ en Supabase (SQL Editor) ANTES de fusionar el código v1.6.
-- No borra datos. Es seguro repetirlo. La v1.5 sigue funcionando con la base migrada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ENCUESTAS: lugar, notas/precio y aviso de quórum (una sola vez)
--    (polls.format ya existía desde la v1.3)
-- ---------------------------------------------------------------------
ALTER TABLE polls ADD COLUMN IF NOT EXISTS location        TEXT;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS notes           TEXT;
ALTER TABLE polls ADD COLUMN IF NOT EXISTS quorum_notified BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_location_len;
ALTER TABLE polls ADD CONSTRAINT polls_location_len CHECK (location IS NULL OR char_length(location) <= 200);
ALTER TABLE polls DROP CONSTRAINT IF EXISTS polls_notes_len;
ALTER TABLE polls ADD CONSTRAINT polls_notes_len CHECK (notes IS NULL OR char_length(notes) <= 500);

-- ---------------------------------------------------------------------
-- 2. FOTOS: escudo del grupo (la foto de perfil ya existe: players.photo_url)
-- ---------------------------------------------------------------------
ALTER TABLE groups ADD COLUMN IF NOT EXISTS icon_url TEXT;

-- ---------------------------------------------------------------------
-- 3. NUEVOS TIPOS DE AVISO: nuevo miembro y quórum alcanzado
-- ---------------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('chat', 'poll', 'match_created', 'match_updated', 'member_joined', 'quorum'));

-- ---------------------------------------------------------------------
-- 4. SUPABASE STORAGE: bucket público "avatars" (máx. 2 MB, solo imágenes)
--    Rutas:  users/<id de la cuenta>/<archivo>   -> foto de perfil (solo su dueño)
--            groups/<id del grupo>/<archivo>     -> escudo (solo admin y co-admins)
--    Las fotos se comprimen en el navegador a 400x400 antes de subirlas.
-- ---------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', TRUE, 2097152, ARRAY['image/webp', 'image/jpeg', 'image/png'])
ON CONFLICT (id) DO UPDATE
  SET public = TRUE, file_size_limit = EXCLUDED.file_size_limit, allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE OR REPLACE FUNCTION is_group_manager(p_group_id TEXT) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_players gp JOIN players p ON p.id = gp.player_id
     WHERE gp.group_id::text = p_group_id AND gp.is_active
       AND gp.role IN ('owner', 'co_admin') AND p.auth_user_id = auth.uid()
  )
$$;

DROP POLICY IF EXISTS avatars_read         ON storage.objects;
DROP POLICY IF EXISTS avatars_user_insert  ON storage.objects;
DROP POLICY IF EXISTS avatars_user_update  ON storage.objects;
DROP POLICY IF EXISTS avatars_user_delete  ON storage.objects;
DROP POLICY IF EXISTS avatars_group_insert ON storage.objects;
DROP POLICY IF EXISTS avatars_group_update ON storage.objects;
DROP POLICY IF EXISTS avatars_group_delete ON storage.objects;

-- Lectura pública (son fotos de perfil y escudos)
CREATE POLICY avatars_read ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

-- Foto de perfil: cada uno solo en su carpeta users/<su id>/
CREATE POLICY avatars_user_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = 'users'
              AND (storage.foldername(name))[2] = auth.uid()::text);
CREATE POLICY avatars_user_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = 'users'
         AND (storage.foldername(name))[2] = auth.uid()::text);
CREATE POLICY avatars_user_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = 'users'
         AND (storage.foldername(name))[2] = auth.uid()::text);

-- Escudo del grupo: solo admin y co-admins de ese grupo, en groups/<id del grupo>/
CREATE POLICY avatars_group_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = 'groups'
              AND public.is_group_manager((storage.foldername(name))[2]));
CREATE POLICY avatars_group_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = 'groups'
         AND public.is_group_manager((storage.foldername(name))[2]));
CREATE POLICY avatars_group_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = 'groups'
         AND public.is_group_manager((storage.foldername(name))[2]));
