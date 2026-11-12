import type { Db } from './queries';
import { pushToPlayers } from './push';

export type NotifType = 'chat' | 'poll' | 'match_created' | 'match_updated' | 'member_joined' | 'quorum';

/**
 * Avisos a los miembros de un grupo:
 *  - fila en `notifications` (campana in-app, en tiempo real), salvo los mensajes de chat,
 *    que se cuentan con el badge de "no leídos" para no llenar la campana
 *  - notificación push en sus dispositivos (como WhatsApp), según lo que cada uno haya
 *    elegido en su perfil (notify_chat / notify_polls / notify_matches)
 * Solo a jugadores con cuenta y nunca a quien provoca el aviso.
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
    `SELECT p.id,
            CASE $4 WHEN 'chat' THEN p.notify_chat
                    WHEN 'poll' THEN p.notify_polls WHEN 'member_joined' THEN p.notify_polls
                    ELSE p.notify_matches END AS "wantsPush"
       FROM group_players gp JOIN players p ON p.id = gp.player_id
      WHERE gp.group_id = $1 AND gp.is_active AND p.is_active AND p.auth_user_id IS NOT NULL
        AND ($2::uuid[] IS NULL OR p.id = ANY($2::uuid[]))
        AND ($3::uuid IS NULL OR p.id <> $3)`,
    [opts.groupId, ids, opts.exclude ?? null, opts.type]
  );
  if (!rows.length) return 0;

  if (opts.type !== 'chat') {
    await db.query(
      `INSERT INTO notifications (player_id, group_id, type, title, body, data)
       SELECT unnest($1::uuid[]), $2, $3, $4, $5, $6`,
      [rows.map((r) => r.id), opts.groupId, opts.type, opts.title, opts.body, JSON.stringify(opts.data ?? {})]
    );
  }

  const matchId = opts.data?.matchId;
  const url = matchId ? `/?match=${matchId}` : `/?group=${opts.groupId}&tab=chat`;
  const tag = opts.type === 'chat' ? `chat-${opts.groupId}` : matchId ? `match-${matchId}` : `${opts.type}-${opts.data?.pollId ?? opts.groupId}`;
  try {
    await pushToPlayers(db, rows.filter((r) => r.wantsPush).map((r) => r.id), { title: opts.title, body: opts.body, url, tag });
  } catch (e) {
    console.error('[push] fallo al enviar', e); // un fallo de push nunca debe romper la acción principal
  }
  return rows.length;
}
