import type { Db } from './queries';

export type Choice = 'yes' | 'no' | 'maybe';
type VoteRow = { pollId: string; playerId: string; choice: Choice; votedAt: string; name: string; nick: string | null; pos: string };
type PollRow = {
  id: string; groupId: string; question: string; matchAt: string; format: string | null; maxSlots: number | null;
  status: 'open' | 'closed'; matchId: string | null; createdBy: string | null; createdAt: string;
};
export type PollUser = { id: string; name: string; nick: string | null; pos: string; votedAt: string; guest?: boolean; stars?: number };
type GuestRow = { id: string; pollId: string; name: string; stars: number; pos: string; createdAt: string };

/**
 * Estado de una encuesta de asistencia:
 *  - confirmed: los primeros N "Me apunto" por orden de voto (N = max_slots; sin cupo, todos)
 *  - waitlist:  el resto de "Me apunto" cuando se supera el cupo
 * Si alguien confirmado se borra, el primero de la lista de espera entra solo.
 */
function build(p: PollRow, votes: VoteRow[], guests: GuestRow[], meId: string) {
  // Los invitados externos (añadidos por el admin) cuentan como "Me apunto" desde que se añaden.
  const all: (VoteRow & { guest?: boolean; stars?: number })[] = [
    ...votes,
    ...guests.map((g) => ({
      pollId: g.pollId, playerId: g.id, choice: 'yes' as Choice, votedAt: g.createdAt, name: g.name, nick: null, pos: g.pos,
      guest: true, stars: Number(g.stars),
    })),
  ];
  const sorted = all.sort((a, b) => new Date(a.votedAt).getTime() - new Date(b.votedAt).getTime());
  const u = (v: (typeof all)[number]): PollUser => ({
    id: v.playerId, name: v.name, nick: v.nick, pos: v.pos, votedAt: v.votedAt,
    ...(v.guest ? { guest: true, stars: v.stars } : {}),
  });
  const yes = sorted.filter((v) => v.choice === 'yes');
  const limit = p.maxSlots ?? Infinity;
  const confirmed = yes.slice(0, limit).map(u);
  const waitlist = yes.slice(limit).map(u);
  const maybe = sorted.filter((v) => v.choice === 'maybe').map(u);
  const no = sorted.filter((v) => v.choice === 'no').map(u);
  const mine = votes.find((v) => v.playerId === meId);
  const myStatus = !mine ? null : mine.choice !== 'yes' ? mine.choice : waitlist.some((w) => w.id === meId) ? 'waitlist' : 'yes';
  return {
    ...p,
    counts: { yes: confirmed.length, waitlist: waitlist.length, maybe: maybe.length, no: no.length, guests: guests.length },
    confirmed, waitlist, maybe, no,
    myVote: mine?.choice ?? null,
    myStatus,
  };
}
export type PollResult = ReturnType<typeof build>;

export async function loadPolls(db: Db, pollIds: string[], meId: string): Promise<Map<string, PollResult>> {
  const out = new Map<string, PollResult>();
  if (!pollIds.length) return out;
  const polls = await db.query(
    `SELECT id, group_id AS "groupId", question, match_at AS "matchAt", format, max_slots AS "maxSlots",
            status, match_id AS "matchId", created_by AS "createdBy", created_at AS "createdAt"
       FROM polls WHERE id = ANY($1::uuid[])`,
    [pollIds]
  );
  const votes = await db.query(
    `SELECT v.poll_id AS "pollId", v.player_id AS "playerId", v.choice, v.voted_at AS "votedAt",
            p.display_name AS name, p.nick, p.pos
       FROM poll_votes v JOIN players p ON p.id = v.player_id
      WHERE v.poll_id = ANY($1::uuid[])`,
    [pollIds]
  );
  const guests = await db.query(
    `SELECT id, poll_id AS "pollId", name, stars::float8 AS stars, pos, created_at AS "createdAt"
       FROM poll_guests WHERE poll_id = ANY($1::uuid[])`,
    [pollIds]
  );
  for (const p of polls.rows as PollRow[]) {
    out.set(p.id, build(
      p,
      (votes.rows as VoteRow[]).filter((v) => v.pollId === p.id),
      (guests.rows as GuestRow[]).filter((g) => g.pollId === p.id),
      meId
    ));
  }
  return out;
}

export async function loadPoll(db: Db, pollId: string, meId: string) {
  return (await loadPolls(db, [pollId], meId)).get(pollId) ?? null;
}

/** Columnas de chat_messages con el autor, en el formato que usa la app. */
export const MSG_SELECT = `
  SELECT c.id, c.group_id AS "groupId", c.player_id AS "playerId", c.type, c.content, c.poll_id AS "pollId",
         c.metadata, c.created_at AS "createdAt", p.display_name AS "authorName", p.nick AS "authorNick"
    FROM chat_messages c LEFT JOIN players p ON p.id = c.player_id`;
