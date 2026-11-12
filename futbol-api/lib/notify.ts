import type { Db } from './queries';
import { sendPush } from './push';

export type NotifType = 'chat' | 'poll' | 'match_created' | 'match_updated';

/**
 * Avisos a los miembros de un grupo:
 *  - fila en `notifications` (campana in-app, en tiempo real) salvo para mensajes de chat,
 *    que se cuentan con el badge de "no leídos" para no llenar la campana
 *  - push al dispositivo de quien tenga token (/api/push-token). OJO: lib/push.ts sigue sin
 *    proveedor real conectado, así que de momento el push solo queda registrado en los logs.
 * Solo se avisa a jugadores con cuenta y nunca a quien provoca el aviso.
 */
export async function notify(
  db: Db,
  opts: {
    groupId: string;
    type: NotifType;
    title: string;
    body: string;
    data?: Record<string, string>;
    recipients: 'members' | string[];
    exclude?: string;
  }
) {
  const ids = opts.recipients === 'members' ? null : opts.recipients;
  const { rows } = await db.query(
    `SELECT p.id, p.push_token AS "pushToken"
       FROM group_players gp JOIN players p ON p.id = gp.player_id
      WHERE gp.group_id = $1 AND gp.is_active AND p.is_active AND p.auth_user_id IS NOT NULL
        AND ($2::uuid[] IS NULL OR p.id = ANY($2::uuid[]))
        AND ($3::uuid IS NULL OR p.id <> $3)`,
    [opts.groupId, ids, opts.exclude ?? null]
  );
  if (!rows.length) return 0;

  if (opts.type !== 'chat') {
    await db.query(
      `INSERT INTO notifications (player_id, group_id, type, title, body, data)
       SELECT unnest($1::uuid[]), $2, $3, $4, $5, $6`,
      [rows.map((r) => r.id), opts.groupId, opts.type, opts.title, opts.body, JSON.stringify(opts.data ?? {})]
    );
  }
  const data = { type: opts.type, groupId: opts.groupId, ...(opts.data ?? {}) };
  await Promise.all(
    rows.filter((r) => r.pushToken).map((r) => sendPush(r.pushToken, opts.title, opts.body, data).catch(() => false))
  );
  return rows.length;
}
