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

## Actualización v1.4 · Invitados, edición de partidos y avisos

### Pasos
1. **Supabase → SQL Editor**: ejecuta `supabase/06_migracion_v1.4.sql` (no borra datos, se puede repetir,
   y la versión v1.3 sigue funcionando con la base migrada).
2. Despliega. No hay variables de entorno nuevas.

### Qué hay de nuevo
- **Registro**: además del nombre, es obligatorio un **apellido o apodo**. El nombre visible se forma solo
  (`players.display_name`): “Carlos M.” o “Carlos 'El Mago'”. No puede haber dos iguales en un mismo grupo
  (se comprueba al unirse, al añadir jugadores y al editar perfiles). Quien ya tenía cuenta ve un aviso para completarlo.
- **Tras registrarse** ya no se queda en el formulario: pantalla “Revisa tu correo” (con botón para reenviar).
  Si venía de una invitación, la invitación queda guardada en el navegador y al confirmar el email entra al grupo.
- **Invitados externos**: el admin puede “+ Añadir invitado” en una encuesta (nombre, estrellas, portero).
  Cuentan para el cupo y pasan al partido con “Crear Partido con Confirmados”. En el partido se guardan en
  `match_players` con `player_id` NULL e `is_guest = true` (así entran en el reparto, la alineación y el MVP).
- **Cupo desde 1** en las encuestas, pero **no se puede crear un partido con menos de 10 jugadores**
  (aviso en rojo y botón desactivado; la API también lo rechaza).
- **Editar partido** (admin/co-admin, partidos pendientes): fecha, lugar, notas, modalidad, añadir/quitar
  miembros e invitados, mover entre Equipo A/B, titular/suplente, estrellas para ese partido y botón
  **Re-equilibrar**. Al guardar se publica un resumen en el chat (“⚠️ El admin ha actualizado el partido…”)
  y se avisa a los convocados (también a los que salen).
- **Avisos**: badge con los mensajes sin leer en la pestaña Chat (se pone a 0 al abrirlo), punto en
  Partidos y etiqueta “Nuevo” en los partidos nuevos o modificados, y **campana** con el historial de avisos
  (nuevas encuestas, partidos nuevos y cambios) y “Marcar todas como leídas”. Las lecturas se guardan en
  `group_players.last_read_chat_at` / `last_seen_matches_at`, así cuadran entre dispositivos.
- **Copiar para WhatsApp**: la convocatoria con emojis, equipos, suplentes e invitados.

> Push: los avisos se envían también a `lib/push.ts`, pero sigue sin proveedor conectado (FCM o Expo),
> así que de momento son avisos dentro de la app (campana y badges).

### Endpoints nuevos
| Método | Ruta | Permiso |
|---|---|---|
| POST | `/api/groups/:groupId/read` | miembro (`{ what: 'chat' \| 'matches' }`) |
| POST | `/api/polls/:pollId/guests` | admin·co-admin (`{ name, stars?, pos? }`) |
| DELETE | `/api/polls/:pollId/guests/:guestId` | admin·co-admin |
| PUT | `/api/matches/:id` | admin·co-admin (edición completa) |
| POST | `/api/matches/:id/rebalance` | admin·co-admin (propuesta sin guardar) |
| POST | `/api/matches/seen` | sesión |
| GET | `/api/notifications` | sesión |
| POST | `/api/notifications/read` | sesión (`{ all: true }` o `{ ids }`) |

## Actualización v1.5 · Notificaciones push en el móvil

### Pasos
1. **Supabase → SQL Editor**: ejecuta `supabase/07_migracion_v1.5_push.sql`.
2. Variables en Vercel (ya creadas): `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` (secreta), `VAPID_SUBJECT`.
   Si algún día cambias las claves VAPID, todos los usuarios tendrán que volver a activar las notificaciones.

### Cómo funciona
- **Web Push** (sin Firebase ni app nativa): `public/sw.js` recibe la notificación aunque la app esté cerrada,
  la muestra en la pantalla de bloqueo y al tocarla abre el partido o el chat.
- **Android / ordenador**: Perfil → “Activar notificaciones” (o el aviso de la pestaña Partidos).
- **iPhone (iOS 16.4+)**: primero Safari → Compartir → “Añadir a pantalla de inicio”, abrir la app desde ese icono
  y activar las notificaciones. La app muestra estos pasos a quien entra desde iPhone.
- Cada usuario puede tener varios dispositivos (`push_subscriptions`) y elegir qué recibe: partidos nuevos y
  cambios, encuestas nuevas y mensajes del chat (`players.notify_*`). Los mensajes de un mismo grupo se agrupan en
  una sola notificación que se va actualizando.
- Al acabar un partido, el admin y los co-admins reciben “🏁 Partido finalizado” para registrar resultado y MVP.

| Método | Ruta | Para qué |
|---|---|---|
| POST / DELETE | `/api/push/subscribe` | Guardar / quitar este dispositivo |
| POST | `/api/push/test` | Notificación de prueba a tus dispositivos |
| PATCH | `/api/me` | `notifyChat`, `notifyPolls`, `notifyMatches` |

## Actualización v1.6 · Encuestas completas, quórum, fotos y nuevos desplegables

### Pasos
1. **Supabase → SQL Editor**: ejecuta `supabase/08_migracion_v1.6.sql` **antes de fusionar**. Crea el bucket
   público `avatars` de Storage con sus políticas (cada uno solo sube a su carpeta; el escudo, solo admin y co-admins).
2. Sin variables nuevas.

### Qué hay de nuevo
- **Resultado**: los marcadores se pueden borrar del todo (ya no obliga a escribir “01”), botones − / + y no deja
  guardar si falta alguno (la API también lo rechaza).
- **Encuestas solo para admin y co-admins** (botón oculto al resto; la API devuelve 403).
- **Encuesta completa**: modalidad (cupo sugerido 10 / 14 / 22), lugar y notas/precio. Con “Crear Partido con
  Confirmados” pasan solos al partido junto con la fecha, los confirmados y los invitados.
- **Avisos nuevos**: “👋 X se ha unido al grupo” (por enlace o añadido por el admin) y “⚽ ¡Ya somos 10 para Fútbol
  Sala!” al alcanzar el mínimo de la modalidad (10 / 14 / 22), una sola vez por encuesta (`polls.quorum_notified`).
- **Fotos** (Supabase Storage): foto de perfil (Mi perfil) y escudo del grupo (Plantilla, admin/co-admin), con vista
  previa circular; se recortan y comprimen a 400×400 en el móvil antes de subirlas. Sin foto: iniciales / escudo de color.
- **Invitación compacta**: barra con el enlace, “Copiar” (→ “¡Copiado!”) y compartir (menú del móvil o WhatsApp).
- **Desplegables propios** en lugar de los `<select>` del navegador (grupo, estrellas, MVP, jugador…) y control
  segmentado con pastilla deslizante.
- **Barra de progreso** en la encuesta hacia el mínimo de la modalidad; se pone verde al alcanzarlo.

## v1.7 · Limpieza visual y navegación

Sin cambios de base de datos ni variables nuevas: solo interfaz.

- **Barra inferior de 4 pestañas**: Partidos (Próximos / Historial), Chat, Plantilla (Jugadores / Estadísticas) y Perfil.
- **Cabecera mínima**: selector del grupo activo con su escudo a la izquierda y campana a la derecha.
- **Perfil** como pestaña propia: foto, nombre, apellido/apodo (obligatorio uno), posición, nivel, tema Oscuro/Claro, notificaciones y cerrar sesión.
- **Plantilla depurada**: buscador, filtros, invitación compacta; el escudo y el nombre se editan en ⋯ → *Editar grupo* (junto con salir / eliminar).
- **Modo claro** (se recuerda por dispositivo, sin parpadeo al cargar).
- Esqueletos de carga, estados vacíos con una acción, toasts arriba (2,5 s) y respuesta táctil al pulsar.
