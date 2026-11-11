import { beforeAll, afterAll, it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { io, type Socket } from "socket.io-client";
const data = mkdtempSync(join(tmpdir(), "earth-social-")),
  clock = join(data, "clock"),
  url = "http://127.0.0.1:3214";
let now = 1900000000000,
  proc: ChildProcess;
type Client = { s: Socket; id: string; cookie: string; state: any };
const clients: Client[] = [];
async function wait(check: () => boolean) {
  const end = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > end) throw Error("Social timeout");
    await new Promise((r) => setTimeout(r, 25));
  }
}
async function launch() {
  mkdirSync(join(data, "emojis"), { recursive: true });
  writeFileSync(
    join(data, "emojis", "site.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg"><circle r="5"/></svg>',
  );
  writeFileSync(
    join(data, "emojis.json"),
    JSON.stringify([
      { id: "earth", label: "지구", text: "🌍" },
      { id: "site", label: "사이트", url: "/site-emojis/site.svg" },
    ]),
  );
  writeFileSync(clock, String(now));
  proc = spawn(
    process.execPath,
    [
      "--import",
      "./tests/fixtures/controlled-clock.mjs",
      "--import",
      "tsx",
      "game-server/index.ts",
    ],
    {
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: "3214",
        DATA_DIR: data,
        EARTH_TEST_CLOCK_FILE: clock,
        EMOJI_CATALOG_FILE: join(data, "emojis.json"),
        EMOJI_STATIC_DIR: join(data, "emojis"),
      },
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url + "/api/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw Error("server not ready");
}
async function stop() {
  if (proc.exitCode !== null) return;
  clients.forEach((c) => c.s.disconnect());
  const end = new Promise<void>((r) => proc.once("exit", () => r()));
  proc.kill("SIGTERM");
  await end;
}
async function connect(cookie: string, id: string) {
  const s = io(url, {
    extraHeaders: { cookie },
    transports: ["websocket"],
    forceNew: true,
  });
  const c = { s, id, cookie, state: undefined as any };
  clients.push(c);
  s.on("state", (v) => (c.state = v));
  await new Promise<void>((r, j) => {
    s.on("connect", () => r());
    s.on("connect_error", j);
  });
  await wait(() => !!c.state);
  return c;
}
async function user(name: string) {
  const r = await fetch(url + "/api/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  const a = await r.json();
  return connect(r.headers.get("set-cookie")!.split(";")[0], a.id);
}
async function cmd(c: Client, input: any) {
  for (let i = 0; i < 5; i++) {
    const request = {
      requestId: randomUUID(),
      version:
        input.type === "action"
          ? c.state.room.game.version
          : (c.state.room?.version ?? 0),
      ...input,
    };
    const out: any = await new Promise((r, j) =>
      c.s
        .timeout(5000)
        .emit("command", request, (e: Error, v: any) => (e ? j(e) : r(v))),
    );
    if (!out.ok && out.error.includes("방 상태가 변경")) {
      await wait(() => c.state.room.version !== request.version);
      continue;
    }
    return out;
  }
  throw Error("version timeout");
}
async function ok(c: Client, input: any) {
  const r = await cmd(c, input);
  expect(r.ok, r.error).toBe(true);
}
function advance(ms: number) {
  now += ms;
  writeFileSync(clock, String(now));
}
function mutate(id: string, edit: (r: any) => void) {
  const db = new DatabaseSync(join(data, "earth.sqlite"));
  const room = JSON.parse(
    (db.prepare("SELECT json FROM rooms WHERE id=?").get(id) as any).json,
  );
  edit(room);
  db.prepare("UPDATE rooms SET json=? WHERE id=?").run(
    JSON.stringify(room),
    id,
  );
  db.close();
}
beforeAll(launch);
afterAll(async () => {
  await stop();
  rmSync(data, { recursive: true, force: true });
});
it("관전은 선택한 손패만 보여주며 조작·채팅 간격·게임 중 강퇴를 서버가 검사한다", async () => {
  let A = await user("주인"),
    B = await user("대원"),
    C = await user("관전자");
  await ok(A, {
    type: "create",
    max: 2,
    minutes: 30,
    allowAI: false,
    password: "",
  });
  const code = A.state.room.code,
    id = A.state.room.id;
  expect(A.state.room.emojis).toContainEqual({
    id: "site",
    label: "사이트",
    url: "/site-emojis/site.svg",
  });
  expect((await fetch(url + "/site-emojis/site.svg")).status).toBe(200);
  await ok(B, { type: "join", code, password: "" });
  await ok(A, { type: "ready", ready: true });
  await ok(B, { type: "ready", ready: true });
  await ok(A, { type: "start" });
  await stop();
  mutate(id, (r) => {
    r.game.players[0].held = [24];
    r.game.players[1].held = [25];
    r.game.drawPile = r.game.drawPile.filter(
      (n: number) => n !== 24 && n !== 25,
    );
  });
  await launch();
  A = await connect(A.cookie, A.id);
  B = await connect(B.cookie, B.id);
  C = await connect(C.cookie, C.id);
  expect((await cmd(C, { type: "join", code, password: "" })).ok).toBe(false);
  await ok(C, { type: "join", code, password: "", spectate: true });
  expect(C.state.room.isSpectator).toBe(true);
  expect(C.state.room.game.players[0].held).toEqual([24]);
  expect(C.state.room.game.players[1].held).toEqual([]);
  await ok(C, { type: "watch", player: B.id });
  expect(C.state.room.game.players[0].held).toEqual([]);
  expect(C.state.room.game.players[1].held).toEqual([25]);
  expect(A.state.room.game.players[1].held).toEqual([]);
  expect((await cmd(C, { type: "action", action: { type: "roll" } })).ok).toBe(
    false,
  );
  await ok(C, {
    type: "chat",
    kind: "text",
    text: "관전 인사",
    spectator: false,
  });
  expect(C.state.room.chat.at(-1).spectator).toBe(true);
  advance(3000);
  expect((await cmd(C, { type: "chat", kind: "quick", quick: 0 })).ok).toBe(
    false,
  );
  advance(2000);
  await ok(C, { type: "chat", kind: "quick", quick: 0 });
  await ok(A, { type: "chat", kind: "text", text: "참가 인사" });
  advance(2999);
  expect(
    (await cmd(A, { type: "chat", kind: "text", text: "너무 빠름" })).ok,
  ).toBe(false);
  advance(1);
  await ok(A, { type: "chat", kind: "emoji", emoji: "site" });
  expect((await cmd(B, { type: "kick-spectator", member: C.id })).ok).toBe(
    false,
  );
  await ok(A, { type: "kick-spectator", member: C.id });
  await wait(() => !C.state.room);
  expect(
    (await cmd(C, { type: "join", code, password: "", spectate: true })).ok,
  ).toBe(false);
});
it("2·4인 대기열을 분리하고 정확한 인원이 모이면 방장 없는 퀵채팅 게임을 시작한다", async () => {
  const A = await user("일반1"),
    B = await user("일반2"),
    C = await user("빠른1"),
    D = await user("빠른2"),
    E = await user("일반3"),
    F = await user("일반4");
  await ok(A, { type: "match", mode: "normal" });
  await ok(B, { type: "match", mode: "normal" });
  await ok(C, { type: "match", mode: "quick" });
  await ok(D, { type: "match", mode: "quick" });
  await wait(() => !!C.state.room?.game);
  expect(C.state.room.members).toHaveLength(2);
  expect(C.state.room.host).toBe("");
  expect(A.state.matching).toBe(true);
  expect(A.state.count).toBe(2);
  expect((await cmd(C, { type: "chat", kind: "text", text: "제한" })).ok).toBe(
    false,
  );
  expect(
    (await cmd(C, { type: "chat", kind: "emoji", emoji: "earth" })).ok,
  ).toBe(false);
  await ok(C, { type: "chat", kind: "quick", quick: 0 });
  await ok(E, { type: "match", mode: "normal" });
  await wait(() => A.state.count === 3);
  expect(A.state.room).toBeNull();
  await ok(F, { type: "match", mode: "normal" });
  await wait(() => !!A.state.room?.game);
  expect(A.state.room.members).toHaveLength(4);
  expect(A.state.room.mode).toBe("normal");
  expect(A.state.room.host).toBe("");
  const S = await user("매칭관전");
  await ok(S, {
    type: "join",
    code: A.state.room.code,
    password: "",
    spectate: true,
  });
  expect((await cmd(S, { type: "chat", kind: "text", text: "제한" })).ok).toBe(
    false,
  );
  await ok(S, { type: "chat", kind: "quick", quick: 1 });
  expect(S.state.room.chat.at(-1).spectator).toBe(true);
  expect((await cmd(A, { type: "kick-spectator", member: S.id })).ok).toBe(
    false,
  );
});
it("종료 전적을 SQLite에 한 번만 저장하고 관전자·AI 싱글을 제외한다", async () => {
  let A = await user("전적1"),
    B = await user("전적2"),
    S = await user("전적관전");
  await ok(A, {
    type: "create",
    max: 2,
    minutes: 10,
    allowAI: false,
    password: "",
  });
  const id = A.state.room.id,
    code = A.state.room.code;
  await ok(B, { type: "join", code, password: "" });
  await ok(A, { type: "ready", ready: true });
  await ok(B, { type: "ready", ready: true });
  await ok(A, { type: "start" });
  await ok(S, { type: "join", code, password: "", spectate: true });
  await stop();
  mutate(id, (r) => {
    r.game.players[0].cash = 6000000;
    r.game.players[1].cash = 1000000;
    r.game.endsAt = now + 1000;
  });
  await launch();
  A = await connect(A.cookie, A.id);
  B = await connect(B.cookie, B.id);
  S = await connect(S.cookie, S.id);
  advance(1001);
  await wait(() => A.state.room.game.phase === "finished");
  const profile = async (c: Client) => {
    const r = await fetch(url + "/api/profile/" + c.id, {
      headers: { cookie: c.cookie },
    });
    expect(r.status).toBe(200);
    return r.json();
  };
  expect((await profile(A)).stats[2]).toEqual({ games: 1, wins: 1, losses: 0 });
  expect((await profile(B)).stats[2]).toEqual({ games: 1, wins: 0, losses: 1 });
  expect((await profile(S)).stats[2].games).toBe(0);
  expect(S.state.room.result).toBeUndefined();
  await stop();
  await launch();
  A = await connect(A.cookie, A.id);
  await ok(A, { type: "chat", kind: "quick", quick: 0 });
  expect((await profile(A)).stats[2].games).toBe(1);
  B = await connect(B.cookie, B.id);
  await ok(A, { type: "return-room" });
  expect(A.state.room.game).toBeUndefined();
  await ok(A, { type: "ready", ready: true });
  await ok(B, { type: "ready", ready: true });
  await ok(A, { type: "start" });
  await stop();
  mutate(id, (r) => (r.game.endsAt = now + 1000));
  await launch();
  A = await connect(A.cookie, A.id);
  advance(1001);
  await wait(() => A.state.room.game.phase === "finished");
  expect((await profile(A)).stats[2].games).toBe(2);
  const L = await user("AIのみ");
  await ok(L, {
    type: "create",
    max: 2,
    minutes: 10,
    allowAI: true,
    password: "",
  });
  const solo = L.state.room.id;
  await ok(L, { type: "ai", difficulty: "normal" });
  await ok(L, { type: "ready", ready: true });
  await ok(L, { type: "start" });
  await stop();
  mutate(solo, (r) => (r.game.endsAt = now + 1000));
  await launch();
  const R = await connect(L.cookie, L.id);
  advance(1001);
  await wait(() => R.state.room.game.phase === "finished");
  expect((await profile(R)).stats[2].games).toBe(0);
});
