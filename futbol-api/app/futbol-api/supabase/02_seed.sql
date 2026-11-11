-- Ejecuta esto UNA vez, tras 01_schema.sql, cambiando el email y el nombre.
-- Copia el id devuelto a la variable de entorno ADMIN_ID de Vercel.
INSERT INTO admins (email, display_name)
VALUES ('tu-email@ejemplo.com', 'Admin')
RETURNING id;
