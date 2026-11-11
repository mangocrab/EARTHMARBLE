import { test, expect, type Page } from "@playwright/test";
async function register(page: Page, name: string) {
  await page.goto("/");
  await page.getByLabel("탐사대원 닉네임").fill(name);
  await page.getByRole("button", { name: "탐사대원 등록" }).click();
  await expect(page.getByRole("button", { name: "방 만들기" })).toBeEnabled();
}
async function assertFullBoard(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const map = document
          .querySelector(".board-scroll")!
          .getBoundingClientRect();
        return (
          map.width > 100 &&
          map.left >= -1 &&
          map.top >= -1 &&
          map.right <= innerWidth + 1 &&
          map.bottom <= innerHeight + 1 &&
          [...document.querySelectorAll(".tile")].every((t) => {
            const r = t.getBoundingClientRect();
            return (
              r.left >= map.left - 1 &&
              r.right <= map.right + 1 &&
              r.top >= map.top - 1 &&
              r.bottom <= map.bottom + 1
            );
          })
        );
      }),
    )
    .toBe(true);
}
test("PC: 두 탐사대원, 비밀번호 방, 서버 주사위, 상세 카드, 새로고침 복구", async ({
  browser,
}) => {
  const a = await browser.newContext({
      viewport: { width: 1440, height: 1050 },
    }),
    b = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const A = await a.newPage(),
    B = await b.newPage();
  const errors: string[] = [];
  A.on("pageerror", (e) => errors.push(e.message));
  await A.addInitScript(() => {
    const raf = window.requestAnimationFrame.bind(window);
    (window as any).renderRequests = 0;
    window.requestAnimationFrame = (callback) => {
      (window as any).renderRequests++;
      return raf(callback);
    };
  });
  await register(A, "바다");
  await A.screenshot({
    path: "test-results/lobby-desktop.png",
    fullPage: true,
  });
  await register(B, "우주");
  await A.getByRole("button", { name: "방 만들기" }).click();
  await A.getByLabel("방 비밀번호").fill("earth");
  await A.getByRole("button", { name: "탐사대 만들기" }).click();
  await expect(A.getByText("바다님의 방")).toBeVisible();
  await B.getByRole("button", { name: "방 참가하기" }).click();
  await expect(B.getByLabel("방 코드")).toHaveCount(0);
  await B.getByRole("button", {
    name: "바다님의 방 참가",
    exact: true,
  }).click();
  await B.getByLabel("비밀번호", { exact: true }).fill("earth");
  await B.getByRole("button", { name: "참가하기 →", exact: true }).click();
  await expect(B.getByText("바다님의 방")).toBeVisible();
  await expect(A.locator(".crew-list")).toContainText("우주");
  await A.getByRole("button", { name: "준비 완료", exact: true }).click();
  await B.getByRole("button", { name: "준비 완료", exact: true }).click();
  await A.getByRole("button", { name: "탐사 시작" }).click();
  await expect(A.locator(".tile")).toHaveCount(40);
  await expect(B.locator(".tile")).toHaveCount(40);
  await expect(A.locator(".my-cash strong")).toHaveText("1,500,000");
  await expect(A.locator(".dice-wrap canvas")).toBeVisible();
  const idleFrames = await A.evaluate(async () => {
    const before = (window as any).renderRequests;
    await new Promise((r) => setTimeout(r, 600));
    return (window as any).renderRequests - before;
  });
  expect(idleFrames).toBeLessThan(3);
  await A.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect
    .poll(async () =>
      A.locator(".tile").evaluateAll((tiles) =>
        tiles.findIndex(
          (t) => t.querySelector(".tokens span")?.textContent === "1",
        ),
      ),
    )
    .toBeGreaterThan(0);
  await expect(A.locator(".dice-result")).toHaveText(/합계 \d+/);
  const label = await A.locator(".dice-wrap").getAttribute("aria-label");
  const values = label!.match(/주사위 (\d)와 (\d)/)!;
  await expect(A.locator(".dice-wrap canvas")).toHaveAttribute(
    "data-top-faces",
    `${values[1]},${values[2]}`,
  );
  await expect(
    A.getByRole("img", { name: "공용 탐사 카드 덱 뒷면" }),
  ).toBeVisible();
  await expect(A.locator(".arrival-overlay")).toBeVisible({ timeout: 10000 });
  await A.getByRole("button", { name: "상세 카드 닫기" }).click();
  await A.getByRole("button", { name: "1번 지진", exact: true }).click();
  await expect(A.getByRole("dialog")).toContainText("지각에 쌓인 응력");
  await A.getByRole("button", { name: "카드 돌리기" }).click();
  await expect(A.locator(".deed-back")).toContainText("50,000");
  await A.getByRole("button", { name: "상세 카드 닫기" }).click();
  await A.screenshot({ path: "test-results/game-desktop.png", fullPage: true });
  const cash = await A.locator(".my-cash strong").innerText();
  await A.reload();
  await expect(A.locator(".tile")).toHaveCount(40);
  await expect(A.locator(".my-cash strong")).toHaveText(cash);
  expect(errors).toEqual([]);
  await a.close();
  await b.close();
});
test("모바일: AI 초대, 준비 및 플레이, 소유지 카드 터치 전환", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await register(page, "모바일");
  await page.screenshot({
    path: "test-results/lobby-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "방 만들기" }).click();
  await page.getByRole("button", { name: "탐사대 만들기" }).click();
  await page.getByRole("button", { name: "AI 초대" }).click();
  await page.getByRole("button", { name: "준비 완료", exact: true }).click();
  await page.getByRole("button", { name: "탐사 시작" }).click();
  await expect(page.locator(".tile")).toHaveCount(40);
  await assertFullBoard(page);
  await expect(page.locator(".mobile-action-dock")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const map = document
            .querySelector(".board-scroll")!
            .getBoundingClientRect(),
          tile = document
            .querySelector('.tokens span[title="모바일"]')!
            .closest(".tile")!
            .getBoundingClientRect();
        return (
          tile.left >= map.left - 2 &&
          tile.right <= map.right + 2 &&
          tile.top >= map.top - 2 &&
          tile.bottom <= map.bottom + 2
        );
      }),
    )
    .toBe(true);

  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.locator(".arrival-overlay")).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole("button", { name: "상세 카드 닫기" }).click();
  await page.getByLabel("탐사 지역 상세 보기").selectOption("1");
  await page.getByRole("button", { name: "카드 돌리기" }).click();
  await expect(page.locator(".deed")).toHaveClass(/flipped/);
  await page.getByRole("button", { name: "상세 카드 닫기" }).click();
  await page.getByRole("button", { name: "내 소유지" }).click();
  await expect(page.getByText("아직 보유한 소유지가 없습니다.")).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.screenshot({
    path: "test-results/game-mobile.png",
    fullPage: false,
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator(".mobile-action-dock")).toBeVisible();
  await page.screenshot({
    path: "test-results/game-landscape.png",
    fullPage: false,
  });
  await assertFullBoard(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await context.close();
});
test("WebGL 미지원: 2D 주사위 대체 및 움직임 줄이기", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.addInitScript(() => {
    const realNow = Date.now;
    Date.now = () => realNow() + 5 * 60 * 1000;
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      kind: string,
      ...args: any[]
    ) {
      if (
        kind === "webgl" ||
        kind === "webgl2" ||
        kind === "experimental-webgl"
      )
        return null;
      return (original as any).apply(this, [kind, ...args]);
    } as any;
  });
  await register(page, "대체화면");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByLabel("움직임 줄이기").check();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "방 만들기" }).click();
  await page.getByRole("button", { name: "탐사대 만들기" }).click();
  await page.getByRole("button", { name: "AI 초대" }).click();
  await page.getByRole("button", { name: "준비 완료", exact: true }).click();
  await page.getByRole("button", { name: "탐사 시작" }).click();
  await expect(page.locator(".dice-fallback")).toBeVisible();
  await expect(page.locator(".timer small")).toHaveText(/행동 시간 (5\d|60)초/);
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(page.locator(".dice-fallback")).not.toHaveClass(/shake/);
  await context.close();
});

test("초기 접속 정보 조회 실패를 안내하고 같은 화면에서 다시 접속한다", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/api/me", (route) => route.abort("failed"));
  await page.goto("/");
  await expect(page.getByRole("alert")).toContainText(
    "서버에 연결하지 못했습니다",
  );
  await page.unroute("**/api/me");
  await page.getByLabel("탐사대원 닉네임").fill("재접속");
  await page.getByRole("button", { name: "탐사대원 등록" }).click();
  await expect(page.getByRole("button", { name: "방 만들기" })).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(errors).toEqual([]);
  await context.close();
});

test("외부 로비의 매칭 진입 요청은 로그인 후 실제 서버 매칭을 시작한다", async ({
  page,
}) => {
  await page.goto("/?entry=match");
  await page.getByLabel("탐사대원 닉네임").fill("온라인연결");
  await page.getByRole("button", { name: "탐사대원 등록" }).click();
  await page
    .getByRole("button", { name: "빠른게임 (2인)", exact: true })
    .click();
  await expect(page.locator(".matching")).toContainText("빠른게임 · 2인");
  await page.getByRole("button", { name: "매칭 취소" }).click();
  await expect(page.getByRole("button", { name: "방 만들기" })).toBeVisible();
});
