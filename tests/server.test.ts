import { beforeAll, afterAll, it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { io, type Socket } from "socket.io-client";
const url = "http://127.0.0.1:3197",
  data = mkdtempSync(join(tmpdir(), "earth-test-"));
const snapshots = new WeakMap<Socket, any>(),
  users = new WeakMap<Socket, string>();
let proc: ChildProcess,
  logs = "",
  sockets: Socket[] = [];
async function start() {
  proc = spawn(process.execPath, ["--import", "tsx", "game-server/index.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: "3197",
      DATA_DIR: data,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout!.on("data", (x) => (logs += x));
  proc.stderr!.on("data", (x) => (logs += x));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url + "/api/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(logs);
}
async function stop() {
  const exit = new Promise<void>((r) => proc.once("exit", () => r()));
  proc.kill("SIGTERM");
  await exit;
}
async function identity(name: string) {
  const r = await fetch(url + "/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(r.status).toBe(200);
  return {
    ...(await r.json()),
    cookie: r.headers.get("set-cookie")!.split(";")[0],
  };
}
async function connect(cookie: string) {
  const account = await (
    await fetch(url + "/api/me", { headers: { cookie } })
  ).json();
  const s = io(url, {
    extraHeaders: { cookie },
    transports: ["websocket"],
    forceNew: true,
  });
  sockets.push(s);
  const states: any[] = [];
  users.set(s, account.id);
  s.on("state", (v) => {
    states.push(v);
    snapshots.set(s, v);
  });
  await new Promise<void>((r, j) => {
    s.on("connect", () => r());
    s.on("connect_error", j);
  });
  return { s, states };
}
async function cmd(s: Socket, data: any): Promise<any> {
  const snapshot = snapshots.get(s);
  const intended =
    data.type === "ready"
      ? {
          ready: !snapshot?.room?.members.find(
            (m: any) => m.id === users.get(s),
          )?.ready,
          ...data,
        }
      : data;
  for (let retry = 0; retry < 5; retry++) {
    const request = {
      requestId: randomUUID(),
      version: snapshots.get(s)?.room?.version ?? 0,
      ...intended,
    };
    const result = await new Promise<any>((r, j) =>
      s
        .timeout(8000)
        .emit("command", request, (e: Error, v: any) => (e ? j(e) : r(v))),
    );
    if (
      !data.requestId &&
      !result.ok &&
      result.error.includes("방 상태가 변경")
    ) {
      await until(() => snapshots.get(s)?.room?.version !== request.version);
      continue;
    }
    return result;
  }
  throw new Error("Room version did not settle");
}
async function until(check: () => boolean, ms = 15000) {
  const until = Date.now() + ms;
  while (!check()) {
    if (Date.now() > until) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
}
beforeAll(start);
afterAll(async () => {
  sockets.forEach((s) => s.disconnect());
  await stop();
  rmSync(data, { recursive: true, force: true });
});
it("독립 세션, 비밀번호 방, 정원/준비/권한/동시성, 재접속과 SQLite 재시작 복구", async () => {
  const a = await identity("탐사자"),
    b = await identity("탐사자"),
    c = await identity("우주");
  expect(a.id).not.toBe(b.id);
  const A = await connect(a.cookie),
    B = await connect(b.cookie),
    C = await connect(c.cookie);
  expect((await fetch(url + "/api/me")).status).toBe(401);
  expect(
    (
      await cmd(A.s, {
        type: "create",
        max: 2,
        minutes: 30,
        allowAI: true,
        password: "ocean",
      })
    ).ok,
  ).toBe(true);
  await until(() => !!A.states.at(-1)?.room);
  const code = A.states.at(-1).room.code;
  expect((await cmd(B.s, { type: "join", code, password: "wrong" })).ok).toBe(
    false,
  );
  expect((await cmd(B.s, { type: "join", code, password: "ocean" })).ok).toBe(
    true,
  );
  expect((await cmd(C.s, { type: "join", code, password: "ocean" })).ok).toBe(
    false,
  );
  expect((await cmd(B.s, { type: "start" })).ok).toBe(false);
  expect((await cmd(A.s, { type: "start" })).ok).toBe(false);
  await cmd(A.s, { type: "ready" });
  await cmd(B.s, { type: "ready" });
  expect((await cmd(A.s, { type: "start" })).ok).toBe(true);
  await until(() => !!B.states.at(-1)?.room.game);
  const g = A.states.at(-1).room.game;
  expect(g.players.map((p: any) => p.cash)).toEqual([1500000, 1500000]);
  expect(g.drawPile).toBeUndefined();
  expect(g.drawCount).toBe(30);
  expect(
    (
      await cmd(B.s, {
        type: "action",
        requestId: "spoof",
        version: g.version,
        action: { type: "roll", cash: 99999999 },
      })
    ).ok,
  ).toBe(false);
  const request = {
    type: "action",
    requestId: "only-once",
    version: g.version,
    action: { type: "roll" },
  };
  expect((await cmd(A.s, request)).ok).toBe(true);
  expect((await cmd(A.s, request)).duplicate).toBe(true);
  expect((await cmd(A.s, { ...request, requestId: "stale" })).ok).toBe(false);
  await until(() => {
    const g = A.states.at(-1)?.room.game;
    return (
      g &&
      !["animation", "moving", "reveal", "end"].includes(g.phase) &&
      !(g.payment && g.players[g.turn].cash >= g.payment.amount)
    );
  }, 40000);
  const latest = A.states.at(-1).room.game;
  A.s.disconnect();
  const reconnect = await connect(a.cookie);
  await until(() => !!reconnect.states.at(-1)?.room?.game);
  expect(reconnect.states.at(-1).room.game.players).toEqual(latest.players);
  expect(reconnect.states.at(-1).room.game.dice).toEqual(latest.dice);
  sockets.forEach((s) => s.disconnect());
  await stop();
  await start();
  const restored = await connect(a.cookie);
  await until(() => !!restored.states.at(-1)?.room?.game);
  expect(restored.states.at(-1).room.game.players).toEqual(latest.players);
  expect(restored.states.at(-1).room.game.version).toBe(latest.version);
}, 60000);

it("10초 단위 실제 사용자 매칭과 취소, AI 없이 동일 방 배정", async () => {
  const a = await identity("매칭A"),
    b = await identity("매칭B");
  const A = await connect(a.cookie),
    B = await connect(b.cookie);
  await cmd(A.s, { type: "match" });
  await until(() => A.states.at(-1)?.matching);
  const deadline = A.states.at(-1).matchAt;
  await cmd(B.s, { type: "match" });
  await until(() => A.states.at(-1)?.count === 2);
  expect(A.states.at(-1).room).toBeNull();
  await until(() => !!A.states.at(-1)?.room?.game, 12000);
  await until(() => !!B.states.at(-1)?.room?.game);
  expect(Date.now()).toBeGreaterThanOrEqual(deadline);
  expect(A.states.at(-1).room.id).toBe(B.states.at(-1).room.id);
  expect(A.states.at(-1).room.members.every((m: any) => !m.ai)).toBe(true);
  const c = await identity("취소");
  const C = await connect(c.cookie);
  await cmd(C.s, { type: "match" });
  await cmd(C.s, { type: "cancel" });
  await until(() => C.states.at(-1)?.matching === false);
  expect(C.states.at(-1).room).toBeNull();
});
it("AI 초대와 3인 연구비, 비방장 초대 거부", async () => {
  const a = await identity("AI방장");
  const A = await connect(a.cookie);
  await cmd(A.s, {
    type: "create",
    max: 3,
    minutes: 10,
    allowAI: true,
    password: "",
  });
  await cmd(A.s, { type: "ai", difficulty: "easy" });
  await cmd(A.s, { type: "ai", difficulty: "hard" });
  expect((await cmd(A.s, { type: "ai", difficulty: "normal" })).ok).toBe(false);
  await cmd(A.s, { type: "ready" });
  await cmd(A.s, { type: "start" });
  await until(() => !!A.states.at(-1)?.room?.game);
  expect(A.states.at(-1).room.game.players.map((p: any) => p.cash)).toEqual([
    3000000, 3000000, 3000000,
  ]);
});
it("4인 동시 연결의 실제 상태 동기화와 연구비", async () => {
  const people = await Promise.all(["하나", "둘", "셋", "넷"].map(identity));
  const clients = await Promise.all(people.map((p) => connect(p.cookie)));
  await cmd(clients[0].s, {
    type: "create",
    max: 4,
    minutes: 30,
    allowAI: false,
    password: "",
  });
  await until(() => !!clients[0].states.at(-1)?.room);
  const code = clients[0].states.at(-1).room.code;
  const joined = await Promise.all(
    clients.slice(1).map((c) => cmd(c.s, { type: "join", code, password: "" })),
  );
  expect(joined.every((r) => r.ok)).toBe(true);
  await Promise.all(clients.map((c) => cmd(c.s, { type: "ready" })));
  await cmd(clients[0].s, { type: "start" });
  await until(() => clients.every((c) => !!c.states.at(-1)?.room?.game));
  const rooms = clients.map((c) => c.states.at(-1).room);
  expect(new Set(rooms.map((r) => r.id)).size).toBe(1);
  for (const r of rooms)
    expect(r.game.players.map((p: any) => p.cash)).toEqual([
      3000000, 3000000, 3000000, 3000000,
    ]);
});

it("대기실 요청 ID 중복·내용 충돌·버전 충돌과 재시작 후 중복 방지", async () => {
  const user = await identity("중복 점검");
  let A = await connect(user.cookie);
  await cmd(A.s, {
    type: "create",
    max: 4,
    minutes: 30,
    allowAI: true,
    password: "",
  });
  const request = {
    type: "ai",
    difficulty: "hard",
    requestId: "invite-once",
    version: snapshots.get(A.s).room.version,
  };
  expect((await cmd(A.s, request)).ok).toBe(true);
  expect((await cmd(A.s, request)).duplicate).toBe(true);
  expect(snapshots.get(A.s).room.members).toHaveLength(2);
  expect((await cmd(A.s, { ...request, difficulty: "easy" })).ok).toBe(false);
  expect(
    (
      await cmd(A.s, {
        type: "ai",
        difficulty: "easy",
        requestId: "stale-room",
        version: request.version,
      })
    ).ok,
  ).toBe(false);
  const ready = {
    type: "ready",
    ready: true,
    requestId: "ready-once",
    version: snapshots.get(A.s).room.version,
  };
  await cmd(A.s, ready);
  expect((await cmd(A.s, ready)).duplicate).toBe(true);
  expect(snapshots.get(A.s).room.members[0].ready).toBe(true);
  sockets.forEach((s) => s.disconnect());
  await stop();
  await start();
  A = await connect(user.cookie);
  await until(() => !!snapshots.get(A.s)?.room);
  expect((await cmd(A.s, request)).duplicate).toBe(true);
  expect(snapshots.get(A.s).room.members).toHaveLength(2);
});
it("3인 자동 매칭은 검사 구간이 끝날 때 시작한다", async () => {
  const people = await Promise.all(["셋A", "셋B", "셋C"].map(identity));
  const clients = await Promise.all(people.map((p) => connect(p.cookie)));
  for (const c of clients) await cmd(c.s, { type: "match" });
  const deadline = snapshots.get(clients[0].s).matchAt;
  expect(clients.every((c) => !snapshots.get(c.s).room)).toBe(true);
  await until(
    () => clients.every((c) => !!snapshots.get(c.s)?.room?.game),
    12000,
  );
  expect(Date.now()).toBeGreaterThanOrEqual(deadline);
  expect(new Set(clients.map((c) => snapshots.get(c.s).room.id)).size).toBe(1);
  expect(snapshots.get(clients[0].s).room.members).toHaveLength(3);
});
it("4인이 모여도 조기 시작하지 않고 여러 그룹을 중복 없이 배정한다", async () => {
  const people = await Promise.all(
    Array.from({ length: 8 }, (_, i) => identity("그룹" + i)),
  );
  const clients = await Promise.all(people.map((p) => connect(p.cookie)));
  for (const c of clients) await cmd(c.s, { type: "match" });
  const deadline = snapshots.get(clients[0].s).matchAt;
  expect(clients.every((c) => !snapshots.get(c.s).room)).toBe(true);
  await until(
    () => clients.every((c) => !!snapshots.get(c.s)?.room?.game),
    12000,
  );
  expect(Date.now()).toBeGreaterThanOrEqual(deadline);
  const groups = new Map<string, string[]>();
  for (const c of clients) {
    const r = snapshots.get(c.s).room;
    groups.set(
      r.id,
      r.members.map((m: any) => m.id),
    );
  }
  expect(groups.size).toBe(2);
  expect([...groups.values()].every((g) => g.length === 4)).toBe(true);
  expect(new Set([...groups.values()].flat()).size).toBe(8);
});

it("방장만 대기실 사람·AI를 강퇴하며 재입장과 중복 명령을 처리한다", async () => {
  const a = await identity("강퇴방장"),
    b = await identity("강퇴손님");
  const A = await connect(a.cookie),
    B = await connect(b.cookie);
  expect(
    (
      await cmd(A.s, {
        type: "create",
        max: 4,
        minutes: 10,
        allowAI: true,
        password: "earth",
      })
    ).ok,
  ).toBe(true);
  const code = A.states.at(-1).room.code;
  expect((await cmd(B.s, { type: "join", code, password: "earth" })).ok).toBe(
    true,
  );
  expect((await cmd(B.s, { type: "kick", member: a.id })).ok).toBe(false);
  expect((await cmd(A.s, { type: "kick", member: a.id })).ok).toBe(false);
  expect((await cmd(A.s, { type: "ai", difficulty: "normal" })).ok).toBe(true);
  const bot = A.states.at(-1).room.members.find((m: any) => m.ai);
  expect((await cmd(B.s, { type: "kick", member: bot.id })).ok).toBe(false);
  expect((await cmd(A.s, { type: "kick", member: bot.id })).ok).toBe(true);
  const kick = {
    type: "kick",
    member: b.id,
    requestId: randomUUID(),
    version: A.states.at(-1).room.version,
  };
  expect((await cmd(A.s, kick)).ok).toBe(true);
  await until(() => B.states.at(-1)?.room === null);
  expect((await cmd(A.s, kick)).duplicate).toBe(true);
  expect((await cmd(B.s, { type: "join", code, password: "earth" })).ok).toBe(
    false,
  );
  expect(A.states.at(-1).room.members).toHaveLength(1);
  expect(A.states.at(-1).room.kicked).toBeUndefined();
  await cmd(A.s, { type: "ai", difficulty: "easy" });
  await cmd(A.s, { type: "ready" });
  await cmd(A.s, { type: "start" });
  expect(
    (
      await cmd(A.s, {
        type: "kick",
        member: A.states.at(-1).room.members[1].id,
      })
    ).ok,
  ).toBe(false);
});

it("방 목록은 공개 대기실 정보만 반환하고 정원·시작·나가기를 반영한다", async () => {
  const a = await identity("목록주인"),
    b = await identity("목록방문"),
    c = await identity("닫을방");
  const A = await connect(a.cookie),
    B = await connect(b.cookie),
    C = await connect(c.cookie);
  const list = (s: Socket) =>
    new Promise<any>((resolve, reject) =>
      s
        .timeout(5000)
        .emit("room-list", (error: Error | null, value: any) =>
          error ? reject(error) : resolve(value),
        ),
    );
  await cmd(A.s, {
    type: "create",
    max: 2,
    minutes: 20,
    allowAI: true,
    password: "secret",
  });
  const code = A.states.at(-1).room.code;
  let result = await list(B.s);
  expect(result.ok).toBe(true);
  let row = result.rooms.find((r: any) => r.code === code);
  expect(row).toMatchObject({
    name: "목록주인님의 방",
    hostName: "목록주인",
    count: 1,
    max: 2,
    minutes: 20,
    allowAI: true,
    locked: true,
  });
  expect(Object.keys(row).sort()).toEqual(
    [
      "id",
      "code",
      "name",
      "hostName",
      "count",
      "max",
      "minutes",
      "allowAI",
      "locked",
    ].sort(),
  );
  expect(JSON.stringify(row)).not.toContain("secret");
  await cmd(A.s, { type: "ai", difficulty: "normal" });
  row = (await list(B.s)).rooms.find((r: any) => r.code === code);
  expect(row.count).toBe(2);
  const bot = A.states.at(-1).room.members.find((m: any) => m.ai);
  await cmd(A.s, { type: "kick", member: bot.id });
  expect(
    (await cmd(B.s, { type: "join", code: row.code, password: "secret" })).ok,
  ).toBe(true);
  await cmd(A.s, { type: "ready" });
  await cmd(B.s, { type: "ready" });
  await cmd(A.s, { type: "start" });
  expect((await list(C.s)).rooms.some((r: any) => r.code === code)).toBe(false);
  await cmd(C.s, {
    type: "create",
    max: 4,
    minutes: 10,
    allowAI: false,
    password: "",
  });
  const closed = C.states.at(-1).room.code;
  expect((await list(A.s)).rooms.some((r: any) => r.code === closed)).toBe(
    true,
  );
  await cmd(C.s, { type: "leave" });
  expect((await list(A.s)).rooms.some((r: any) => r.code === closed)).toBe(
    false,
  );
});
