import { beforeAll, afterAll, it, expect } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { io, type Socket } from "socket.io-client";
const data = mkdtempSync(join(tmpdir(), "earth-lifecycle-")),
  clock = join(data, "clock"),
  url = "http://127.0.0.1:3196";
let now = 1900000000000,
  proc: ChildProcess;
const clients: { s: Socket; id: string; cookie: string; state: any }[] = [];
function advance(value: number) {
  now = value;
  writeFileSync(clock, String(now));
}
async function wait(check: () => boolean) {
  const end = Date.now() + 8000;
  while (!check()) {
    if (Date.now() > end)
      throw new Error(
        "Lifecycle state timeout " +
          JSON.stringify(
            clients
              .filter((c) => c.s.connected)
              .map((c) => ({
                phase: c.state?.room?.game?.phase,
                turn: c.state?.room?.game?.turn,
                motion: c.state?.room?.game?.motion,
                players: c.state?.room?.game?.players.map((p: any) => ({
                  name: p.name,
                  position: p.position,
                })),
                log: c.state?.room?.game?.log.slice(-4),
              })),
          ),
      );
    await new Promise((r) => setTimeout(r, 25));
  }
}
async function finishMovement(c: { state: any }) {
  await wait(() => c.state.room.game.phase === "moving");
  for (let i = 0; i < 3; i++) {
    advance(now + 240);
    await wait(
      () =>
        c.state.room.game.phase !== "moving" ||
        c.state.room.game.motion.done >= i + 1,
    );
  }
}
// Poll real HTTP readiness without changing the logical server clock.
async function launch() {
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
        PORT: "3196",
        DATA_DIR: data,
        EARTH_TEST_CLOCK_FILE: clock,
        EARTH_TEST_FIXED_DICE: "true",
      },
      stdio: "ignore",
    },
  );
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(url + "/api/health")).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Lifecycle server not ready");
}
async function stop() {
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
  s.on("state", (state) => (c.state = state));
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
  const account = await r.json();
  return connect(r.headers.get("set-cookie")!.split(";")[0], account.id);
}
async function command(c: (typeof clients)[number], input: any): Promise<any> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const request = {
      requestId: randomUUID(),
      version:
        input.type === "action"
          ? c.state.room.game.version
          : (c.state.room?.version ?? 0),
      ...input,
    };
    const response = await new Promise<any>((r, j) =>
      c.s
        .timeout(5000)
        .emit("command", request, (e: Error, result: any) =>
          e ? j(e) : r(result),
        ),
    );
    if (
      !input.requestId &&
      !response.ok &&
      response.error.includes("방 상태가 변경")
    ) {
      await wait(() => c.state.room.version !== request.version);
      continue;
    }
    expect(response.ok, response.error).toBe(true);
    return { request, response };
  }
  throw new Error("Lifecycle room version not settled");
}
function raw(roomId: string) {
  const db = new DatabaseSync(join(data, "earth.sqlite"));
  const value = JSON.parse(
    (db.prepare("SELECT json FROM rooms WHERE id=?").get(roomId) as any).json,
  );
  db.close();
  return value;
}
function save(room: any) {
  const db = new DatabaseSync(join(data, "earth.sqlite"));
  db.prepare("UPDATE rooms SET json=? WHERE id=?").run(
    JSON.stringify(room),
    room.id,
  );
  db.close();
}
beforeAll(async () => {
  advance(now);
  await launch();
});
afterAll(async () => {
  await stop();
  rmSync(data, { recursive: true, force: true });
});
it("대기실 90초 유예 경계와 방장 이전", async () => {
  const A = await user("유예A"),
    B = await user("유예B");
  await command(A, {
    type: "create",
    max: 2,
    minutes: 30,
    allowAI: false,
    password: "",
  });
  await command(B, { type: "join", code: A.state.room.code, password: "" });
  A.s.disconnect();
  await wait(
    () => !!B.state.room.members.find((m: any) => m.id === A.id)?.offlineSince,
  );
  const offline = B.state.room.members.find(
    (m: any) => m.id === A.id,
  ).offlineSince;
  advance(offline + 89999);
  await command(B, { type: "ready", ready: true });
  expect(B.state.room.members).toHaveLength(2);
  expect(B.state.room.host).toBe(A.id);
  advance(offline + 90000);
  await wait(() => B.state.room.members.length === 1);
  expect(B.state.room.host).toBe(B.id);
  const reconnected = await connect(A.cookie, A.id);
  expect(reconnected.state.room).toBeNull();
});
it("90초 이후 자동 행동, 재접속 시 제어 복귀와 정산 중복 방지", async () => {
  let A = await user("게임A"),
    B = await user("게임B");
  await command(A, {
    type: "create",
    max: 2,
    minutes: 30,
    allowAI: false,
    password: "",
  });
  await command(B, { type: "join", code: A.state.room.code, password: "" });
  await command(A, { type: "ready", ready: true });
  await command(B, { type: "ready", ready: true });
  await command(A, { type: "start" });
  const base = now;
  A.s.disconnect();
  await wait(() => !!B.state.room.members[0].offlineSince);
  advance(base + 89999);
  await wait(() => B.state.room.game.phase === "animation");
  expect(B.state.room.game.players[0].ai).toBeUndefined();
  advance(base + 92400);
  await finishMovement(B);
  advance(now + 1000);
  await wait(
    () => B.state.room.game.players[B.state.room.game.turn].id === B.id,
  );
  expect(B.state.room.game.players[0].position).toBe(3);
  expect(B.state.room.game.estates[3]).toBeUndefined();
  // The expired roll gets no extra purchase budget. Give B a normal turn,
  // then verify the disconnected A takes its next fresh turn automatically.
  await command(B, { type: "action", action: { type: "roll" } });
  advance(now + 2400);
  await finishMovement(B);
  await wait(() => B.state.room.game.phase === "purchase");
  await command(B, { type: "action", action: { type: "skip" } });
  await wait(
    () =>
      B.state.room.game.players[B.state.room.game.turn].id === A.id &&
      B.state.room.game.phase === "roll",
  );
  advance(now + 1000);
  await wait(() => B.state.room.game.phase === "animation");
  advance(now + 2400);
  await finishMovement(B);
  advance(now + 1000);
  await wait(
    () => B.state.room.game.players[B.state.room.game.turn].id === B.id,
  );
  expect(B.state.room.game.estates[6].owner).toBe(A.id);
  A = await connect(A.cookie, A.id);
  expect(
    A.state.room.members.find((m: any) => m.id === A.id).offlineSince,
  ).toBeUndefined();
  await command(B, { type: "action", action: { type: "roll" } });
  advance(now + 2400);
  await finishMovement(B);
  await wait(
    () =>
      A.state.room.game.players[A.state.room.game.turn].id === A.id &&
      A.state.room.game.phase === "roll",
  );
  expect(A.state.room.game.players[0].cash).toBe(1406000);
  expect(A.state.room.game.players[1].cash).toBe(1494000);
  advance(now + 1000);
  await command(A, { type: "action", action: { type: "roll" } });
  expect(A.state.room.game.phase).toBe("animation");
});
it("보관 카드·덱 순서·미완료 통행료를 저장 후 복구하고 한 번만 지급한다", async () => {
  let A = await user("저장A"),
    B = await user("저장B");
  await command(A, {
    type: "create",
    max: 2,
    minutes: 30,
    allowAI: false,
    password: "",
  });
  await command(B, { type: "join", code: A.state.room.code, password: "" });
  await command(A, { type: "ready", ready: true });
  await command(B, { type: "ready", ready: true });
  await command(A, { type: "start" });
  const id = A.state.room.id;
  await stop();
  const snapshot = raw(id),
    g = snapshot.game;
  g.turn = 1;
  g.phase = "toll";
  g.players[1].position = 3;
  g.players[0].held = [24];
  g.players[1].held = [25];
  g.estates[3] = { owner: A.id, buildings: [false, false, false] };
  g.payment = { amount: 4000, to: A.id };
  g.drawPile = g.drawPile.filter((i: number) => i !== 24 && i !== 25);
  g.discardPile = g.discardPile.filter((i: number) => i !== 24 && i !== 25);
  g.deadline = now + 60000;
  delete g.pausedAt;
  save(snapshot);
  const order = [...g.drawPile];
  await launch();
  A = await connect(A.cookie, A.id);
  B = await connect(B.cookie, B.id);
  expect(A.state.room.game.players[0].held).toEqual([24]);
  expect(A.state.room.game.players[1].held).toEqual([]);
  expect(B.state.room.game.players[1].held).toEqual([25]);
  expect(B.state.room.game.players[0].held).toEqual([]);
  expect(B.state.room.game.payment.amount).toBe(4000);
  expect(raw(id).game.drawPile).toEqual(order);
  const { request } = await command(B, {
    type: "action",
    action: { type: "pay" },
  });
  const again = await command(B, request);
  expect(again.response.duplicate).toBe(true);
  expect(B.state.room.game.players[0].cash).toBe(1504000);
  expect(B.state.room.game.players[1].cash).toBe(1496000);
  expect(raw(id).game.drawPile).toEqual(order);
});
