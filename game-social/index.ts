import { assets, type Game } from "../game-core";
export type RoomMode = "private" | "quick" | "normal";
export type MatchMode = "quick" | "normal";
export const QUICK_CHATS = [
  "안녕하세요!",
  "잘 부탁드려요!",
  "좋은 승부예요!",
  "축하해요!",
  "잠시만 기다려 주세요.",
  "수고하셨습니다!",
];
export type Emoji = { id: string; label: string; text?: string; url?: string };
export const DEFAULT_EMOJIS: Emoji[] = [
  { id: "earth", label: "지구", text: "🌍" },
  { id: "clap", label: "박수", text: "👏" },
  { id: "dice", label: "주사위", text: "🎲" },
  { id: "leaf", label: "새싹", text: "🌱" },
];
export type Spectator = {
  id: string;
  name: string;
  profile?: string;
  watching?: string;
};
export type ChatMessage = {
  id: string;
  actor: string;
  name: string;
  spectator: boolean;
  at: number;
  kind: "text" | "quick" | "emoji";
  text: string;
  emoji?: Emoji;
};
export type SocialState = {
  mode: RoomMode;
  spectators: Spectator[];
  chat: ChatMessage[];
  cooldowns: Record<string, number>;
  emojis: Emoji[];
  startedAt?: number;
  resultsRecorded?: boolean;
};
export function social(
  room: { social?: SocialState },
  mode: RoomMode = "private",
): SocialState {
  const s = room.social;
  if (
    !s ||
    !["private", "quick", "normal"].includes(s.mode) ||
    !Array.isArray(s.spectators) ||
    !Array.isArray(s.chat) ||
    !Array.isArray(s.emojis) ||
    !s.cooldowns ||
    typeof s.cooldowns !== "object"
  )
    room.social = {
      mode,
      spectators: [],
      chat: [],
      cooldowns: {},
      emojis: DEFAULT_EMOJIS.map((e) => ({ ...e })),
    };
  return room.social!;
}
export function socialView(s: SocialState, id: string) {
  const viewer = s.spectators.find((p) => p.id === id);
  return {
    mode: s.mode,
    spectators: s.spectators.map(({ id, name, profile }) => ({
      id,
      name,
      profile,
    })),
    chat: s.chat,
    emojis: s.emojis,
    startedAt: s.startedAt,
    isSpectator: !!viewer,
    watching: viewer?.watching,
  };
}
export function chat(
  s: SocialState,
  actor: { id: string; name: string },
  spectator: boolean,
  input: { kind?: unknown; text?: unknown; quick?: unknown; emoji?: unknown },
  now: number,
) {
  const cooldown = spectator ? 5000 : 3000;
  if (
    Object.hasOwn(s.cooldowns, actor.id) &&
    now - s.cooldowns[actor.id] < cooldown
  )
    throw new Error(`채팅은 ${spectator ? 5 : 3}초에 한 번 보낼 수 있습니다.`);
  let text: string, kind: ChatMessage["kind"], emoji: Emoji | undefined;
  if (input.kind === "quick") {
    if (!Number.isInteger(input.quick) || !QUICK_CHATS[Number(input.quick)])
      throw new Error("퀵채팅을 선택하세요.");
    kind = "quick";
    text = QUICK_CHATS[Number(input.quick)];
  } else {
    if (s.mode !== "private")
      throw new Error("매칭 게임은 퀵채팅만 사용할 수 있습니다.");
    if (input.kind === "emoji") {
      emoji = s.emojis.find((e) => e.id === input.emoji);
      if (!emoji) throw new Error("사용할 수 없는 이모티콘입니다.");
      kind = "emoji";
      text = emoji.label;
    } else {
      if (
        input.kind !== "text" ||
        typeof input.text !== "string" ||
        !input.text.trim() ||
        input.text.trim().length > 200
      )
        throw new Error("채팅은 1~200자로 입력하세요.");
      kind = "text";
      text = input.text.trim();
    }
  }
  const message: ChatMessage = {
    id: crypto.randomUUID(),
    actor: actor.id,
    name: actor.name,
    spectator,
    at: now,
    kind,
    text,
    ...(emoji ? { emoji: { ...emoji } } : {}),
  };
  Object.defineProperty(s.cooldowns, actor.id, {
    value: now,
    writable: true,
    configurable: true,
    enumerable: true,
  });
  s.chat.push(message);
  if (s.chat.length > 80) s.chat.shift();
  return message;
}
export function emojis(value: unknown): Emoji[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new Error("이모티콘 목록은 최대 100개입니다.");
  const ids = new Set<string>();
  return value.map((e) => {
    if (
      !e ||
      typeof e.id !== "string" ||
      !/^[a-zA-Z0-9_-]{1,40}$/.test(e.id) ||
      ids.has(e.id) ||
      typeof e.label !== "string" ||
      !e.label.trim() ||
      e.label.length > 40
    )
      throw new Error("이모티콘 설정을 확인하세요.");
    ids.add(e.id);
    if (
      typeof e.url === "string" &&
      (/^https:\/\//.test(e.url) || /^\/(?!\/)/.test(e.url))
    )
      return { id: e.id, label: e.label, url: e.url };
    if (typeof e.text === "string" && e.text.length > 0 && e.text.length <= 12)
      return { id: e.id, label: e.label, text: e.text };
    throw new Error("이모티콘은 HTTPS/사이트 경로 또는 문자여야 합니다.");
  });
}
export type Score = { games: number; wins: number; losses: number };
export type Stats = Record<"2" | "3" | "4", Score>;
export type GameResult = {
  gameId: string;
  size: 2 | 3 | 4;
  rank: number;
  win: boolean;
};
export const emptyStats = (): Stats => ({
  2: { games: 0, wins: 0, losses: 0 },
  3: { games: 0, wins: 0, losses: 0 },
  4: { games: 0, wins: 0, losses: 0 },
});
export function validStats(value: unknown): value is Stats {
  if (!value || typeof value !== "object") return false;
  return [2, 3, 4].every((k) => {
    const v = (value as any)[k];
    return (
      v &&
      [v.games, v.wins, v.losses].every(
        (n) => Number.isSafeInteger(n) && n >= 0,
      ) &&
      v.games === v.wins + v.losses
    );
  });
}
export function result(
  g: Pick<Game, "players" | "estates" | "phase">,
  id: string,
  gameId: string,
): GameResult | undefined {
  if (g.phase !== "finished" || g.players.filter((p) => !p.ai).length < 2)
    return;
  const p = g.players.find((p) => p.id === id && !p.ai);
  if (!p) return;
  return { gameId, size: g.players.length as 2 | 3 | 4, ...standing(g, p.id)! };
}
export function standing(
  g: Pick<Game, "players" | "estates" | "phase">,
  id: string,
) {
  const p = g.players.find((p) => p.id === id);
  if (!p) return;
  const rank =
    1 +
    g.players.filter(
      (q) =>
        q.id !== id &&
        ((p.bankrupt && !q.bankrupt) ||
          (q.bankrupt === p.bankrupt &&
            assets(g as Game, q) > assets(g as Game, p))),
    ).length;
  return { rank, win: !p.bankrupt && rank <= (g.players.length === 4 ? 2 : 1) };
}

export function addResult(stats: Stats, r: GameResult): Stats {
  const next = structuredClone(stats),
    v = next[r.size];
  v.games++;
  r.win ? v.wins++ : v.losses++;
  return next;
}
export function totalStats(stats: Stats): Score {
  return Object.values(stats).reduce(
    (a, v) => ({
      games: a.games + v.games,
      wins: a.wins + v.wins,
      losses: a.losses + v.losses,
    }),
    { games: 0, wins: 0, losses: 0 },
  );
}
