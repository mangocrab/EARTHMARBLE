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
import { mkdirSync } from "node:fs";
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
  members: Member[];
  game?: Game;
  requests: Record<string, boolean>;
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
const queue: string[] = [];
let matchAt = 0;
function persist(r: Room) {
  saveRoom.run(r.id, JSON.stringify(r));
}
function findRoom(id: string) {
  return [...rooms.values()].find((r) => r.members.some((m) => m.id === id));
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
function publicRoom(r: Room, id: string) {
  return {
    id: r.id,
    version: r.version,
    code: r.code,
    name: r.name,
    host: r.host,
    max: r.max,
    allowAI: r.allowAI,
    minutes: r.minutes,
    members: r.members,
    game: r.game ? view(r.game, id) : undefined,
  };
}
function send(id: string) {
  const r = findRoom(id);
  io.to("user:" + id).emit("state", {
    room: r ? publicRoom(r, id) : null,
    matching: queue.includes(id),
    count: queue.length,
    matchAt,
    serverNow: Date.now(),
  });
}
function broadcast(r: Room) {
  persist(r);
  for (const m of r.members) if (!m.ai) send(m.id);
}
function roomChanged(r: Room) {
  r.version++;
  broadcast(r);
}
function queueState() {
  for (const id of queue) send(id);
}
function cancel(id: string) {
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
    room.members.find((m) => m.id === user.id)!.offlineSince = undefined;
    broadcast(room);
  } else send(user.id);

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
        ["ready", "ai", "start", "leave"].includes(a.type) &&
        r &&
        a.version !== r.version
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
        priorMatchAt = matchAt;
      restore = () => {
        for (const id of rooms.keys()) if (!ids.has(id)) rooms.delete(id);
        if (prior) rooms.set(prior.id, prior);
        queue.splice(0, queue.length, ...priorQueue);
        matchAt = priorMatchAt;
      };
      db.exec("BEGIN IMMEDIATE");
      inTransaction = true;
      if (a.type === "match") {
        if (r) throw new Error("현재 방에서 먼저 나가세요.");
        if (!queue.includes(user.id)) queue.push(user.id);
        if (!matchAt) matchAt = now + 10000;
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
        if (!target || target.game || target.members.length >= target.max)
          throw new Error("입장할 수 없는 방입니다.");
        if (
          typeof a.password !== "string" ||
          a.password.length > 64 ||
          (target.password && !passwordOK(a.password, target.password))
        )
          throw new Error("비밀번호가 일치하지 않습니다.");
        cancel(user.id);
        target.members.push({ ...user, ready: false });
        roomChanged(target);
      } else {
        if (!r) throw new Error("방에 먼저 참가하세요.");
        if (a.type === "leave") {
          if (r.game && r.game.phase !== "finished")
            throw new Error(
              "진행 중인 게임은 재접속할 수 있습니다. 종료 후 나가세요.",
            );
          r.members = r.members.filter((m) => m.id !== user.id);
          r.host = r.members.find((m) => !m.ai)?.id || "";
          if (!r.host) {
            rooms.delete(r.id);
            db.prepare("DELETE FROM rooms WHERE id=?").run(r.id);
          } else roomChanged(r);
          send(user.id);
        } else if (a.type === "ready") {
          if (r.game) throw new Error("게임이 이미 시작됐습니다.");
          const m = r.members.find((m) => m.id === user.id)!;
          if (typeof a.ready !== "boolean")
            throw new Error("준비 상태가 필요합니다.");
          m.ready = a.ready;
          roomChanged(r);
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
          r.game = createGame(r.members, now, randomInt, r.minutes);
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
      reply({ ok: true });
    } catch (e) {
      if (inTransaction) {
        db.exec("ROLLBACK");
        restore();
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
      r.members.find((m) => m.id === user.id)!.offlineSince = Date.now();
      broadcast(r);
    }
  });
});
let lastAI = 0;
setInterval(() => {
  const now = Date.now();
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
      g.phase !== "animation" &&
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
  if (now - lastAI >= 900) lastAI = now;
}, 200).unref();
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
