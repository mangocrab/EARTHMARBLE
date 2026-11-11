import {
  BOARD,
  active,
  apply,
  createGame,
  tick,
  view,
  remainingMs,
  type Game,
  type Difficulty,
  type Action,
} from "../game-core";
import { decide } from "../game-ai";
import { social, socialView, chat, type SocialState } from "../game-social";
import type { Snapshot, Room } from "./protocol";
export const SOLO_KEY = "earthmarble.solo.v1";
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
type Identity = { id: string; name: string };
type LocalRoom = {
  id: string;
  version: number;
  minutes: number;
  game: Game;
  social?: SocialState;
};
type Lounge = Omit<Room, "game"> & { social?: SocialState };
type Saved = {
  lounge?: Lounge | null;
  schema: 1;
  identity: Identity | null;
  room: LocalRoom | null;
  savedAt: number;
  manualPaused: boolean;
  requests: string[];
};
const difficulties = ["easy", "normal", "hard"];
const phases = [
  "roll",
  "animation",
  "moving",
  "reveal",
  "purchase",
  "build",
  "toll",
  "debt",
  "low",
  "end",
  "finished",
];
function integer(v: unknown, min: number, max = Number.MAX_SAFE_INTEGER) {
  return (
    typeof v === "number" && Number.isSafeInteger(v) && v >= min && v <= max
  );
}
function finite(v: unknown) {
  return typeof v === "number" && Number.isFinite(v);
}
export function validSave(value: unknown): value is Saved {
  try {
    const v = value as Saved;
    if (
      !v ||
      v.schema !== 1 ||
      !finite(v.savedAt) ||
      !Array.isArray(v.requests) ||
      v.requests.some((x) => typeof x !== "string") ||
      typeof v.manualPaused !== "boolean"
    )
      return false;
    if (
      v.identity !== null &&
      (!v.identity ||
        typeof v.identity.id !== "string" ||
        !v.identity.id ||
        typeof v.identity.name !== "string" ||
        !v.identity.name.trim() ||
        v.identity.name.length > 16)
    )
      return false;
    if (v.lounge) {
      const l = v.lounge;
      if (
        v.room ||
        !v.identity ||
        typeof l.id !== "string" ||
        !integer(l.version, 0) ||
        !integer(l.max, 2, 4) ||
        ![10, 20, 30, 60].includes(l.minutes) ||
        typeof l.allowAI !== "boolean" ||
        l.host !== v.identity.id ||
        !Array.isArray(l.members) ||
        !integer(l.members.length, 1, l.max) ||
        l.members[0].id !== v.identity.id ||
        new Set(l.members.map((m) => m.id)).size !== l.members.length ||
        l.members.some(
          (m, i) =>
            typeof m.id !== "string" ||
            typeof m.name !== "string" ||
            typeof m.ready !== "boolean" ||
            (i === 0 ? m.ai !== undefined : !difficulties.includes(m.ai!)),
        )
      )
        return false;
    }
    if (!v.room) return v.room === null;
    const r = v.room,
      g = r.game;
    if (
      !v.identity ||
      typeof r.id !== "string" ||
      !integer(r.version, 0) ||
      ![10, 20, 30, 60].includes(r.minutes) ||
      !g ||
      !Array.isArray(g.players) ||
      g.players.length < 2 ||
      g.players.length > 4 ||
      g.players[0].id !== v.identity.id ||
      !integer(g.turn, 0, g.players.length - 1) ||
      !phases.includes(g.phase) ||
      !integer(g.version, 0)
    )
      return false;
    const ids = g.players.map((p) => p.id);
    if (
      ids.some((id) => typeof id !== "string" || !id) ||
      new Set(ids).size !== ids.length
    )
      return false;
    for (const [i, p] of g.players.entries())
      if (
        typeof p.name !== "string" ||
        !integer(p.cash, 0) ||
        !integer(p.position, 0, 39) ||
        !integer(p.laps, 0) ||
        !integer(p.tide, 0, 3) ||
        typeof p.low !== "boolean" ||
        typeof p.freeLow !== "boolean" ||
        typeof p.bankrupt !== "boolean" ||
        !Array.isArray(p.held) ||
        p.held.some((c) => c !== 24 && c !== 25) ||
        (i === 0 ? p.ai !== undefined : !difficulties.includes(p.ai!))
      )
        return false;
    if (g.phase !== "finished" && active(g).bankrupt) return false;
    if (
      !Array.isArray(g.dice) ||
      g.dice.length !== 2 ||
      g.dice.some((n) => !integer(n, 1, 6)) ||
      !integer(g.doubles, 0, 3) ||
      typeof g.extra !== "boolean" ||
      typeof g.escapeRoll !== "boolean" ||
      !integer(g.pendingSteps, 0, 12) ||
      !integer(g.fund, 0) ||
      !integer(g.deckVersion, 0) ||
      ![g.deadline, g.endsAt, g.animationUntil].every(finite) ||
      (g.pausedAt !== undefined && !finite(g.pausedAt))
    )
      return false;
    if (g.phase === "moving") {
      const m = g.motion;
      if (
        !m ||
        !integer(m.remaining, 0, 40) ||
        !integer(m.total, 0, 40) ||
        !integer(m.done, 0, 40) ||
        m.remaining + m.done !== m.total ||
        ![-1, 1].includes(m.direction) ||
        typeof m.reward !== "boolean" ||
        typeof m.label !== "string" ||
        !["land", "stop", "transport", "high"].includes(m.finish) ||
        (m.after !== undefined &&
          (!Array.isArray(m.after) || m.after.some((n) => !integer(n, 0, 39))))
      )
        return false;
    }
    if (
      g.phase === "reveal" &&
      (!integer(g.pendingCard, 1, 30) ||
        !g.discardPile.includes(g.pendingCard!))
    )
      return false;
    const cards = [
      ...g.drawPile,
      ...g.discardPile,
      ...g.players.flatMap((p) => p.held),
    ];
    if (
      cards.length !== 30 ||
      new Set(cards).size !== 30 ||
      cards.some((c) => !integer(c, 1, 30))
    )
      return false;
    if (
      !Array.isArray(g.log) ||
      g.log.length > 100 ||
      g.log.some((l) => typeof l !== "string")
    )
      return false;
    for (const [id, e] of Object.entries(g.estates))
      if (
        !/^\d+$/.test(id) ||
        !BOARD[+id]?.price ||
        !ids.includes(e.owner) ||
        !Array.isArray(e.buildings) ||
        e.buildings.length !== BOARD[+id].costs!.length ||
        e.buildings.some((b) => typeof b !== "boolean")
      )
        return false;
    if (
      g.payment &&
      (!integer(g.payment.amount, 0) ||
        (g.payment.to !== undefined && !ids.includes(g.payment.to)) ||
        (g.payment.after !== undefined &&
          (!Array.isArray(g.payment.after) ||
            g.payment.after.some((id) => !integer(id, 0, 39)))))
    )
      return false;
    return true;
  } catch {
    return false;
  }
}
export function browserRandom(max: number) {
  if (!integer(max, 1, 4294967296)) throw new Error("Invalid random range");
  const limit = Math.floor(4294967296 / max) * max,
    buffer = new Uint32Array(1);
  do {
    crypto.getRandomValues(buffer);
  } while (buffer[0] >= limit);
  return buffer[0] % max;
}
export class SoloController {
  identity: Identity | null = null;
  private room: LocalRoom | null = null;
  private lounge: Lounge | null = null;
  private manualPaused = false;
  private suspendedAt: number | undefined;
  private requests = new Set<string>();
  private listeners = new Set<(value: Snapshot) => void>();
  private aiAt = 0;
  private lastSave = 0;
  private storageFailed = false;
  constructor(
    private storage: Store,
    private now: () => number = Date.now,
    private random: (max: number) => number = browserRandom,
    private onError: (message: string) => void = () => {},
  ) {
    try {
      const text = storage.getItem(SOLO_KEY);
      if (text) {
        const data: unknown = JSON.parse(text);
        if (!validSave(data)) throw new Error("Invalid save");
        this.identity = data.identity;
        this.room = data.room;
        this.lounge = data.lounge ?? null;
        this.requests = new Set(data.requests.slice(-2000));
        this.manualPaused = data.manualPaused;
        this.shift(Math.max(0, this.now() - data.savedAt));
        if (this.manualPaused) this.suspendedAt = this.now();
      }
    } catch {
      this.onError(
        "저장된 탐사를 불러오지 못했습니다. 새 탐사를 시작할 수 있습니다.",
      );
      try {
        storage.removeItem(SOLO_KEY);
      } catch {}
    }
    this.aiAt = this.now() + 900;
  }
  subscribe(listener: (value: Snapshot) => void) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }
  private shift(elapsed: number) {
    if (!this.room) return;
    const g = this.room.game;
    g.deadline += elapsed;
    g.endsAt += elapsed;
    g.animationUntil += elapsed;
    if (g.pausedAt !== undefined) g.pausedAt += elapsed;
    this.aiAt += elapsed;
  }
  snapshot(): Snapshot {
    const r = this.room,
      g = r?.game,
      id = this.identity?.id ?? "",
      game = g ? view(g, id) : undefined;
    if (game && this.suspendedAt !== undefined && game.pausedAt === undefined)
      game.pausedAt = this.suspendedAt;
    return {
      room:
        r && game
          ? {
              id: r.id,
              version: r.version,
              code: "SOLO",
              name: `${this.identity!.name}의 AI 탐사`,
              host: id,
              max: g!.players.length,
              allowAI: true,
              minutes: r.minutes,
              members: g!.players.map((p) => ({
                id: p.id,
                name: p.name,
                ai: p.ai,
                ready: true,
              })),
              ...socialView(social(r), id),
              game,
            }
          : this.lounge
            ? {
                ...structuredClone(this.lounge),
                ...socialView(social(this.lounge), id),
              }
            : null,
      matching: false,
      count: 0,
      matchAt: 0,
      paused: this.manualPaused,
      clockNow: this.suspendedAt,
      serverNow: this.now(),
    };
  }
  private emit() {
    const state = this.snapshot();
    for (const listener of this.listeners) listener(state);
  }
  save() {
    try {
      const value: Saved = {
        schema: 1,
        identity: this.identity,
        room: this.room,
        lounge: this.lounge,
        savedAt: this.suspendedAt ?? this.now(),
        manualPaused: this.manualPaused,
        requests: [...this.requests].slice(-2000),
      };
      this.storage.setItem(SOLO_KEY, JSON.stringify(value));
      this.lastSave = this.now();
    } catch {
      if (!this.storageFailed) {
        this.storageFailed = true;
        this.onError(
          "이 브라우저에 탐사를 저장할 수 없습니다. 새로고침 전에 저장 설정을 확인하세요.",
        );
      }
    }
  }
  login(name: unknown) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 16)
      throw new Error("닉네임은 1~16자로 입력하세요.");
    if (!this.identity)
      this.identity = { id: crypto.randomUUID(), name: name.trim() };
    this.save();
    this.emit();
    return this.identity;
  }
  pause() {
    if (this.suspendedAt === undefined) this.suspendedAt = this.now();
    this.save();
    this.emit();
  }
  resume() {
    if (this.manualPaused) return;
    if (this.suspendedAt !== undefined) {
      const elapsed = Math.max(0, this.now() - this.suspendedAt);
      this.shift(elapsed);
      this.suspendedAt = undefined;
      this.save();
      this.emit();
    }
  }
  command(a: Record<string, unknown>) {
    if (!this.identity) throw new Error("닉네임을 등록하세요.");
    if (
      typeof a.requestId !== "string" ||
      !a.requestId ||
      a.requestId.length > 80 ||
      !Number.isInteger(a.version)
    )
      throw new Error("잘못된 요청입니다.");
    if (this.requests.has(a.requestId)) return;
    const now = this.now();
    if (a.type === "chat") {
      const target = this.room || this.lounge;
      if (!target) throw new Error("방에 먼저 참가하세요.");
      chat(social(target), this.identity, false, a, now);
      this.requests.add(a.requestId);
      this.save();
      this.emit();
      return;
    }
    if (a.type === "create") {
      if (this.room || this.lounge || a.version !== 0)
        throw new Error("현재 방을 먼저 나가세요.");
      if (
        !integer(a.max, 2, 4) ||
        ![10, 20, 30, 60].includes(a.minutes as number) ||
        typeof a.allowAI !== "boolean"
      )
        throw new Error("방 설정을 확인하세요.");
      this.lounge = {
        id: crypto.randomUUID(),
        version: 0,
        code: "LOCAL",
        name: `${this.identity.name}님의 방`,
        host: this.identity.id,
        max: a.max as number,
        minutes: a.minutes as number,
        allowAI: a.allowAI as boolean,
        members: [{ ...this.identity, ready: false }],
      };
    } else if (this.lounge) {
      const l = this.lounge;
      if (a.version !== l.version) throw new Error("방 상태가 변경됐습니다.");
      if (a.type === "ai") {
        if (
          !l.allowAI ||
          l.members.length >= l.max ||
          !difficulties.includes(a.difficulty as string)
        )
          throw new Error("AI 초대 설정과 빈 자리를 확인하세요.");
        l.members.push({
          id: crypto.randomUUID(),
          name: `탐사봇 ${l.members.length}`,
          ai: a.difficulty as string,
          ready: true,
        });
      } else if (a.type === "kick") {
        const member = l.members.find((m) => m.id === a.member);
        if (!member?.ai) throw new Error("내보낼 AI를 선택하세요.");
        l.members = l.members.filter((m) => m.id !== member.id);
      } else if (a.type === "ready") {
        if (typeof a.ready !== "boolean")
          throw new Error("준비 상태를 확인하세요.");
        l.members[0].ready = a.ready;
      } else if (a.type === "start") {
        if (l.members.length < 2 || !l.members.every((m) => m.ready))
          throw new Error("AI를 초대하고 모두 준비하세요.");
        const users = l.members.map((m) => ({
          id: m.id,
          name: m.name,
          ...(m.ai ? { ai: m.ai as Difficulty } : {}),
        }));
        this.room = {
          id: l.id,
          version: l.version + 1,
          minutes: l.minutes,
          game: createGame(users, now, this.random, l.minutes),
        };
        this.lounge = null;
        this.manualPaused = false;
        this.suspendedAt = undefined;
        this.aiAt = now + 900;
      } else if (a.type === "leave") this.lounge = null;
      else throw new Error("이 방에서 사용할 수 없는 행동입니다.");
      l.version++;
    } else if (a.type === "solo-start") {
      if (this.room) throw new Error("현재 탐사를 먼저 종료하세요.");
      if (
        a.version !== 0 ||
        !integer(a.count, 1, 3) ||
        !Array.isArray(a.levels) ||
        a.levels.length !== a.count ||
        a.levels.some((l) => !difficulties.includes(l)) ||
        ![10, 20, 30, 60].includes(a.minutes as number)
      )
        throw new Error("AI 설정을 확인하세요.");
      const users = [
        this.identity,
        ...(a.levels as Difficulty[]).map((ai, i) => ({
          id: crypto.randomUUID(),
          name: `탐사봇 ${i + 1}`,
          ai,
        })),
      ];
      this.room = {
        id: crypto.randomUUID(),
        version: 0,
        minutes: a.minutes as number,
        game: createGame(users, now, this.random, a.minutes as number),
      };
      this.manualPaused = false;
      this.suspendedAt = undefined;
      this.aiAt = now + 900;
    } else if (a.type === "action") {
      if (!this.room || this.manualPaused || this.suspendedAt !== undefined)
        throw new Error("탐사를 계속한 뒤 행동하세요.");
      if (a.version !== this.room.game.version)
        throw new Error("상태가 변경됐습니다. 다시 시도하세요.");
      if (!a.action || typeof a.action !== "object")
        throw new Error("잘못된 행동입니다.");
      const g = structuredClone(this.room.game);
      apply(g, this.identity.id, a.action as Action, now, this.random);
      g.version++;
      this.room.game = g;
    } else {
      if (!this.room || a.version !== this.room.version)
        throw new Error("탐사 상태가 변경됐습니다.");
      if (a.type === "solo-pause") {
        if (typeof a.paused !== "boolean")
          throw new Error("중지 상태를 확인하세요.");
        this.manualPaused = a.paused;
        if (this.manualPaused) this.pause();
        else this.resume();
        this.room.version++;
      } else if (a.type === "solo-reset" || a.type === "leave") {
        if (a.type === "leave" && this.room.game.phase !== "finished")
          throw new Error("새 탐사 버튼에서 현재 탐사를 종료하세요.");
        this.room = null;
        this.manualPaused = false;
        this.suspendedAt = undefined;
      } else throw new Error("혼자 AI와 탐사하는 모드입니다.");
    }
    this.requests.add(a.requestId);
    if (this.requests.size > 2000)
      this.requests.delete(this.requests.values().next().value!);
    this.save();
    this.emit();
  }
  step() {
    if (
      !this.room ||
      this.suspendedAt !== undefined ||
      this.room.game.phase === "finished"
    )
      return;
    const now = this.now(),
      g = this.room.game;
    let changed = tick(g, now, this.random);
    if (
      !["animation", "moving", "reveal"].includes(g.phase) &&
      !g.winner &&
      active(g).ai &&
      (g.phase === "end" || remainingMs(g, now) > 0) &&
      now >= this.aiAt
    ) {
      apply(g, active(g).id, decide(g, now), now, this.random);
      this.aiAt = now + 900;
      changed = true;
    }
    if (changed) {
      g.version++;
      this.save();
      this.emit();
    } else if (now - this.lastSave >= 1000) this.save();
  }
  dispose() {
    this.save();
    this.listeners.clear();
  }
}
