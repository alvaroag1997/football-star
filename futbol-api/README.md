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
   `DATABASE_URL`, `ADMIN_API_KEY`, `ADMIN_ID`, `CRON_SECRET`.
4. Deploy. Prueba: `GET https://TU-PROYECTO.vercel.app/api/groups` con la
   cabecera `x-api-key: <tu ADMIN_API_KEY>`.

También con la CLI: `npm i && npx vercel --prod`.

### 3. Cron cada minuto
Vercel Hobby solo permite crons diarios (`vercel.json` deja uno de seguridad).
Para el minuto a minuto usa Supabase: edita y ejecuta `supabase/03_cron.sql`
con tu URL de Vercel y tu `CRON_SECRET`.
Aunque el cron falle, `GET /api/matches` y `GET /api/history` también pasan a
"Finalizado" los partidos vencidos, así que el estado nunca queda desfasado.

## Endpoints (cabecera `x-api-key` en todos menos el cron)

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
