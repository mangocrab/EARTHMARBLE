import Peer, { type DataConnection, type PeerOptions } from "peerjs";
import {
  createGame,
  apply,
  tick,
  view,
  active,
  remainingMs,
  type Game,
  type Difficulty,
  type Action,
} from "../game-core";
import { decide } from "../game-ai";
import { browserRandom } from "./solo";
import type { Room, Member, Snapshot } from "./protocol";
type Identity = { id: string; name: string };
type HostedRoom = Omit<Room, "game"> & { game?: Game };
const FINDER = "earthmarble-match-lobby-v1";
const levels = ["easy", "normal", "hard"];
function options(): PeerOptions {
  // PeerJS 1.5 ships retired TURN hostnames. Use reachable public STUN for
  // direct connections; a relay can be injected for controlled deployments/tests.
  const config: RTCConfiguration = {
    iceServers: [
      {
        urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"],
      },
    ],
  };
  if (import.meta.env.VITE_TURN_URL)
    config.iceServers = [
      {
        urls: import.meta.env.VITE_TURN_URL,
        username: "earth",
        credential: "earth-test",
      },
    ];
  const url = import.meta.env.VITE_SIGNAL_URL;
  if (!url) return { debug: 0, config };
  const u = new URL(url);
  return {
    host: u.hostname,
    port: +u.port || (u.protocol === "https:" ? 443 : 80),
    secure: u.protocol === "https:",
    path: u.pathname,
    debug: 0,
    config,
  };
}
function openPeer(id: string, signal?: AbortSignal): Promise<Peer> {
  if (signal?.aborted) return Promise.reject(new Error("연결이 취소됐습니다."));
  return new Promise((resolve, reject) => {
    const peer = new Peer(id, options());
    const timeout = setTimeout(
      () =>
        failed(
          new Error(
            "온라인 연결을 준비하지 못했습니다. 잠시 후 다시 시도하세요.",
          ),
        ),
      12000,
    );
    const cancelled = () => failed(new Error("연결이 취소됐습니다."));
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancelled);
      peer.off("error", failed);
    };
    const failed = (e: Error) => {
      cleanup();
      peer.destroy();
      reject(e);
    };
    signal?.addEventListener("abort", cancelled, { once: true });
    peer.once("error", failed);
    peer.once("open", () => {
      cleanup();
      resolve(peer);
    });
  });
}
function connect(peer: Peer, id: string): Promise<DataConnection> {
  return new Promise((resolve, reject) => {
    const c = peer.connect(id, { reliable: true, serialization: "binary" });
    const timer = setTimeout(() => {
      c.close();
      reject(
        new Error(
          "방에 연결할 수 없습니다. 방 코드와 방장의 연결 상태를 확인하세요.",
        ),
      );
    }, 15000);
    c.once("open", () => {
      clearTimeout(timer);
      resolve(c);
    });
    c.once("error", (e) => {
      clearTimeout(timer);
      c.close();
      reject(e);
    });
    c.once("close", () => {
      clearTimeout(timer);
      reject(new Error("연결이 닫혔습니다."));
    });
  });
}
export class PeerRoomController {
  private peer?: Peer;
  private finder?: Peer;
  private upstream?: DataConnection;
  private hosted?: HostedRoom;
  private password = "";
  private peers = new Map<
    string,
    { conn: DataConnection; identity: Identity }
  >();
  private pending = new Map<
    string,
    {
      resolve: () => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private cache = new Map<string, { fingerprint: string; error?: string }>();
  private snapshot: Snapshot = {
    room: null,
    matching: false,
    count: 0,
    matchAt: 0,
    serverNow: Date.now(),
  };
  private matching = false;
  private matchAt = 0;
  private dead = false;
  private abort = new AbortController();
  private aiAt = 0;
  private loop: ReturnType<typeof setInterval>;
  private listeners = new Set<(s: Snapshot) => void>();
  constructor(
    private me: Identity,
    private exit: (message?: string) => void,
  ) {
    this.loop = setInterval(() => this.step(), 40);
  }
  subscribe(fn: (s: Snapshot) => void) {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => this.listeners.delete(fn);
  }
  private emit(s: Snapshot) {
    this.snapshot = s;
    for (const fn of this.listeners) fn(s);
  }
  private stateFor(id: string): Snapshot {
    const r = this.hosted;
    return {
      room: this.matching
        ? null
        : r
          ? {
              ...r,
              members: r.members.map((m) => ({ ...m })),
              game: r.game ? view(r.game, id) : undefined,
            }
          : null,
      matching: this.matching,
      count: this.matching ? (r?.members.length ?? 1) : 0,
      matchAt: this.matchAt,
      serverNow: Date.now(),
    };
  }
  private broadcast() {
    if (this.dead) return;
    this.emit(this.stateFor(this.me.id));
    for (const { conn, identity } of this.peers.values())
      if (conn.open)
        conn.send({ type: "state", state: this.stateFor(identity.id) });
  }
  private async boot(id = `earthmarble-player-${crypto.randomUUID()}`) {
    if (this.dead) throw new Error("종료된 연결입니다.");
    if (this.peer) return this.peer;
    const peer = await openPeer(id, this.abort.signal);
    if (this.dead) {
      peer.destroy();
      throw new Error("연결이 취소됐습니다.");
    }
    this.peer = peer;
    peer.on("connection", (c) => this.accept(c));
    peer.on("error", () => {});
    peer.on("disconnected", () => {
      if (!this.dead) peer.reconnect();
    });
    return peer;
  }
  private makeRoom(
    code: string,
    max = 4,
    minutes = 30,
    allowAI = true,
    auto = false,
  ) {
    this.hosted = {
      id: crypto.randomUUID(),
      version: 0,
      code,
      name: auto ? "자동 매칭 탐사대" : `${this.me.name}님의 방`,
      host: this.me.id,
      max,
      minutes,
      allowAI,
      members: [{ ...this.me, ready: auto }],
    };
  }
  async create(a: Record<string, unknown>) {
    const max = Number(a.max),
      minutes = Number(a.minutes);
    if (![2, 3, 4].includes(max) || ![10, 20, 30, 60].includes(minutes))
      throw new Error("방 설정을 확인하세요.");
    const code = crypto
      .randomUUID()
      .replaceAll("-", "")
      .slice(0, 6)
      .toUpperCase();
    this.password =
      typeof a.password === "string" ? a.password.slice(0, 64) : "";
    this.makeRoom(code, max, minutes, !!a.allowAI);
    this.hosted!.connection = "connecting";
    this.broadcast();
    // Opening the shared room must not block local AI play on signaling access.
    void this.boot(`earthmarble-room-${code}`)
      .then(() => {
        if (this.dead) return;
        this.hosted!.connection = "ready";
        this.broadcast();
      })
      .catch(() => {
        if (this.dead) return;
        this.hosted!.connection = "offline";
        this.broadcast();
      });
  }
  async join(code: unknown, password: unknown) {
    if (typeof code !== "string" || !/^[A-Z0-9]{6}$/i.test(code.trim()))
      throw new Error("6자리 방 코드를 확인하세요.");
    const peer = await this.boot();
    await this.joinHost(
      peer,
      `earthmarble-room-${code.trim().toUpperCase()}`,
      typeof password === "string" ? password : "",
      false,
    );
  }
  async match() {
    this.matching = true;
    this.emit({
      room: null,
      matching: true,
      count: 0,
      matchAt: Date.now() + 10000,
      serverNow: Date.now(),
    });
    const peer = await this.boot();
    await this.findMatch(peer);
  }
  private async findMatch(peer: Peer) {
    if (this.dead) return;
    try {
      const finder = await openPeer(FINDER, this.abort.signal);
      if (this.dead) {
        finder.destroy();
        return;
      }
      this.finder = finder;
      this.makeRoom("MATCH", 4, 30, false, true);
      this.matching = true;
      this.matchAt = Date.now() + 10000;
      finder.on("error", () => {});
      finder.on("connection", (c) =>
        c.on("open", () => {
          if (!this.dead) c.send({ host: peer.id });
          setTimeout(() => c.close(), 1000);
        }),
      );
      this.broadcast();
    } catch (e) {
      if (this.dead) return;
      if ((e as { type?: string }).type !== "unavailable-id")
        throw new Error(
          "매칭 신호 서버에 연결하지 못했습니다. 다시 시도하세요.",
        );
      let directory: DataConnection | undefined;
      try {
        directory = await connect(peer, FINDER);
        const host = await new Promise<string>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("매칭 안내 시간이 초과됐습니다.")),
            5000,
          );
          directory!.once("data", (data: any) => {
            clearTimeout(timer);
            typeof data?.host === "string"
              ? resolve(data.host)
              : reject(new Error("잘못된 매칭 안내입니다."));
          });
        });
        directory.close();
        await this.joinHost(peer, host, "", true);
      } catch (error) {
        directory?.close();
        if (this.dead) return;
        await new Promise((r) => setTimeout(r, 500));
        if (!this.dead) await this.findMatch(peer);
      }
    }
  }
  private async joinHost(
    peer: Peer,
    host: string,
    password: string,
    auto: boolean,
  ) {
    const c = await connect(peer, host);
    this.upstream = c;
    await new Promise<void>((resolve, reject) => {
      let admitted = false;
      const timer = setTimeout(
        () => reject(new Error("참가 응답 시간이 초과됐습니다.")),
        7000,
      );
      c.on("data", (data: any) => {
        if (this.dead) return;
        if (
          data?.type === "state" &&
          data.state &&
          typeof data.state.serverNow === "number"
        ) {
          this.matching = !!data.state.matching;
          this.emit(data.state);
          if (!admitted) {
            admitted = true;
            clearTimeout(timer);
            resolve();
          }
        } else if (data?.type === "ack") {
          const request = this.pending.get(data.id);
          if (request) {
            clearTimeout(request.timer);
            this.pending.delete(data.id);
            data.error
              ? request.reject(new Error(data.error))
              : request.resolve();
          }
        } else if (data?.type === "reject") {
          clearTimeout(timer);
          reject(new Error(data.error || "참가할 수 없습니다."));
        } else if (
          data?.type === "closed" &&
          this.snapshot.room?.game?.phase !== "finished"
        )
          this.fail(data.error || "방장이 방을 종료했습니다.");
      });
      c.on("close", () => {
        clearTimeout(timer);
        if (!admitted) reject(new Error("참가 연결이 닫혔습니다."));
        else if (!this.dead && this.snapshot.room?.game?.phase !== "finished")
          this.fail(
            "방장과 연결이 끊겼습니다. 방장이 창을 열어 두어야 합니다.",
          );
      });
      c.on("error", () => {
        if (!this.dead) this.fail("온라인 연결 오류가 발생했습니다.");
      });
      c.send({ type: "hello", identity: this.me, password, auto });
    });
  }
  private accept(c: DataConnection) {
    let identity: Identity | undefined;
    c.on("error", () => {});
    c.on("data", (data: any) => {
      if (this.dead) return;
      if (!identity) {
        const r = this.hosted,
          p = data?.identity;
        let error = "";
        if (
          data?.type !== "hello" ||
          !r ||
          !p ||
          typeof p.id !== "string" ||
          p.id.length > 80 ||
          typeof p.name !== "string" ||
          !p.name.trim() ||
          p.name.trim().length > 16
        )
          error = "참가 정보를 확인하세요.";
        else if (data.password !== this.password)
          error = "방 비밀번호가 다릅니다.";
        else if (r.game) error = "이미 시작한 방입니다.";
        else if (r.members.length >= r.max) error = "방이 가득 찼습니다.";
        else if (r.members.some((m) => m.id === p.id))
          error = "이미 참가한 탐사대원입니다. 다른 브라우저를 사용하세요.";
        else if (!!data.auto !== this.matching)
          error = "현재 매칭이 끝났습니다.";
        if (error) {
          c.send({ type: "reject", error });
          setTimeout(() => c.close(), 300);
          return;
        }
        identity = { id: p.id, name: p.name.trim() };
        this.peers.set(c.peer, { conn: c, identity });
        r!.members.push({ ...identity, ready: this.matching });
        r!.version++;
        if (this.matching && r!.members.length === r!.max) {
          this.finder?.destroy();
          this.finder = undefined;
        }
        this.broadcast();
        return;
      }
      if (data?.type === "command") {
        const a = data.envelope;
        if (
          !a ||
          typeof a.requestId !== "string" ||
          a.requestId.length > 80 ||
          !Number.isInteger(a.version)
        )
          return;
        const key = `${identity.id}:${a.requestId}`,
          fingerprint = JSON.stringify(a);
        const cached = this.cache.get(key);
        let error: string | undefined;
        if (cached)
          error =
            cached.fingerprint === fingerprint
              ? cached.error
              : "요청 ID가 다른 내용에 재사용됐습니다.";
        else {
          try {
            this.perform(identity.id, a);
          } catch (e) {
            error = (e as Error).message;
          }
          this.cache.set(key, { fingerprint, error });
          if (this.cache.size > 2000)
            this.cache.delete(this.cache.keys().next().value!);
        }
        if (c.open) c.send({ type: "ack", id: a.requestId, error });
      }
    });
    c.on("close", () => {
      if (this.dead || !identity) return;
      this.peers.delete(c.peer);
      const r = this.hosted;
      if (!r) return;
      if (!r.game) r.members = r.members.filter((m) => m.id !== identity!.id);
      else {
        const m = r.members.find((m) => m.id === identity!.id);
        if (m) m.offlineSince = Date.now();
      }
      r.version++;
      this.broadcast();
    });
  }
  async command(a: Record<string, unknown>) {
    if (a.type === "cancel" || (a.type === "leave" && !this.hosted)) {
      this.close();
      this.exit();
      return;
    }
    if (this.hosted) {
      this.perform(this.me.id, a);
      return;
    }
    const c = this.upstream;
    if (!c?.open) throw new Error("방 연결을 기다리세요.");
    await new Promise<void>((resolve, reject) => {
      const id = String(a.requestId),
        timer = setTimeout(() => {
          this.pending.delete(id);
          reject(new Error("방장 응답 시간이 초과됐습니다. 다시 확인하세요."));
        }, 8000);
      this.pending.set(id, { resolve, reject, timer });
      c.send({ type: "command", envelope: a });
    });
  }
  private perform(actor: string, a: Record<string, unknown>) {
    const r = this.hosted!;
    if (a.type === "leave") {
      if (actor === r.host) {
        this.close();
        this.exit();
        return;
      }
      const peer = [...this.peers.values()].find(
        (p) => p.identity.id === actor,
      );
      peer?.conn.close();
      return;
    }
    if (a.type === "action") {
      if (!r.game || a.version !== r.game.version)
        throw new Error("게임 상태가 바뀌었습니다. 다시 확인하세요.");
      const candidate = structuredClone(r.game);
      apply(candidate, actor, a.action as Action, Date.now(), browserRandom);
      candidate.version++;
      r.game = candidate;
    } else {
      if (r.game || a.version !== r.version)
        throw new Error("방 상태가 바뀌었습니다.");
      if (a.type === "ready") {
        if (typeof a.ready !== "boolean")
          throw new Error("준비 상태를 확인하세요.");
        const m = r.members.find((m) => m.id === actor);
        if (!m) throw new Error("참가자가 아닙니다.");
        m.ready = a.ready;
      } else {
        if (actor !== r.host) throw new Error("방장만 할 수 있습니다.");
        if (a.type === "ai") {
          if (
            !r.allowAI ||
            r.members.length >= r.max ||
            !levels.includes(a.difficulty as string)
          )
            throw new Error("AI 초대 설정을 확인하세요.");
          r.members.push({
            id: crypto.randomUUID(),
            name: `탐사봇 ${r.members.length}`,
            ai: a.difficulty as Difficulty,
            ready: true,
          });
        } else if (a.type === "start") {
          if (r.members.length < 2 || !r.members.every((m) => m.ready))
            throw new Error("모든 대원이 준비해야 합니다.");
          this.start();
        } else throw new Error("알 수 없는 행동입니다.");
      }
      r.version++;
    }
    this.broadcast();
  }
  private start() {
    const r = this.hosted!;
    r.game = createGame(
      r.members.map((m) => ({
        id: m.id,
        name: m.name,
        ...(m.ai ? { ai: m.ai as Difficulty } : {}),
      })),
      Date.now(),
      browserRandom,
      r.minutes,
    );
    this.matching = false;
    this.finder?.destroy();
    this.finder = undefined;
    this.aiAt = Date.now() + 900;
  }
  private step() {
    const r = this.hosted;
    if (this.dead || !r) return;
    const now = Date.now();
    if (this.matching && now >= this.matchAt) {
      if (r.members.length >= 2) {
        this.start();
        r.version++;
        this.broadcast();
      } else {
        this.matchAt = now + 10000;
        this.broadcast();
      }
    }
    const g = r.game;
    if (!g || g.phase === "finished") return;
    let changed = tick(g, now, browserRandom);
    const p = active(g),
      m = r.members.find((m) => m.id === p.id);
    if (
      !["animation", "moving", "reveal"].includes(g.phase) &&
      !g.winner &&
      (g.phase === "end" || remainingMs(g, now) > 0) &&
      now >= this.aiAt &&
      (p.ai || (m?.offlineSince && now - m.offlineSince >= 90000))
    ) {
      try {
        apply(g, p.id, decide(g, now), now, browserRandom);
        changed = true;
      } catch {}
      this.aiAt = now + 900;
    }
    if (changed) {
      g.version++;
      this.broadcast();
    }
  }
  private fail(message: string) {
    if (this.dead) return;
    this.close();
    this.exit(message);
  }
  close() {
    if (this.dead) return;
    this.dead = true;
    this.abort.abort();
    clearInterval(this.loop);
    for (const { conn } of this.peers.values()) {
      if (conn.open)
        conn.send({ type: "closed", error: "방장이 방을 종료했습니다." });
      conn.close();
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("연결이 종료됐습니다."));
    }
    this.pending.clear();
    this.finder?.destroy();
    this.peer?.destroy();
    this.listeners.clear();
  }
}
