# Fútbol API v1.2 (Next.js + Supabase + Vercel)

Backend de la app de partidos de fútbol amateur: multigrupo, banquillo,
historial con snapshots y transición automática a "Finalizado".

## Puesta en marcha

### 1. Base de datos (Supabase)
1. Crea un proyecto en https://supabase.com.
2. SQL Editor → ejecuta `supabase/01_schema.sql`.
3. Ejecuta `supabase/02_seed.sql` (cambia el email) y **copia el `id` devuelto**.
4. Settings → Database → Connection string → **Transaction pooler** (puerto 6543).

### 2. Desplegar en Vercel
1. Sube esta carpeta a un repositorio de GitHub.
2. En https://vercel.com → Add New → Project → importa el repositorio.
3. Variables de entorno (ver `.env.example`):
   `DATABASE_URL`, `CRON_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   (desde la v1.3 ya no se usan `ADMIN_API_KEY` ni `ADMIN_ID`).
4. Deploy y abre la web: regístrate con el email que pusiste en `admins` (ver v1.3 abajo).

También con la CLI: `npm i && npx vercel --prod`.

### 3. Cron cada minuto
Vercel Hobby solo permite crons diarios (`vercel.json` deja uno de seguridad).
Para el minuto a minuto usa Supabase: edita y ejecuta `supabase/03_cron.sql`
con tu URL de Vercel y tu `CRON_SECRET`.
Aunque el cron falle, `GET /api/matches` y `GET /api/history` también pasan a
"Finalizado" los partidos vencidos, así que el estado nunca queda desfasado.

## Endpoints v1.2 (desde la v1.3 llevan `Authorization: Bearer <token de Supabase>`, ver abajo)

| Método | Ruta | Función |
|---|---|---|
| GET / POST | `/api/groups` | Listar / crear grupos (desplegable de "Crear Partido") |
| GET / POST | `/api/groups/:groupId/players` | Jugadores del grupo / añadir (`playerId` reutiliza a uno existente) |
| PATCH / DELETE | `/api/groups/:groupId/players/:playerId` | Cambiar estrellas / baja (soft delete, `?everywhere=true` para todos los grupos) |
| POST | `/api/matches/preview` | Equilibrar sin guardar (`groupId`, `format`, `playerIds`) |
| POST | `/api/matches` | Crear partido con snapshots (opcional `assignment: {A:[ids],B:[ids]}`) |
| GET | `/api/matches?groupId=&status=pending` | Vista principal (solo pendientes) |
| GET | `/api/matches/:id` | Detalle con convocatoria |
| POST | `/api/matches/:id/cancel` | Cancelar un partido pendiente |
| POST | `/api/matches/:id/result` | Resultado y MVP de un partido finalizado |
| GET | `/api/history?groupId=` | Pestaña Historial |
| POST | `/api/push-token` | Registrar token push del admin |
| GET / POST | `/api/cron/finish-matches` | Transición + notificaciones (requiere `Authorization: Bearer CRON_SECRET`) |

Ejemplo (14 jugadores en fútbol sala, 5 titulares + 2 suplentes por equipo):

```bash
curl -X POST https://TU-PROYECTO.vercel.app/api/matches \
  -H "x-api-key: $ADMIN_API_KEY" -H "content-type: application/json" \
  -d '{"groupId":"...","format":"5v5","scheduledAt":"2026-11-19T21:00:00+01:00","playerIds":["...14 ids..."]}'
```

## Pendiente
- **Notificaciones push reales:** `lib/push.ts` es un esqueleto. Conecta
  Firebase Cloud Messaging o Expo Push. Hasta entonces los partidos quedan en
  cola sin marcar como notificados, y la app puede mostrar el aviso dentro de la
  app con `needsResult: true`.
- **Login:** ahora hay una única clave de admin (`lib/auth.ts`). Se puede
  cambiar por Supabase Auth tocando solo ese archivo.
- **Votación de MVP por los jugadores:** la tabla `mvp_votes` ya existe; falta
  el endpoint.

## Interfaz (móvil, dentro del mismo proyecto)
La web está en `app/components/App.tsx` y se sirve en `/`. Al abrirla pide la
`ADMIN_API_KEY` (se guarda solo en ese navegador). Pestañas: Partidos, Historial
y Grupos; el botón "Crear partido" empieza por el desplegable de grupo.
Se refresca cada 30 s, así que un partido pasa solo a Historial al llegar su hora
y aparece el aviso "El partido ya se ha jugado. ¡Vota al MVP y registra el resultado!".

## Actualización v1.3 (interfaz Equilibrio FC)

**Antes de desplegar**, ejecuta una vez `supabase/04_migracion_v1.3.sql` en el SQL Editor de Supabase
(añade posición y apodo a jugadores y a los snapshots de los partidos).

Endpoints nuevos: `PATCH /api/matches/:id/teams`, `POST /api/matches/:id/regenerate`, `GET /api/stats?groupId=`.
La interfaz (pasos: grupo → modalidad/fecha/lugar → convocatoria → equipos con titulares y suplentes,
arrastrar y soltar, resultado y MVP, Historial, Plantilla, Estadísticas) está en `app/components/App.tsx`.

## Actualización v1.3 · Cuentas, chat y encuestas

### Pasos (en este orden)
1. **Supabase → SQL Editor**: ejecuta `supabase/05_migracion_v1.3_cuentas_chat.sql` (no borra datos, se puede repetir).
2. **Supabase → Authentication → Providers → Email**: activado. *Confirm email* a tu gusto
   (si está activo, el enlace del email hay que abrirlo en el mismo dispositivo).
3. **Supabase → Authentication → URL Configuration**: *Site URL* = `https://TU-PROYECTO.vercel.app`
   y en *Redirect URLs* añade `https://TU-PROYECTO.vercel.app/**` y `http://localhost:3000/**`.
4. **Vercel → Settings → Environment Variables**: añade `NEXT_PUBLIC_SUPABASE_URL` y
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Supabase → Project Settings → API). Puedes borrar `ADMIN_API_KEY` y `ADMIN_ID`.
5. `npm install` (añade `@supabase/supabase-js`) y despliega.
6. Abre la app y **regístrate con el mismo email que tiene tu fila en `admins`**: pasas a ser el admin
   de todos tus grupos de la v1.2. Si ya estabas en la plantilla como jugador manual, abre tu ficha en
   Plantilla → “Unir con su cuenta” y elige tu cuenta (conserva tu historial).

### Qué hay de nuevo
- **Cuentas** (Supabase Auth, email + contraseña). Cada cuenta es un jugador (`players.auth_user_id`)
  con perfil: nombre, apodo, posición y nivel (botón de perfil en Partidos).
- **Roles por grupo** (`group_players.role`): `owner` (creador: todo, borrar grupo, nombrar co-admins),
  `co_admin` (partidos, plantilla, encuestas, invitación) y `member` (chat, encuestas, ver partidos).
  Las estrellas solo las ven owner y co-admins.
- **Invitación por enlace** `/join/<token>` (Plantilla → Enlace de invitación). Se puede regenerar y
  hacer caducar. Sin cuenta: registro y entra solo al grupo.
- **Chat por grupo en tiempo real** (pestaña Chat) con **encuestas de asistencia**: Me apunto / No puedo /
  Duda, cupo opcional con **lista de espera** automática.
- **Crear Partido con Confirmados**: botón en la encuesta (admin/co-admin) que abre “Nuevo partido” con
  grupo, fecha, modalidad y convocados ya puestos. Al guardar se cierra la encuesta y sale un mensaje
  automático en el chat con el enlace al partido.
- **Fechas**: no se pueden crear partidos ni encuestas en el pasado (input `datetime-local` con `min`,
  validación en la API y trigger en la base de datos).
- **Huérfanos**: un jugador manual que se queda sin grupos se desactiva y deja de salir en
  “Añadir jugador de otro grupo”, que ahora solo muestra jugadores activos de tus otros grupos.
- **Eliminar grupo** (solo el creador, escribiendo el nombre): borra en cascada chat, encuestas,
  partidos (también su historial) y miembros.
- **Seguridad**: RLS activado en todas las tablas; el navegador solo puede *leer* el chat y las
  encuestas de sus grupos (para el tiempo real). Todo lo demás pasa por `/api`.

### Endpoints nuevos
| Método | Ruta | Permiso |
|---|---|---|
| GET / PATCH | `/api/me` | sesión |
| GET / PATCH / DELETE | `/api/groups/:groupId` | miembro / admin·co-admin / owner |
| POST | `/api/groups/:groupId/invite` | admin·co-admin (`{ expiresInDays: 1-30 \| null }`) |
| GET | `/api/invites/:token` | pública |
| POST | `/api/invites/:token/accept` | sesión |
| PATCH | `/api/groups/:groupId/players/:playerId/role` | owner (`{ role: 'co_admin' \| 'member' }`) |
| POST | `/api/groups/:groupId/players/:playerId/merge` | admin·co-admin (`{ intoPlayerId }`) |
| GET | `/api/players?groupId=` | admin·co-admin (sugerencias de otros grupos) |
| GET / POST | `/api/groups/:groupId/messages` | miembro |
| POST | `/api/groups/:groupId/polls` | miembro (`{ question, matchAt, format?, maxSlots? }`) |
| GET | `/api/polls/:pollId` | miembro |
| POST | `/api/polls/:pollId/vote` | miembro (`{ choice: 'yes' \| 'no' \| 'maybe' }`) |
| POST | `/api/polls/:pollId/close` | admin·co-admin (`{ reopen?: true }`) |

`POST /api/matches` acepta además `pollId`. Crear, cancelar, regenerar, mover equipos y registrar
resultado requieren ser owner o co-admin del grupo.
