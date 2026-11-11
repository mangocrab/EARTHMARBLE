import express from "express";
import { createServer } from "node:http";
import {
  randomInt,
  randomUUID,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Server } from "socket.io";
import {
  active,
  apply,
  createGame,
  remainingMs,
  tick,
  view,
  type Game,
  type Difficulty,
} from "../game-core";
import { decide } from "../game-ai";
import {
  social,
  socialView,
  chat,
  result,
  emptyStats,
  emojis,
  type SocialState,
  type Stats,
  type MatchMode,
} from "../game-social";
import type { RoomListing } from "../game-client/protocol";
import {
  newToken,
  hashToken,
  sessionToken,
  nickname,
  type IdentityAdapter,
} from "../identity-adapter";
export interface Member {
  id: string;
  name: string;
  ready: boolean;
  profile?: string;
  ai?: Difficulty;
  offlineSince?: number;
}
interface Room {
  id: string;
  version: number;
  code: string;
  name: string;
  host: string;
  max: number;
  allowAI: boolean;
  minutes: number;
  password?: string;
  kicked?: string[];
  members: Member[];
  game?: Game;
  requests: Record<string, boolean>;
  social?: SocialState;
  gameId?: string;
}
const dataDir = process.env.DATA_DIR || ".data";
mkdirSync(dataDir, { recursive: true });
const db = new DatabaseSync(resolve(dataDir, "earth.sqlite"));
db.exec(
  "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, id TEXT NOT NULL, name TEXT NOT NULL, expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS rooms(id TEXT PRIMARY KEY, json TEXT NOT NULL)",
);
if (
  !(db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[]).some(
    (c) => c.name === "profile",
  )
)
  db.exec("ALTER TABLE sessions ADD COLUMN profile TEXT");
const limits = new Map<string, { at: number; count: number }>();
function permit(key: string, max: number, window: number) {
  const now = Date.now();
  let v = limits.get(key);
  if (!v || now - v.at >= window) {
    v = { at: now, count: 0 };
    limits.set(key, v);
  }
  if (++v.count > max)
    throw new Error("요청이 너무 많습니다. 잠시 기다리세요.");
  if (limits.size > 10000)
    for (const [k, v] of limits) if (now - v.at > 600000) limits.delete(k);
}
db.exec(
  "CREATE TABLE IF NOT EXISTS command_results(user_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(user_id,request_id))",
);
const saveRoom = db.prepare("INSERT OR REPLACE INTO rooms VALUES (?,?)");
const rooms = new Map<string, Room>();
for (const row of db.prepare("SELECT json FROM rooms").all()) {
  const r = JSON.parse(row.json as string) as Room;
  r.version ??= 0;
  r.members.forEach((m) => {
    if (!m.ai) m.offlineSince = Date.now();
  });
  rooms.set(r.id, r);
}
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "8kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  if (
    req.method !== "GET" &&
    req.headers.origin &&
    new URL(req.headers.origin).host !== req.headers.host
  ) {
    res.status(403).json({ error: "동일 출처 요청만 허용합니다." });
    return;
  }
  next();
});
const server = createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 8192,
  allowRequest: (req, cb) => {
    try {
      cb(
        null,
        !req.headers.origin ||
          new URL(req.headers.origin).host === req.headers.host,
      );
    } catch {
      cb(null, false);
    }
  },
});
const presence = new Map<string, Set<string>>();
const queue: string[] = []; // Legacy clients retain their existing ten-second queue.
let matchAt = 0;
const queues: Record<MatchMode, string[]> = { quick: [], normal: [] };
const queuedAt = new Map<string, number>();
const emojiCatalog = process.env.EMOJI_CATALOG_FILE
  ? emojis(
      JSON.parse(readFileSync(resolve(process.env.EMOJI_CATALOG_FILE), "utf8")),
    )
  : undefined;
if (process.env.EMOJI_STATIC_DIR)
  app.use(
    "/site-emojis",
    express.static(resolve(process.env.EMOJI_STATIC_DIR), {
      index: false,
      dotfiles: "deny",
    }),
  );
function persist(r: Room) {
  saveRoom.run(r.id, JSON.stringify(r));
}
function findRoom(id: string) {
  return [...rooms.values()].find(
    (r) =>
      r.members.some((m) => m.id === id) ||
      social(r).spectators.some((p) => p.id === id),
  );
}
function session(cookie?: string) {
  const token = sessionToken(cookie);
  if (!token) return;
  return db
    .prepare("SELECT id,name,profile FROM sessions WHERE token=? AND expires>?")
    .get(hashToken(token), Date.now()) as
    { id: string; name: string } | undefined;
}
// Embedders can supply a verified identity adapter via createIdentityAdapter(). Standalone uses secure opaque sessions.
let external: IdentityAdapter | undefined;
if (process.env.IDENTITY_ADAPTER_MODULE) {
  const adapter = await import(resolve(process.env.IDENTITY_ADAPTER_MODULE));
  external = await adapter.createIdentityAdapter();
}
function checkedIdentity(identity: {
  id: string;
  name: string;
  profile?: string;
}) {
  if (
    typeof identity.id !== "string" ||
    !identity.id ||
    identity.id.length > 200
  )
    throw new Error("올바른 사이트 식별자가 필요합니다.");
  return {
    id: identity.id,
    name: nickname(identity.name),
    profile:
      typeof identity.profile === "string" &&
      (/^https:\/\//.test(identity.profile) ||
        /^\/(?!\/)/.test(identity.profile))
        ? identity.profile
        : null,
  };
}
app.post("/api/session", async (req, res) => {
  try {
    permit("session:" + req.socket.remoteAddress, 30, 600000);
    const existing = session(req.headers.cookie);
    if (!external && existing) {
      res.json(existing);
      return;
    }
    const resolved = external
      ? await external.resolve(req)
      : { id: randomUUID(), name: nickname(req.body?.name) };
    if (!resolved) {
      res.status(401).json({ error: "사이트에 먼저 로그인하세요." });
      return;
    }
    const identity = checkedIdentity(resolved);
    if (existing?.id === identity.id) {
      db.prepare("UPDATE sessions SET name=?,profile=? WHERE token=?").run(
        identity.name,
        identity.profile,
        hashToken(sessionToken(req.headers.cookie)),
      );
      res.json(identity);
      return;
    }
    const token = newToken();
    db.prepare(
      "INSERT INTO sessions(token,id,name,expires,profile) VALUES (?,?,?,?,?)",
    ).run(
      hashToken(token),
      identity.id,
      identity.name,
      Date.now() + 30 * 86400000,
      identity.profile,
    );
    res.cookie("earth_session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.COOKIE_SECURE === "true",
      maxAge: 30 * 86400000,
    });
    res.json(identity);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
  }
});
app.get("/api/config", (_req, res) =>
  res.json({ identityMode: external ? "external" : "standalone" }),
);
app.get("/api/me", async (req, res) => {
  try {
    const existing = session(req.headers.cookie);
    if (external) {
      const resolved = await external.resolve(req);
      if (!resolved || !existing || resolved.id !== existing.id) {
        res.status(401).json({ error: "사이트 로그인 확인이 필요합니다." });
        return;
      }
      const identity = checkedIdentity(resolved);
      db.prepare("UPDATE sessions SET name=?,profile=? WHERE token=?").run(
        identity.name,
        identity.profile,
        hashToken(sessionToken(req.headers.cookie)),
      );
      res.json(identity);
      return;
    }
    if (!existing) {
      res.status(401).json({ error: "닉네임을 설정하세요." });
      return;
    }
    res.json(existing);
  } catch {
    res.status(500).json({ error: "사이트 인증 확인에 실패했습니다." });
  }
});
app.get("/api/health", (_req, res) => res.json({ ok: true }));
db.exec(
  "CREATE TABLE IF NOT EXISTS game_results(game_id TEXT NOT NULL,user_id TEXT NOT NULL,size INTEGER NOT NULL,rank INTEGER NOT NULL,won INTEGER NOT NULL,finished_at INTEGER NOT NULL,PRIMARY KEY(game_id,user_id))",
);
const statsCache = new Map<string, Stats>();
function statsFor(id: string): Stats {
  const cached = statsCache.get(id);
  if (cached) return cached;
  const stats = emptyStats();
  for (const row of db
    .prepare(
      "SELECT size,COUNT(*) games,SUM(won) wins FROM game_results WHERE user_id=? GROUP BY size",
    )
    .all(id)) {
    const size = Number(row.size) as 2 | 3 | 4;
    if (![2, 3, 4].includes(size)) continue;
    stats[size] = {
      games: Number(row.games),
      wins: Number(row.wins),
      losses: Number(row.games) - Number(row.wins),
    };
  }
  statsCache.set(id, stats);
  return stats;
}
function recordResults(r: Room) {
  const s = social(r);
  if (!r.game || r.game.phase !== "finished" || s.resultsRecorded) return;
  db.exec("SAVEPOINT record_results");
  try {
    for (const p of r.game.players) {
      const record = result(r.game, p.id, r.gameId || r.id);
      if (!record) continue;
      db.prepare("INSERT OR IGNORE INTO game_results VALUES (?,?,?,?,?,?)").run(
        r.gameId || r.id,
        p.id,
        record.size,
        record.rank,
        record.win ? 1 : 0,
        Date.now(),
      );
      statsCache.delete(p.id);
    }
    db.exec("RELEASE record_results");
    s.resultsRecorded = true;
  } catch (e) {
    db.exec("ROLLBACK TO record_results; RELEASE record_results");
    statsCache.clear();
    throw e;
  }
}
app.get("/api/profile/:id", async (req, res) => {
  try {
    const me = session(req.headers.cookie);
    if (!me || (external && (await external.resolve(req))?.id !== me.id)) {
      res.status(401).json({ error: "로그인이 필요합니다." });
      return;
    }
    const id = String(req.params.id);
    const account = db
      .prepare(
        "SELECT name,profile FROM sessions WHERE id=? ORDER BY expires DESC LIMIT 1",
      )
      .get(id) as { name: string; profile?: string } | undefined;
    if (!account) {
      res.status(404).json({ error: "프로필을 찾을 수 없습니다." });
      return;
    }
    const linked = await external?.profile?.(id);
    const safe = (v: unknown) =>
      typeof v === "string" && (/^https:\/\//.test(v) || /^\/(?!\/)/.test(v))
        ? v
        : undefined;
    res.json({
      id,
      name: linked?.name ? nickname(linked.name) : account.name,
      profile: safe(linked?.profile) || account.profile,
      url: safe(linked?.url),
      stats: statsFor(id),
      source: "server",
    });
  } catch {
    res.status(500).json({ error: "프로필을 불러오지 못했습니다." });
  }
});
function publicRoom(r: Room, id: string) {
  const s = social(r),
    observer = s.spectators.find((p) => p.id === id);
  return {
    id: r.id,
    version: r.version,
    code: r.code,
    name: r.name,
    host: r.host,
    max: r.max,
    allowAI: r.allowAI,
    minutes: r.minutes,
    members: r.members.map((m) => ({
      ...m,
      stats: m.ai ? emptyStats() : statsFor(m.id),
    })),
    ...socialView(s, id),
    game: r.game ? view(r.game, observer?.watching || id) : undefined,
    result:
      r.game && !observer ? result(r.game, id, r.gameId || r.id) : undefined,
  };
}
function roomListings(): RoomListing[] {
  return [...rooms.values()]
    .filter((r) =>
      r.game
        ? r.game.phase !== "finished"
        : r.members.some((m) => m.id === r.host && !m.offlineSince),
    )
    .map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      hostName:
        r.members.find((m) => m.id === r.host)?.name || r.members[0].name,
      count: r.members.length,
      max: r.max,
      allowAI: r.allowAI,
      minutes: r.minutes,
      locked: !!r.password,
      playing: !!r.game,
      playerNames: r.members.map((m) => m.name),
      startedAt: social(r).startedAt,
      mode: social(r).mode,
    }))
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name, "ko") || a.code.localeCompare(b.code),
    );
}
let roomListFingerprint = "";
function announceRooms() {
  const list = roomListings(),
    fingerprint = JSON.stringify(list);
  if (fingerprint !== roomListFingerprint) {
    roomListFingerprint = fingerprint;
    io.emit("room-list", list);
  }
}
function send(id: string) {
  const r = findRoom(id);
  const mode: MatchMode | undefined = queues.quick.includes(id)
    ? "quick"
    : queues.normal.includes(id)
      ? "normal"
      : undefined;
  const waiting = mode ? queues[mode] : queue;
  io.to("user:" + id).emit("state", {
    room: r ? publicRoom(r, id) : null,
    matching: waiting.includes(id),
    count: waiting.length,
    matchAt,
    matchMode: mode,
    matchStartedAt:
      mode && waiting.length
        ? Math.min(...waiting.map((i) => queuedAt.get(i) ?? Date.now()))
        : undefined,
    serverNow: Date.now(),
  });
}
function broadcast(r: Room) {
  recordResults(r);
  persist(r);
  for (const m of [...r.members, ...social(r).spectators])
    if (!("ai" in m && m.ai)) send(m.id);
  announceRooms();
}
function roomChanged(r: Room) {
  r.version++;
  broadcast(r);
}
function queueState() {
  for (const id of [...queue, ...queues.quick, ...queues.normal]) send(id);
}
function cancel(id: string) {
  for (const mode of ["quick", "normal"] as const) {
    const j = queues[mode].indexOf(id);
    if (j >= 0) queues[mode].splice(j, 1);
  }
  queuedAt.delete(id);
  const i = queue.indexOf(id);
  if (i >= 0) queue.splice(i, 1);
  if (!queue.length) matchAt = 0;
  queueState();
}
function newRoom(
  user: { id: string; name: string },
  max: number,
  allowAI: boolean,
  minutes: number,
  password: string,
) {
  let code: string;
  do {
    code = randomBytes(3).toString("hex").toUpperCase();
  } while ([...rooms.values()].some((r) => r.code === code));
  const r: Room = {
    id: randomUUID(),
    version: 0,
    code,
    name: `${user.name}님의 방`,
    host: user.id,
    max,
    allowAI,
    minutes,
    password: password ? passwordHash(password) : undefined,
    members: [{ ...user, ready: false }],
    requests: {},
    social: { ...social({}), emojis: emojiCatalog || social({}).emojis },
  };
  rooms.set(r.id, r);
  return r;
}
function passwordHash(value: string) {
  const salt = randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(value, salt, 32).toString("hex");
}
function passwordOK(value: string, hash: string) {
  const [salt, key] = hash.split(":");
  return timingSafeEqual(scryptSync(value, salt, 32), Buffer.from(key, "hex"));
}
io.use(async (socket, next) => {
  const s = session(socket.request.headers.cookie);
  if (!s) return next(new Error("로그인이 필요합니다."));
  if (external) {
    try {
      const identity = await external.resolve(socket.request);
      if (!identity || identity.id !== s.id)
        return next(new Error("사이트 로그인 확인이 필요합니다."));
    } catch {
      return next(new Error("사이트 인증 확인에 실패했습니다."));
    }
  }
  socket.data.user = s;
  next();
});
io.on("connection", (socket) => {
  const user = socket.data.user as { id: string; name: string };
  socket.join("user:" + user.id);
  const set = presence.get(user.id) || new Set();
  set.add(socket.id);
  presence.set(user.id, set);
  const room = findRoom(user.id);
  if (room) {
    const member = room.members.find((m) => m.id === user.id);
    if (member) member.offlineSince = undefined;
    broadcast(room);
  } else send(user.id);

  socket.on("room-list", async (ack: unknown) => {
    if (typeof ack !== "function") return;
    try {
      permit("room-list:" + user.id, 30, 60000);
      if (session(socket.request.headers.cookie)?.id !== user.id)
        throw new Error("게임 세션이 만료됐습니다. 다시 접속하세요.");
      if (external && (await external.resolve(socket.request))?.id !== user.id)
        throw new Error("사이트 로그인 확인이 필요합니다.");
      ack({ ok: true, rooms: roomListings() });
    } catch (e) {
      ack({ ok: false, error: (e as Error).message });
    }
  });
  socket.on("command", async (input: unknown, ack: unknown) => {
    const reply = typeof ack === "function" ? ack : () => {};
    let inTransaction = false;
    let restore = () => {};
    try {
      if (session(socket.request.headers.cookie)?.id !== user.id)
        throw new Error("게임 세션이 만료됐습니다. 다시 접속하세요.");
      if (external && (await external.resolve(socket.request))?.id !== user.id)
        throw new Error("사이트 로그인 확인이 필요합니다.");
      const now = Date.now();
      permit("command:" + user.id, 60, 10000);
      if (!input || typeof input !== "object")
        throw new Error("잘못된 요청입니다.");
      const a = input as Record<string, any>;
      if (typeof a.type !== "string") throw new Error("잘못된 행동입니다.");
      if (
        typeof a.requestId !== "string" ||
        !a.requestId ||
        a.requestId.length > 80 ||
        !Number.isInteger(a.version)
      )
        throw new Error("요청 ID와 상태 버전이 필요합니다.");
      // Passwords stay protected by the room scrypt hash; do not create a
      // second, fast password-verification oracle in the replay ledger.
      const { password: _password, ...publicRequest } = a;
      const fingerprint = hashToken(JSON.stringify(publicRequest));
      const cached = db
        .prepare(
          "SELECT fingerprint FROM command_results WHERE user_id=? AND request_id=?",
        )
        .get(user.id, a.requestId);
      if (cached) {
        if (cached.fingerprint !== fingerprint)
          throw new Error("같은 요청 ID에 다른 내용을 보낼 수 없습니다.");
        send(user.id);
        reply({ ok: true, duplicate: true });
        return;
      }
      const r = findRoom(user.id);
      if (
        ["ready", "ai", "kick", "start", "leave"].includes(a.type) &&
        r &&
        a.version !== r.version &&
        !(
          a.type === "leave" &&
          social(r).spectators.some((p) => p.id === user.id)
        )
      )
        throw new Error("방 상태가 변경됐습니다. 다시 시도하세요.");
      const touched =
        r ??
        (a.type === "join"
          ? [...rooms.values()].find(
              (x) => x.code === String(a.code).toUpperCase(),
            )
          : undefined);
      const prior = touched ? structuredClone(touched) : undefined;
      const ids = new Set(rooms.keys()),
        priorQueue = [...queue],
        priorMatchAt = matchAt,
        priorQueues = structuredClone(queues),
        priorQueuedAt = new Map(queuedAt);
      restore = () => {
        for (const id of rooms.keys()) if (!ids.has(id)) rooms.delete(id);
        if (prior) rooms.set(prior.id, prior);
        queue.splice(0, queue.length, ...priorQueue);
        matchAt = priorMatchAt;
        queues.quick = priorQueues.quick;
        queues.normal = priorQueues.normal;
        queuedAt.clear();
        for (const [id, at] of priorQueuedAt) queuedAt.set(id, at);
      };
      db.exec("BEGIN IMMEDIATE");
      inTransaction = true;
      if (a.type === "match") {
        if (r) throw new Error("현재 방에서 먼저 나가세요.");
        if (a.mode !== undefined && a.mode !== "quick" && a.mode !== "normal")
          throw new Error("매칭 종류를 선택하세요.");
        if (a.mode) {
          cancel(user.id);
          queues[a.mode as MatchMode].push(user.id);
          queuedAt.set(user.id, now);
        } else {
          if (!queue.includes(user.id)) queue.push(user.id);
          if (!matchAt) matchAt = now + 10000;
        }
        queueState();
      } else if (a.type === "cancel") {
        cancel(user.id);
        send(user.id);
      } else if (a.type === "create") {
        if (r) throw new Error("이미 방에 참가 중입니다.");
        if (
          ![2, 3, 4].includes(a.max) ||
          typeof a.allowAI !== "boolean" ||
          ![10, 20, 30, 60].includes(a.minutes) ||
          typeof a.password !== "string" ||
          a.password.length > 64
        )
          throw new Error("방 설정을 확인하세요.");
        cancel(user.id);
        broadcast(newRoom(user, a.max, a.allowAI, a.minutes, a.password));
      } else if (a.type === "join") {
        if (r) throw new Error("이미 방에 참가 중입니다.");
        const target = [...rooms.values()].find(
          (x) => x.code === String(a.code).toUpperCase(),
        );
        if (
          !target ||
          target.game?.phase === "finished" ||
          (!target.game && target.members.length >= target.max)
        )
          throw new Error("입장할 수 없는 방입니다.");
        if (target.game && !a.spectate)
          throw new Error("진행 중인 방은 관전으로 입장하세요.");
        if (target.game && social(target).spectators.length >= 50)
          throw new Error("관전 정원이 찼습니다.");
        if (target.kicked?.includes(user.id))
          throw new Error("이 방에서 강퇴되어 다시 참가할 수 없습니다.");
        if (
          typeof a.password !== "string" ||
          a.password.length > 64 ||
          (target.password && !passwordOK(a.password, target.password))
        )
          throw new Error("비밀번호가 일치하지 않습니다.");
        cancel(user.id);
        if (target.game)
          social(target).spectators.push({
            ...user,
            watching: target.members[0].id,
          });
        else target.members.push({ ...user, ready: false });
        roomChanged(target);
      } else {
        if (!r) throw new Error("방에 먼저 참가하세요.");
        const s = social(r),
          observer = s.spectators.find((p) => p.id === user.id),
          member = r.members.find((p) => p.id === user.id);
        if (a.type === "return-room") {
          if (!member || s.mode !== "private" || r.game?.phase !== "finished")
            throw Error("종료된 개인 방에서만 돌아갈 수 있습니다.");
          recordResults(r);
          r.game = undefined;
          s.startedAt = undefined;
          s.resultsRecorded = false;
          r.members.forEach((m) => (m.ready = !!m.ai));
          roomChanged(r);
        } else if (a.type === "chat") {
          chat(s, observer || member!, !!observer, a, now);
          broadcast(r);
        } else if (a.type === "watch") {
          if (!observer || !r.game?.players.some((p) => p.id === a.player))
            throw new Error("관전할 대원을 선택하세요.");
          observer.watching = a.player;
          send(user.id);
          persist(r);
        } else if (a.type === "kick-spectator") {
          if (s.mode !== "private" || r.host !== user.id)
            throw new Error("개인 방의 방장만 관전자를 내보낼 수 있습니다.");
          if (!s.spectators.some((p) => p.id === a.member))
            throw new Error("관전자를 찾을 수 없습니다.");
          s.spectators = s.spectators.filter((p) => p.id !== a.member);
          (r.kicked ??= []).push(a.member);
          broadcast(r);
          send(a.member);
          io.to("user:" + a.member).emit(
            "kicked",
            "방장이 관전자를 내보냈습니다.",
          );
        } else if (a.type === "leave") {
          if (observer) {
            s.spectators = s.spectators.filter((p) => p.id !== user.id);
            broadcast(r);
            send(user.id);
          } else {
            if (r.game && r.game.phase !== "finished")
              throw new Error(
                "진행 중인 게임은 재접속할 수 있습니다. 종료 후 나가세요.",
              );
            r.members = r.members.filter((m) => m.id !== user.id);
            r.host = r.members.find((m) => !m.ai)?.id || "";
            if (!r.host) {
              rooms.delete(r.id);
              db.prepare("DELETE FROM rooms WHERE id=?").run(r.id);
              for (const spectator of social(r).spectators) send(spectator.id);
            } else roomChanged(r);
            send(user.id);
          }
        } else if (observer)
          throw new Error("관전자는 게임을 조작할 수 없습니다.");
        else if (a.type === "ready") {
          if (r.game) throw new Error("게임이 이미 시작됐습니다.");
          const m = r.members.find((m) => m.id === user.id)!;
          if (typeof a.ready !== "boolean")
            throw new Error("준비 상태가 필요합니다.");
          m.ready = a.ready;
          roomChanged(r);
        } else if (a.type === "kick") {
          if (
            r.game ||
            r.host !== user.id ||
            typeof a.member !== "string" ||
            a.member === r.host
          )
            throw new Error(
              "대기실에서 방장만 다른 대원을 내보낼 수 있습니다.",
            );
          const target = r.members.find((m) => m.id === a.member);
          if (!target) throw new Error("참가자를 찾을 수 없습니다.");
          r.members = r.members.filter((m) => m.id !== target.id);
          if (!target.ai) (r.kicked ??= []).push(target.id);
          roomChanged(r);
          if (!target.ai) {
            send(target.id);
            io.to("user:" + target.id).emit(
              "kicked",
              "방장이 대기실에서 내보냈습니다.",
            );
          }
        } else if (a.type === "ai") {
          if (
            r.game ||
            r.host !== user.id ||
            !r.allowAI ||
            r.members.length >= r.max ||
            !["easy", "normal", "hard"].includes(a.difficulty)
          )
            throw new Error("AI를 초대할 수 없습니다.");
          r.members.push({
            id: randomUUID(),
            name: `탐사봇 ${r.members.filter((m) => m.ai).length + 1}`,
            ai: a.difficulty,
            ready: true,
          });
          roomChanged(r);
        } else if (a.type === "start") {
          if (
            r.game ||
            r.host !== user.id ||
            r.members.length < 2 ||
            !r.members.every((m) => m.ready)
          )
            throw new Error("2명 이상, 전원 준비가 필요합니다.");
          r.gameId = randomUUID();
          r.game = createGame(r.members, now, randomInt, r.minutes);
          social(r).startedAt = now;
          roomChanged(r);
        } else if (a.type === "action") {
          if (
            !r.game ||
            typeof a.requestId !== "string" ||
            a.requestId.length > 80 ||
            !a.requestId ||
            !a.action ||
            typeof a.action !== "object"
          )
            throw new Error("잘못된 게임 요청입니다.");
          const key = user.id + ":" + a.requestId;
          if (r.requests[key]) {
            send(user.id);
            db.exec("COMMIT");
            inTransaction = false;
            reply({ ok: true, duplicate: true });
            return;
          }
          if (a.version !== r.game.version)
            throw new Error(
              "상태가 변경됐습니다. 최신 화면에서 다시 시도하세요.",
            );
          const next = structuredClone(r.game);
          apply(next, user.id, a.action, now, randomInt);
          next.version++;
          r.game = next;
          r.requests[key] = true;
          const keys = Object.keys(r.requests);
          if (keys.length > 2000) delete r.requests[keys[0]];
          broadcast(r);
        } else throw new Error("알 수 없는 명령입니다.");
      }
      db.prepare("INSERT INTO command_results VALUES (?,?,?)").run(
        user.id,
        a.requestId,
        fingerprint,
      );
      db.prepare(
        "DELETE FROM command_results WHERE user_id=? AND rowid NOT IN (SELECT rowid FROM command_results WHERE user_id=? ORDER BY rowid DESC LIMIT 2000)",
      ).run(user.id, user.id);
      db.exec("COMMIT");
      inTransaction = false;
      announceRooms();
      reply({ ok: true });
    } catch (e) {
      if (inTransaction) {
        db.exec("ROLLBACK");
        restore();
        statsCache.clear();
        announceRooms();
        queueState();
      }
      reply({ ok: false, error: (e as Error).message });
      send(user.id);
    }
  });
  socket.on("disconnect", () => {
    const set = presence.get(user.id);
    set?.delete(socket.id);
    if (set?.size) return;
    presence.delete(user.id);
    cancel(user.id);
    const r = findRoom(user.id);
    if (r) {
      const observer = social(r).spectators.find((p) => p.id === user.id);
      if (observer)
        social(r).spectators = social(r).spectators.filter(
          (p) => p.id !== user.id,
        );
      else r.members.find((m) => m.id === user.id)!.offlineSince = Date.now();
      broadcast(r);
    }
  });
});
let lastAI = 0;
setInterval(() => {
  const now = Date.now();
  let matchedNewQueue = false;
  for (const mode of ["quick", "normal"] as const) {
    const size = mode === "quick" ? 2 : 4;
    while (queues[mode].length >= size) {
      matchedNewQueue = true;
      const ids = queues[mode].splice(0, size);
      const people = ids.map(
        (id) =>
          db
            .prepare(
              "SELECT id,name,profile FROM sessions WHERE id=? ORDER BY expires DESC LIMIT 1",
            )
            .get(id) as { id: string; name: string },
      );
      const r = newRoom(people[0], size, false, 30, "");
      r.host = "";
      r.name = mode === "quick" ? "빠른게임 탐사대" : "일반게임 탐사대";
      r.members = people.map((p) => ({ ...p, ready: true }));
      social(r).mode = mode;
      social(r).startedAt = now;
      r.game = createGame(r.members, now, randomInt, 30);
      for (const id of ids) queuedAt.delete(id);
      broadcast(r);
    }
  }
  const waitingQuick = queues.quick[0];
  if (
    queues.quick.length === 1 &&
    now - (queuedAt.get(waitingQuick) ?? now) >= 60000
  ) {
    const person = db
      .prepare(
        "SELECT id,name,profile FROM sessions WHERE id=? ORDER BY expires DESC LIMIT 1",
      )
      .get(waitingQuick) as { id: string; name: string };
    const r = newRoom(person, 2, false, 30, "");
    r.host = "";
    r.name = "빠른게임 탐사대";
    r.members = [
      { ...person, ready: true },
      {
        id: `ai-${randomUUID()}`,
        name: "지구 탐사 AI · 어려움",
        ai: "hard",
        ready: true,
      },
    ];
    social(r).mode = "quick";
    social(r).startedAt = now;
    r.game = createGame(r.members, now, randomInt, 30);
    queues.quick.shift();
    queuedAt.delete(waitingQuick);
    broadcast(r);
    matchedNewQueue = true;
  }
  if (matchedNewQueue) queueState();
  if (matchAt && now >= matchAt) {
    while (queue.length >= 2) {
      const ids = queue.splice(0, 4);
      const people = ids.map(
        (id) =>
          db
            .prepare(
              "SELECT id,name,profile FROM sessions WHERE id=? ORDER BY expires DESC LIMIT 1",
            )
            .get(id) as { id: string; name: string },
      );
      const r = newRoom(people[0], people.length, false, 30, "");
      r.members = people.map((p) => ({ ...p, ready: true }));
      r.game = createGame(r.members, now, randomInt, 30);
      social(r).mode = r.members.length === 2 ? "quick" : "normal";
      social(r).startedAt = now;
      r.host = "";
      broadcast(r);
    }
    matchAt = queue.length ? now + 10000 : 0;
    queueState();
  }
  for (const r of rooms.values()) {
    if (!r.game) {
      const expired = r.members.filter(
        (m) => !m.ai && m.offlineSince && now - m.offlineSince >= 90000,
      );
      if (expired.length) {
        r.members = r.members.filter((m) => !expired.includes(m));
        r.host = r.members.find((m) => !m.ai)?.id || "";
        if (!r.host) {
          rooms.delete(r.id);
          db.prepare("DELETE FROM rooms WHERE id=?").run(r.id);
        } else roomChanged(r);
      }
      continue;
    }
    const g = r.game;
    if (g.phase === "finished") continue;
    let changed = tick(g, now, randomInt);
    const p = active(g),
      m = r.members.find((m) => m.id === p.id);
    if (
      !["animation", "moving", "reveal"].includes(g.phase) &&
      !g.winner &&
      (g.phase === "end" || remainingMs(g, now) > 0) &&
      now - lastAI >= 900 &&
      (p.ai || (m?.offlineSince && now - m.offlineSince >= 90000))
    ) {
      try {
        apply(g, p.id, decide(g, now), now, randomInt);
        changed = true;
      } catch (e) {
        console.error("AI decision failed", e);
      }
    }
    if (changed) {
      g.version++;
      broadcast(r);
    }
  }
  announceRooms();
  if (now - lastAI >= 900) lastAI = now;
}, 40).unref();
if (process.env.NODE_ENV === "production") {
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (_req, res) => res.sendFile(resolve("dist/index.html")));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}
const port = Number(process.env.PORT || 3000);
server.listen(port, "0.0.0.0", () =>
  console.log(`Earth Marble listening on port ${port}`),
);
