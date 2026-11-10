import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { io, type Socket } from "socket.io-client";
import { createGame, land } from "../../game-core";
test("열린 증서의 건설·매각·파산 동기화, 카드 안내와 자산 내역", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const data = mkdtempSync(join(tmpdir(), "earth-browser-sync-")),
    url = "http://127.0.0.1:3202";
  let proc: ChildProcess | undefined, socket: Socket | undefined, state: any;
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
          DATA_DIR: data,
          PORT: "3202",
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
    throw new Error("Sync fixture startup failed");
  }
  async function stop() {
    if (proc && proc.exitCode === null) {
      const ended = new Promise<void>((r) => proc!.once("exit", () => r()));
      proc.kill("SIGTERM");
      await ended;
    }
  }
  async function until(check: () => boolean) {
    const end = Date.now() + 10000;
    while (!check()) {
      if (Date.now() > end) throw new Error("Sync state timeout");
      await new Promise((r) => setTimeout(r, 30));
    }
  }
  const a = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
    }),
    b = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
  try {
    await launch();
    const ar = await a.request.post(url + "/api/session", {
        data: { name: "증서A" },
      }),
      br = await b.request.post(url + "/api/session", {
        data: { name: "증서B" },
      }),
      pa = await ar.json(),
      pb = await br.json();
    await stop();
    const now = Date.now(),
      g = createGame([pa, pb], now, () => 0);
    g.players[0].position = 1;
    g.players[0].laps = 3;
    g.players[0].cash = 1000000;
    g.players[0].held = [24];
    g.drawPile = [18, ...g.drawPile.filter((id) => id !== 18 && id !== 24)];
    g.estates = {
      1: { owner: pa.id, buildings: [false, false, false] },
      5: { owner: pa.id, buildings: [] },
      39: { owner: pb.id, buildings: [] },
    };
    land(g, now, () => 0);
    const room = {
      id: randomUUID(),
      version: 0,
      code: "SYNC42",
      name: "증서A님의 방",
      host: pa.id,
      max: 2,
      allowAI: false,
      minutes: 30,
      members: [
        { ...pa, ready: true },
        { ...pb, ready: true },
      ],
      requests: {},
      game: g,
    };
    const db = new DatabaseSync(join(data, "earth.sqlite"));
    db.prepare("INSERT INTO rooms VALUES (?,?)").run(
      room.id,
      JSON.stringify(room),
    );
    db.close();
    await launch();
    const cookie = (await b.cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join(";");
    socket = io(url, {
      transports: ["websocket"],
      extraHeaders: { cookie },
      forceNew: true,
    });
    socket.on("state", (s) => (state = s));
    await new Promise<void>((r, j) => {
      socket!.on("connect", () => r());
      socket!.on("connect_error", j);
    });
    await until(() => !!state?.room);
    async function cmd(action: any) {
      const response = await new Promise<any>((r, j) =>
        socket!.timeout(5000).emit(
          "command",
          {
            type: "action",
            requestId: randomUUID(),
            version: state.room.game.version,
            action,
          },
          (e: Error, result: any) => (e ? j(e) : r(result)),
        ),
      );
      expect(response.ok, response.error).toBe(true);
    }
    async function playB() {
      await until(
        () =>
          state.room.game.players[state.room.game.turn].id === pb.id &&
          state.room.game.phase === "roll",
      );
      await cmd({ type: "roll" });
      await until(() => state.room.game.phase === "purchase");
      await expect(B.locator(".arrival-overlay")).toBeVisible();
      await cmd({ type: "skip" });
      await until(
        () =>
          state.room.game.players[state.room.game.turn].id === pa.id &&
          state.room.game.phase === "roll",
      );
      await B.getByRole("button", { name: "1번 지진", exact: true }).click();
      await B.getByRole("button", { name: "카드 돌리기" }).click();
    }
    const A = await a.newPage(),
      B = await b.newPage();
    await Promise.all([A.goto(url), B.goto(url)]);
    await expect(A.locator(".tile")).toHaveCount(40);
    await expect(B.locator(".tile")).toHaveCount(40);
    await A.getByRole("button", { name: "상세 카드 닫기" }).click();
    await A.getByRole("button", { name: "보유 카드" }).click();
    await expect(
      A.getByRole("img", { name: "만조 탈출권 그림" }),
    ).toBeVisible();
    await expect(A.getByRole("dialog")).toContainText("주사위를 굴리기 전");
    await expect(
      A.getByRole("button", { name: "카드 사용", exact: true }),
    ).toBeDisabled();
    await A.getByRole("button", { name: "닫기", exact: true }).click();
    await B.getByRole("button", { name: "1번 지진", exact: true }).click();
    await B.getByRole("button", { name: "카드 돌리기" }).click();
    await expect(B.locator(".deed-total strong")).toHaveText("2,000");
    await A.getByRole("button", { name: "도착한 땅" }).click();
    await A.getByRole("button", { name: "관측소 건설" }).click();
    await A.getByRole("button", { name: "건설 마침" }).click();
    await expect(B.locator(".deed-total strong")).toHaveText("12,000");
    await expect(B.locator(".toll-formula")).toHaveText(
      "2,000 + 10,000 = 12,000",
    );
    await expect(B.locator(".deed-back")).toContainText("현재 건설 상태");
    await B.screenshot({
      path: "test-results/card-live-build.png",
      fullPage: true,
    });
    await A.getByRole("button", { name: "내 소유지" }).click();
    await expect(
      A.getByRole("dialog").locator(".owner-triangle").first(),
    ).toHaveCSS("background-color", "rgb(216, 93, 76)");
    await A.getByRole("button", { name: "닫기", exact: true }).click();
    await A.getByRole("button", { name: "자산 상세보기" }).click();
    await expect(A.locator(".asset-list")).toContainText("소유지 가치");
    await expect(A.locator(".asset-list")).toContainText("250,000");
    await expect(A.locator(".asset-list")).toContainText("시설 가치");
    await expect(A.locator(".asset-list")).toContainText("50,000");
    await A.getByRole("button", { name: "닫기", exact: true }).click();
    await playB();
    await A.getByRole("button", { name: "1번 지진", exact: true }).click();
    await A.getByRole("button", { name: "카드 돌리기" }).click();
    await A.getByRole("button", { name: "관측소 매각" }).click();
    await expect(B.locator(".deed-total strong")).toHaveText("2,000");
    await A.getByRole("button", { name: "토지 매각" }).click();
    await expect(
      B.locator(".deed-back").getByText("은행", { exact: true }),
    ).toBeVisible();
    await expect(B.locator(".deed-heading .owner-triangle")).toHaveCount(0);
    await A.getByRole("button", { name: "상세 카드 닫기" }).click();
    await A.getByRole("button", { name: "주사위 굴리기" }).click();
    await until(() => state.room.game.phase === "purchase");
    await expect(A.getByRole("button", { name: "구매 포기" })).toBeVisible();
    await A.getByRole("button", { name: "구매 포기" }).click();
    await playB();
    await B.getByRole("button", { name: "상세 카드 닫기" }).click();
    await B.getByRole("button", {
      name: "5번 제주 화산섬",
      exact: true,
    }).click();
    await B.getByRole("button", { name: "카드 돌리기" }).click();
    await expect(B.locator(".deed-back")).toContainText("증서A");
    await A.getByRole("button", { name: "주사위 굴리기" }).click();
    await expect(
      A.getByRole("dialog", { name: "공개 탐사 카드" }),
    ).toContainText("빅뱅 연구 프로젝트", { timeout: 10000 });
    await expect(
      B.getByRole("dialog", { name: "공개 탐사 카드" }),
    ).toContainText("빅뱅 연구 프로젝트");
    await expect(A.getByRole("button", { name: "파산 선언" })).toBeVisible({
      timeout: 20000,
    });
    await B.getByRole("button", {
      name: "5번 제주 화산섬",
      exact: true,
    }).click();
    await B.getByRole("button", { name: "카드 돌리기" }).click();
    await A.getByRole("button", { name: "파산 선언" }).click();
    await expect(
      B.locator(".deed-back").getByText("은행", { exact: true }),
    ).toBeVisible();
    await expect(B.locator(".deed-heading .owner-triangle")).toHaveCount(0);
    await until(() => state.room.game.phase === "finished");
    expect(state.room.game.players[0].cardCount).toBe(0);
    expect(state.room.game.drawCount + state.room.game.discardCount).toBe(30);
    expect(state.room.game.winner).toEqual([pb.id]);
  } finally {
    socket?.disconnect();
    await stop();
    await Promise.allSettled([a.close(), b.close()]);
    rmSync(data, { recursive: true, force: true });
  }
});
