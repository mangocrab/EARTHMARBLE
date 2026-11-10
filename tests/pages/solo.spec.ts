import { test, expect, type Page } from "@playwright/test";
const KEY = "earthmarble.solo.v1";
async function start(page: Page, count = "1") {
  await page.goto("./");
  await page.getByLabel("탐사대원 닉네임").fill("혼자대원");
  await page.getByRole("button", { name: "탐사대원 등록" }).click();
  await expect(page.getByRole("button", { name: "자동 매칭" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "방 참가하기" })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "AI와 탐사 시작" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("AI 대원 수").selectOption(count);
  await dialog.getByLabel("AI 1 난이도").selectOption("hard");
  await dialog.getByRole("button", { name: "AI와 탐사 시작" }).click();
  await expect(page.locator(".tile")).toHaveCount(40);
}
async function wholeBoard(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const map = document
            .querySelector(".board-scroll")!
            .getBoundingClientRect(),
          tiles = [...document.querySelectorAll(".tile")],
          controls = document
            .querySelector(".mobile-controls")!
            .getBoundingClientRect();
        const inside =
          map.width > 100 &&
          map.height > 100 &&
          map.left >= -1 &&
          map.right <= innerWidth + 1 &&
          map.top >= -1 &&
          map.bottom <= innerHeight + 1;
        const tilesFit =
          tiles.length === 40 &&
          tiles.every((t) => {
            const r = t.getBoundingClientRect();
            return (
              r.width > 0 &&
              r.height > 0 &&
              r.left >= map.left - 1 &&
              r.right <= map.right + 1 &&
              r.top >= map.top - 1 &&
              r.bottom <= map.bottom + 1
            );
          });
        const overlaps =
          map.left < controls.right - 1 &&
          map.right > controls.left + 1 &&
          map.top < controls.bottom - 1 &&
          map.bottom > controls.top + 1;
        const labels = tiles.every((tile) => {
          const name = tile.querySelector(".tile-short-name")!;
          const r = name.getBoundingClientRect(),
            t = tile.getBoundingClientRect();
          return (
            getComputedStyle(name.parentElement!).display !== "none" &&
            r.width > 0 &&
            r.left >= t.left - 1 &&
            r.right <= t.right + 1
          );
        });
        return (
          inside &&
          tilesFit &&
          labels &&
          !overlaps &&
          document.documentElement.scrollWidth <= innerWidth
        );
      }),
    )
    .toBe(true);
}
for (const [width, height] of [
  [390, 844],
  [320, 568],
  [844, 390],
  [667, 375],
]) {
  test(`${width}×${height}: 전체 40칸과 행동 버튼이 한 화면에 보인다`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const forbidden: string[] = [],
      errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("websocket", (s) => forbidden.push(s.url()));
    await page.route("**/*", (r) => {
      if (/\/(api|socket\.io)\//.test(new URL(r.request().url()).pathname)) {
        forbidden.push(r.request().url());
        return r.abort();
      }
      return r.continue();
    });
    await start(page, "3");
    await wholeBoard(page);
    await expect(
      page.getByRole("button", { name: "주사위 굴리기" }),
    ).toBeInViewport();
    await page.getByLabel("탐사 지역 상세 보기").selectOption("1");
    await expect(page.getByRole("dialog")).toContainText("지각에 쌓인 응력");
    await page.getByRole("button", { name: "카드 돌리기" }).click();
    await expect(page.locator(".deed-back")).toContainText("통행료");
    await page.getByRole("button", { name: "상세 카드 닫기" }).click();
    await page.screenshot({
      path: `test-results-pages/pages-${width}x${height}.png`,
    });
    expect(forbidden).toEqual([]);
    expect(errors).toEqual([]);
    await context.close();
  });
}
test("정적 하위 경로에서 실제 이동·저장·새로고침·AI 진행을 서버 없이 수행한다", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage(),
    forbidden: string[] = [];
  await page.addInitScript(() => {
    const native = crypto.getRandomValues.bind(crypto);
    let dice = 0;
    crypto.getRandomValues = ((buffer: Uint32Array) => {
      native(buffer);
      buffer[0] = dice++ % 2;
      return buffer;
    }) as typeof crypto.getRandomValues;
  });
  page.on("websocket", (socket) => forbidden.push(socket.url()));
  await page.route("**/api/**", (route) => {
    forbidden.push(route.request().url());
    return route.abort();
  });
  await start(page);
  await expect(page.getByRole("link", { name: "지구마블 홈" })).toHaveAttribute(
    "href",
    new URL(test.info().project.use.baseURL!).pathname,
  );
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(
    page.getByRole("button", { name: "소유지 구매", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "소유지 구매", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          JSON.parse(localStorage.getItem(key)!).room.game.players[1].position,
        KEY,
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "일시정지", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "계속하기", exact: true }),
  ).toBeVisible();
  const before = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  expect(before.room.game.players[0].position).toBe(3);
  expect(before.room.game.estates[3].owner).toBe(before.identity.id);
  await page.reload();
  await expect(page.locator(".tile")).toHaveCount(40);
  await expect(
    page.getByRole("button", { name: "계속하기", exact: true }),
  ).toBeVisible();
  const restored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  expect(restored.room.game.players).toEqual(before.room.game.players);
  expect(restored.room.game.drawPile).toEqual(before.room.game.drawPile);
  await wholeBoard(page);
  await page.getByRole("button", { name: "계속하기", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "일시정지", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "새 탐사", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "돌아가기" })
    .click();
  await expect(page.locator(".tile")).toHaveCount(40);
  await page.getByRole("button", { name: "새 탐사", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "새 탐사 준비", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "AI와 탐사 시작" }),
  ).toBeVisible();
  expect(forbidden).toEqual([]);
  await context.close();
});
