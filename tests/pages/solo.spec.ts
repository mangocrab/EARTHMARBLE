import { test, expect, type Page } from "@playwright/test";
const KEY = "earthmarble.solo.v1";
async function start(page: Page, count = "1") {
  // Offline AI play must work through the unified room even without signaling.
  await page.route("https://0.peerjs.com/**", (route) => route.abort());
  await page.routeWebSocket("wss://0.peerjs.com/**", (socket) =>
    socket.close(),
  );
  await page.goto("./");
  await page.getByLabel("탐사대원 닉네임").fill("혼자대원");
  await page.getByRole("button", { name: "탐사대원 등록" }).click();
  await expect(page.getByRole("button", { name: "자동 매칭" })).toBeVisible();
  await expect(page.getByRole("button", { name: "방 참가하기" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "AI와 탐사 시작" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "방 만들기" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("방 유형")).toHaveCount(0);
  await expect(dialog.getByLabel("AI 대원 초대 허용")).toBeChecked();
  await dialog.getByRole("button", { name: "탐사대 만들기" }).click();
  await page.getByLabel("AI 난이도").selectOption("hard");
  for (let i = 0; i < Number(count); i++)
    await page.getByRole("button", { name: "AI 초대", exact: true }).click();
  await page.getByRole("button", { name: "준비 완료", exact: true }).click();
  await page.getByRole("button", { name: "탐사 시작" }).click();
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
    page.on("websocket", (s) => {
      if (!s.url().includes("0.peerjs.com")) forbidden.push(s.url());
    });
    await page.route("**/*", (r) => {
      if (/\/(api|socket\.io)\//.test(new URL(r.request().url()).pathname)) {
        forbidden.push(r.request().url());
        return r.abort();
      }
      return r.continue();
    });
    await start(page, "3");
    await wholeBoard(page);
    await expect(page.locator('[data-tile="2"]')).toHaveCSS(
      "border-top-color",
      "rgb(232, 196, 45)",
    );
    await expect(page.locator('[data-tile="5"]')).toHaveCSS(
      "border-top-color",
      "rgb(238, 144, 46)",
    );
    await expect(page.locator('[data-tile="38"]')).toHaveCSS(
      "border-top-color",
      "rgb(238, 144, 46)",
    );
    await expect(page.locator('[data-tile="39"]')).toHaveCSS(
      "border-top-color",
      "rgb(23, 23, 23)",
    );
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
  page.on("websocket", (socket) => {
    if (!socket.url().includes("0.peerjs.com")) forbidden.push(socket.url());
  });
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
    page.getByRole("button", { name: "땅 구매", exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await page.getByRole("button", { name: "땅 구매", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          JSON.parse(localStorage.getItem(key)!).room.game.players[1].position,
        KEY,
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "설정", exact: true }).click();
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
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "계속하기", exact: true }),
  ).toBeVisible();
  const restored = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  expect(restored.room.game.players).toEqual(before.room.game.players);
  expect(restored.room.game.drawPile).toEqual(before.room.game.drawPile);
  await page.keyboard.press("Escape");
  await wholeBoard(page);
  await page.getByRole("button", { name: "설정", exact: true }).click();
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
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByRole("button", { name: "새 탐사", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "새 탐사 준비", exact: true })
    .click();
  await expect(page.getByRole("button", { name: "방 만들기" })).toBeVisible();
  expect(forbidden).toEqual([]);
  await context.close();
});

async function seed(page: Page, edit: (save: any) => void) {
  const save = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    KEY,
  );
  edit(save);
  save.savedAt = Date.now();
  save.manualPaused = false;
  save.room.game.deadline = save.savedAt + 60000;
  save.room.game.endsAt = save.savedAt + 1800000;
  delete save.room.game.pausedAt;
  await page.addInitScript(
    ({ key, value }) => localStorage.setItem(key, value),
    { key: KEY, value: JSON.stringify(save) },
  );
  await page.reload();
  await expect(page.locator(".tile")).toHaveCount(40);
}
test("모바일 도착 카드: 세 건물 순차 건설과 자금 표시, 고정 카드 돌리기", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await seed(page, (save) => {
    const g = save.room.game;
    g.phase = "build";
    g.players[0].position = 1;
    g.players[0].laps = 3;
    g.estates[1] = { owner: g.players[0].id, buildings: [false, false, false] };
  });
  await expect(
    page.getByRole("dialog", { name: "지진 상세 카드" }),
  ).toBeVisible();
  await expect(page.locator(".deed-front")).toContainText("관측소 · 50,000원");
  await expect(
    page.getByRole("button", { name: "연구소 건설" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "카드 돌리기" }).click();
  const before = await page
    .getByRole("button", { name: "카드 돌리기" })
    .boundingBox();
  await page
    .locator(".deed-scroll")
    .evaluate((el) => (el.scrollTop = el.scrollHeight));
  expect(
    await page.getByRole("button", { name: "카드 돌리기" }).boundingBox(),
  ).toEqual(before);
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(
    page.getByRole("button", { name: "카드 돌리기" }),
  ).toBeInViewport();
  await expect(
    page.getByRole("button", { name: "종합연구센터 건설" }),
  ).toBeInViewport();
  await page.screenshot({
    path: "test-results-pages/arrival-build-mobile.png",
  });
  await page.getByRole("button", { name: "관측소 건설" }).click();
  await expect(
    page.locator(".players-panel .cash-float").first(),
  ).toContainText("-50,000");
  await page.getByRole("button", { name: "연구소 건설" }).click();
  await page.getByRole("button", { name: "종합연구센터 건설" }).click();
  await expect(
    page.getByRole("dialog", { name: "지진 상세 카드" }),
  ).toHaveCount(0);
  const buildings = await page.evaluate(
    (key) =>
      JSON.parse(localStorage.getItem(key)!).room.game.estates[1].buildings,
    KEY,
  );
  expect(buildings).toEqual([true, true, true]);
});
test("간조는 맵을 눌러 목적지로 이동하고 도착 카드를 연다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await seed(page, (save) => {
    save.room.game.phase = "low";
    save.room.game.players[0].position = 30;
    save.room.game.players[0].low = true;
  });
  await expect(page.getByLabel("간조 목적지")).toHaveCount(0);
  await page
    .getByRole("button", { name: "31번 달의 위상", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("달의 위상");
  await expect(
    page.getByRole("button", { name: "땅 구매", exact: true }),
  ).toBeVisible();
  const position = await page.evaluate(
    (key) =>
      JSON.parse(localStorage.getItem(key)!).room.game.players[0].position,
    KEY,
  );
  expect(position).toBe(31);
});
for (const dark of [false, true]) {
  test(
    dark
      ? "다크모드 뽑기 카드도 어둡고 글자가 읽히며 공개 후 보관된다"
      : "뽑기 연출 후 카드 공개, 이후 뽑은 사람 보관함에 들어간다",
    async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await start(page);
      if (dark) {
        await page.getByRole("button", { name: "설정", exact: true }).click();
        await page.getByLabel("다크모드", { exact: true }).check();
        await page.keyboard.press("Escape");
      }
      await seed(page, (save) => {
        const g = save.room.game;
        g.players[0].position = 39;
        g.phase = "roll";
        g.drawPile = [24, ...g.drawPile.filter((id: number) => id !== 24)];
      });
      await page.addInitScript(() => {
        let n = 0;
        crypto.getRandomValues = ((b: Uint32Array) => {
          b[0] = n++ % 2;
          return b;
        }) as typeof crypto.getRandomValues;
      });
      await page.reload();
      await page.getByRole("button", { name: "주사위 굴리기" }).click();
      const reveal = page.getByRole("dialog", { name: "공개 탐사 카드" });
      await expect(reveal).toContainText("만조 탈출권");
      if (dark) {
        const colors = await reveal
          .locator(".draw-card-front")
          .evaluate((e) => {
            const style = getComputedStyle(e);
            const luminance = (color: string) => {
              const rgb = color
                .match(/[\d.]+/g)!
                .slice(0, 3)
                .map(Number)
                .map((v) => {
                  const c = v / 255;
                  return c <= 0.04045
                    ? c / 12.92
                    : ((c + 0.055) / 1.055) ** 2.4;
                });
              return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
            };
            const bg = luminance(style.backgroundColor),
              fg = luminance(style.color);
            return {
              bg,
              contrast: (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05),
            };
          });
        expect(colors.bg).toBeLessThan(0.08);
        expect(colors.contrast).toBeGreaterThan(7);
      }

      await page.waitForTimeout(1600);
      await page.screenshot({
        path: dark
          ? "test-results-pages/public-card-dark-mobile.png"
          : "test-results-pages/public-card-mobile.png",
      });
      const during = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).room.game,
        KEY,
      );
      expect(during.players[0].held).toEqual([]);
      expect(during.players[1].held).toEqual([]);
      await expect(reveal).toHaveCount(0, { timeout: 6000 });
      const after = await page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key)!).room.game,
        KEY,
      );
      expect(after.players[0].held).toEqual([24]);
      expect(after.players[1].held).toEqual([]);
      expect(
        after.drawPile.length +
          after.discardPile.length +
          after.players.flatMap((p: any) => p.held).length,
      ).toBe(30);
    },
  );
}

test("수동 매각은 비싼 시설부터, 부족분 자동 매각은 건물 우선으로 정산한다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await seed(page, (save) => {
    const g = save.room.game,
      p = g.players[0];
    p.cash = 0;
    p.position = 39;
    g.phase = "toll";
    g.payment = { amount: 100000, to: g.players[1].id, toll: true };
    g.settlement = { tile: 39, parts: [100000], amount: 100000 };
    g.estates[1] = { owner: p.id, buildings: [true, true, true] };
    g.estates[39] = { owner: g.players[1].id, buildings: [] };
  });
  await page.getByRole("button", { name: "정산 화면 닫기" }).click();
  await page.getByLabel("탐사 지역 상세 보기").selectOption("1");
  await page.getByRole("button", { name: "카드 돌리기" }).click();
  await expect(
    page.getByRole("button", { name: "관측소 매각" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "연구소 매각" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "종합연구센터 매각" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "상세 카드 닫기" }).click();
  await page.getByRole("button", { name: "정산 화면 열기" }).click();
  await page.getByRole("button", { name: "부족분 자동 매각" }).click();
  await expect
    .poll(() =>
      page.evaluate((key) => {
        const g = JSON.parse(localStorage.getItem(key)!).room.game;
        return {
          buildings: g.estates[1].buildings,
          cash: g.players[0].cash,
          otherCash: g.players[1].cash,
        };
      }, KEY),
    )
    .toEqual({ buildings: [false, false, true], cash: 0, otherCash: 1600000 });
});
test("더블로 전 지구 탐사 카드를 뽑으면 한 바퀴 후 재추첨하고 다시 주사위를 굴린다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await seed(page, (save) => {
    const g = save.room.game;
    g.players[0].position = 0;
    g.phase = "roll";
    g.drawPile = [
      27,
      24,
      ...g.drawPile.filter((id: number) => id !== 27 && id !== 24),
    ];
  });
  await page.addInitScript(() => {
    crypto.getRandomValues = ((b: Uint32Array) => {
      b.fill(0);
      return b;
    }) as typeof crypto.getRandomValues;
  });
  await page.reload();
  const deck = await page.locator(".deck-back").boundingBox();
  expect(deck!.width).toBeGreaterThan(0);
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(
    page.getByRole("dialog", { name: "공개 탐사 카드" }),
  ).toContainText("전 지구 탐사");
  await page.locator(".drawn-card").evaluate((el) => {
    const a = el.getAnimations()[0];
    a.pause();
    a.currentTime = 0;
  });
  const drawn = await page.locator(".drawn-card").boundingBox();
  expect(Math.abs(drawn!.width - deck!.width)).toBeLessThan(1);
  expect(Math.abs(drawn!.height - deck!.height)).toBeLessThan(1);
  await page
    .locator(".drawn-card")
    .evaluate((el) => el.getAnimations()[0].play());
  const source = await page.locator(".draw-source-deck").boundingBox();
  expect(
    Math.abs(source!.x + source!.width / 2 - (deck!.x + deck!.width / 2)),
  ).toBeLessThan(2);
  await page.screenshot({ path: "test-results-pages/card-from-deck.png" });
  await expect(
    page.getByRole("dialog", { name: "공개 탐사 카드" }),
  ).toContainText("만조 탈출권", { timeout: 10000 });
  await expect(page.getByRole("button", { name: "주사위 굴리기" })).toBeVisible(
    { timeout: 6000 },
  );
  const g = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).room.game,
    KEY,
  );
  expect(g.turn).toBe(0);
  expect(g.doubles).toBe(1);
  expect(g.players[0].cash).toBe(1700000);
  expect(g.players[0].held).toEqual([24]);
  expect(g.players[1].held).toEqual([]);
});

for (const [width, height] of [
  [320, 568],
  [390, 844],
  [667, 375],
]) {
  test(`${width}×${height}: 큰 통행료의 모든 정산 버튼을 스크롤 없이 볼 수 있다`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await start(page);
    await seed(page, (save) => {
      const g = save.room.game,
        p = g.players[0];
      p.position = 37;
      p.cash = 10000;
      p.held = [25];
      g.drawPile = g.drawPile.filter((id: number) => id !== 25);
      g.phase = "toll";
      g.payment = { amount: 2805000, to: g.players[1].id, toll: true };
      g.settlement = {
        tile: 37,
        parts: [35000, 170000, 1100000, 1500000],
        amount: 2805000,
      };
      g.estates[37] = { owner: g.players[1].id, buildings: [true, true, true] };
      g.estates[1] = { owner: p.id, buildings: [true, true, true] };
    });
    const dialog = page.getByRole("dialog", { name: "연구비 정산" });
    await expect(dialog).toBeVisible();
    for (const name of [
      "연구비 정산",
      "통행료 면제권 사용",
      "부족분 자동 매각",
      "직접 매각할 소유지 선택",
      "파산 선언",
    ])
      await expect(
        dialog.getByRole("button", { name, exact: true }),
      ).toBeVisible();
    const allFit = await dialog
      .locator(".payment-actions button")
      .evaluateAll((buttons) =>
        buttons.every((button) => {
          const r = button.getBoundingClientRect();
          return (
            r.top >= 0 &&
            r.bottom <= innerHeight &&
            r.left >= 0 &&
            r.right <= innerWidth
          );
        }),
      );
    expect(allFit).toBe(true);
    await dialog.getByText("통행료 계산 보기").click();
    await dialog
      .locator(".payment-details")
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    await expect(
      dialog.getByRole("button", { name: "파산 선언", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: `test-results-pages/payment-${width}x${height}.png`,
    });
    await dialog
      .getByRole("button", { name: "통행료 면제권 사용", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    const cash = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).room.game.players[0].cash,
      KEY,
    );
    expect(cash).toBe(10000);
  });
}

test("매각한 건물은 서서히, 땅의 소유 삼각형은 한 번 빛난 뒤 사라진다", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await start(page);
  await seed(page, (save) => {
    const g = save.room.game;
    g.estates[1] = { owner: g.players[0].id, buildings: [true, true, true] };
  });
  await page.getByLabel("탐사 지역 상세 보기").selectOption("1");
  await page.getByRole("button", { name: "카드 돌리기" }).click();
  await page.getByRole("button", { name: "종합연구센터 매각" }).click();
  const building = page.locator('[data-tile="1"] .sale-building-ghost');
  await expect(building).toHaveCount(1);
  await expect
    .poll(() => building.evaluate((el) => +getComputedStyle(el).opacity))
    .toBeLessThan(0.8);
  await page.getByRole("button", { name: "연구소 매각" }).click();
  await page.getByRole("button", { name: "관측소 매각" }).click();
  await page.getByRole("button", { name: "토지 매각" }).click();
  await page.getByRole("button", { name: "상세 카드 닫기" }).click();
  const owner = page.locator('[data-tile="1"] .sale-owner-ghost');
  await expect(owner).toHaveCount(1);
  await expect(
    page.locator('[data-tile="1"] .owner-triangle:not(.sale-owner-ghost)'),
  ).toHaveCount(0);
  await page.screenshot({ path: "test-results-pages/sold-property-fade.png" });
  await expect(owner).toHaveCount(0, { timeout: 3000 });
  await expect(
    page.locator('[data-tile="1"] .sale-building-ghost'),
  ).toHaveCount(0);
});

for (const panel of ["property", "cards"]) {
  test(`종료 시 열린 ${panel} 카드를 닫고 가려지지 않은 버튼으로 로비에 돌아간다`, async ({
    page,
  }) => {
    await page.clock.install({ time: new Date() });
    await page.setViewportSize({ width: 320, height: 568 });
    await start(page, "3");
    if (panel === "property") {
      await page.getByLabel("탐사 지역 상세 보기").selectOption("1");
      await page.getByRole("button", { name: "카드 돌리기" }).click();
    } else await page.getByRole("button", { name: "보유 카드" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.clock.fastForward(31 * 60 * 1000);
    const result = page.getByRole("dialog", { name: "탐사 결과" });
    await expect(result).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await expect(page.locator(".deed")).toHaveCount(0);
    const lobby = result.getByRole("button", {
      name: "방으로 돌아가기",
      exact: true,
    });
    await expect(lobby).toBeInViewport();
    await lobby.click();
    await expect(page.locator(".waiting h1")).toHaveText("혼자대원님의 방");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
}

test("효과음 음량 저장·음소거·미리듣기를 제공한다", async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).soundNotes = 0;
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      (window as any).soundNotes++;
      return original.call(this);
    };
  });
  await page.goto("./");
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page.getByRole("slider", { name: "효과음 음량" }).fill("27");
  expect(await page.evaluate(() => localStorage.getItem("earth-volume"))).toBe(
    "0.27",
  );
  await page.getByRole("button", { name: "효과음 미리듣기" }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).soundNotes))
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "음소거", exact: true }).click();
  const before = await page.evaluate(() => (window as any).soundNotes);
  await page.getByRole("button", { name: "효과음 미리듣기" }).click();
  expect(await page.evaluate(() => (window as any).soundNotes)).toBe(before);
  await page.reload();
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.getByRole("slider", { name: "효과음 음량" })).toHaveValue(
    "0",
  );
});
test("전용 서버 주소가 설정돼 있으면 해당 서버로 매칭을 연결한다", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem("earth-server-url", "https://earth-game.example/"),
  );
  await page.goto("./");
  await page.getByLabel("탐사대원 닉네임").fill("온라인대원");
  await page.getByRole("button", { name: "탐사대원 등록" }).click();
  await page.route("https://earth-game.example/**", (route) =>
    route.fulfill({ status: 200, body: "연결된 게임 서버" }),
  );
  await page.getByRole("button", { name: "자동 매칭" }).click();
  await expect(page).toHaveURL("https://earth-game.example/?entry=match");
});

test("환급소 카드 양면에 적립액을 표시하고 주사위·이동 목재 소리가 실제로 재생된다", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).soundFrequencies = [];
    const original = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function () {
      const osc = original.call(this),
        set = osc.frequency.setValueAtTime.bind(osc.frequency);
      osc.frequency.setValueAtTime = (value, time) => {
        (window as any).soundFrequencies.push(value);
        return set(value, time);
      };
      return osc;
    };
  });
  await start(page);
  await seed(page, (save) => {
    save.room.game.fund = 345000;
  });
  await page.locator('[data-tile="20"]').click();
  await expect(page.locator(".deed-front .fund-total")).toContainText(
    "345,000원",
  );
  await page.getByRole("button", { name: "카드 돌리기" }).click();
  await expect(page.locator(".deed-back .fund-total")).toContainText(
    "345,000원",
  );
  await page.getByRole("button", { name: "상세 카드 닫기" }).click();
  await page.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as any).soundFrequencies.includes(330)),
    )
    .toBe(true);
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (window as any).soundFrequencies.some(
            (f: number) => f === 245 || f === 280,
          ),
        ),
      { timeout: 10000 },
    )
    .toBe(true);
});

test("보유 카드를 사용하면 남은 덱 순서는 유지하고 버림 더미에 넣어 저장한다", async ({
  page,
}) => {
  await start(page);
  await seed(page, (save) => {
    const g = save.room.game;
    g.players[0].position = 10;
    g.players[0].tide = 3;
    g.players[0].held = [24];
    g.drawPile = g.drawPile.filter((c: number) => c !== 24);
  });
  const before = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).room.game.drawPile,
    KEY,
  );
  await page.getByRole("button", { name: /보유 카드/ }).click();
  await page.getByRole("button", { name: "카드 사용", exact: true }).click();
  const after = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).room.game,
    KEY,
  );
  expect(after.drawPile).toEqual(before);
  expect(after.discardPile).toContain(24);
  expect(after.players[0].held).toEqual([]);
  // A new page reads the actual save without replaying seed()'s setup script.
  const resumed = await page.context().newPage();
  await resumed.goto("./");
  await expect(resumed.locator(".tile")).toHaveCount(40);
  expect(
    await resumed.evaluate(
      (key) => JSON.parse(localStorage.getItem(key)!).room.game.discardPile,
      KEY,
    ),
  ).toContain(24);
  await resumed.close();
});

test("사이트 삽입 스크립트의 iframe에서 방 생성·AI 강퇴·싱글플레이가 동작한다", async ({
  page,
}) => {
  await page.route("https://0.peerjs.com/**", (route) => route.abort());
  await page.routeWebSocket("wss://0.peerjs.com/**", (socket) =>
    socket.close(),
  );
  await page.goto("./embed-example.html");
  const game = page.frameLocator("#earth-marble iframe");
  await game.getByLabel("탐사대원 닉네임").fill("사이트 대원");
  await game.getByRole("button", { name: "탐사대원 등록" }).click();
  await game.getByRole("button", { name: "방 만들기" }).click();
  await game.getByRole("button", { name: "탐사대 만들기" }).click();
  await game.getByRole("button", { name: "AI 초대", exact: true }).click();
  await game.getByRole("button", { name: /탐사봇.*내보내기/ }).click();
  await expect(
    game.locator(".crew-list article").filter({ hasText: "AI ·" }),
  ).toHaveCount(0);
  await game.getByRole("button", { name: "AI 초대", exact: true }).click();
  await game.getByRole("button", { name: "준비 완료", exact: true }).click();
  await game.getByRole("button", { name: "탐사 시작" }).click();
  await expect(game.locator(".tile")).toHaveCount(40);
  await expect(
    game.getByRole("button", { name: "주사위 굴리기" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("파산 선언 버튼이 자동 매각으로 부족분을 채우면 파산시키지 않는다", async ({
  page,
}) => {
  await start(page);
  await seed(page, (save) => {
    const g = save.room.game,
      p = g.players[0];
    p.cash = 10000;
    g.phase = "toll";
    g.payment = { amount: 80000, to: g.players[1].id, toll: true };
    g.estates[1] = { owner: p.id, buildings: [true, true, true] };
  });
  await page.getByRole("button", { name: "파산 선언", exact: true }).click();
  const after = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!).room.game,
    KEY,
  );
  expect(after.players[0].bankrupt).toBe(false);
  expect(after.players[0].cash).toBe(30000);
  expect(after.players[1].cash).toBe(1580000);
  expect(after.estates[1].buildings).toEqual([false, false, true]);
  await expect(page.getByRole("dialog", { name: /최종|결과/ })).toHaveCount(0);
});

test("사이트 삽입 환경이 저장소 접근을 차단해도 현재 AI 게임은 플레이할 수 있다", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage blocked", "SecurityError");
      },
    }),
  );
  await page.route("https://0.peerjs.com/**", (route) => route.abort());
  await page.routeWebSocket("wss://0.peerjs.com/**", (socket) =>
    socket.close(),
  );
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./embed-example.html");
  const game = page.frameLocator("#earth-marble iframe");
  await game.getByLabel("탐사대원 닉네임").fill("임시 대원");
  await game.getByRole("button", { name: "탐사대원 등록" }).click();
  await game.getByRole("button", { name: "방 만들기" }).click();
  await game.getByRole("button", { name: "탐사대 만들기" }).click();
  await game.getByRole("button", { name: "AI 초대", exact: true }).click();
  await game.getByRole("button", { name: "준비 완료", exact: true }).click();
  await game.getByRole("button", { name: "탐사 시작" }).click();
  await expect(game.locator(".tile")).toHaveCount(40);
  await game.getByRole("button", { name: "주사위 굴리기" }).click();
  await expect(game.locator(".live-activity")).toContainText("주사위");
  expect(errors).toEqual([]);
});

test("방 목록은 코드 입력 없이 열리며 연결 실패를 가짜 목록으로 표시하지 않는다", async ({
  page,
}) => {
  await page.route("https://0.peerjs.com/**", (r) => r.abort());
  await page.routeWebSocket("wss://0.peerjs.com/**", (s) => s.close());
  await page.goto("./");
  await page.getByLabel("탐사대원 닉네임").fill("목록대원");
  await page.getByRole("button", { name: "탐사대원 등록" }).click();
  await page.getByRole("button", { name: "방 참가하기" }).click();
  await expect(page.getByRole("dialog")).toContainText("열린 방 목록");
  await expect(page.getByLabel("방 코드")).toHaveCount(0);
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "방 목록에 연결하지 못했습니다",
    { timeout: 15000 },
  );
  await expect(page.locator(".room-list-item")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "새로고침", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "방 만들기" }).click();
  await page.getByRole("button", { name: "탐사대 만들기" }).click();
  await expect(page.locator(".waiting h1")).toHaveText("목록대원님의 방");
});

test("기기 임시 프로필은 전체·최다 인원전과 2·3·4인 상세 승패를 표시한다", async ({
  page,
}) => {
  await start(page);
  const id = await page.evaluate(
    () => JSON.parse(localStorage.getItem("earthmarble.solo.v1")!).identity.id,
  );
  await page.evaluate(
    (id) =>
      localStorage.setItem(
        `earth-records:${id}`,
        JSON.stringify({
          stats: {
            2: { games: 4, wins: 3, losses: 1 },
            3: { games: 2, wins: 1, losses: 1 },
            4: { games: 6, wins: 4, losses: 2 },
          },
          games: [],
        }),
      ),
    id,
  );
  await page.reload();
  await page.getByRole("button", { name: "설정", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "내 프로필과 전적", exact: true })
    .click();
  await expect(page.locator(".profile-card")).toContainText("전체 12판");
  await expect(page.locator(".profile-card")).toContainText(
    "8승 · 4패 · 승률 66.7%",
  );
  await expect(page.locator(".profile-card")).toContainText(
    "4인전 · 6판 (4승 2패)",
  );
  await page.getByRole("button", { name: "상세보기", exact: true }).click();
  await expect(page.locator(".records-table tbody tr")).toHaveCount(4);
});

for (const [width, height] of [
  [320, 568],
  [768, 1024],
  [1024, 768],
  [1440, 900],
]) {
  test(`${width}×${height}: 다크모드·채팅 미리보기·설정 접근과 화면 경계`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ viewport: { width, height } }),
      page = await context.newPage();
    try {
      await start(page, "3");
      await page.getByRole("button", { name: "설정", exact: true }).click();
      await page.getByLabel("다크모드", { exact: true }).check();
      await page.keyboard.press("Escape");
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      if (width <= 1190) await wholeBoard(page);
      expect(
        await page.locator(".header").evaluate((e) =>
          [...e.querySelectorAll("button")]
            .filter((b) => b.getBoundingClientRect().width > 0)
            .every((b) => {
              const r = b.getBoundingClientRect();
              return r.left >= 0 && r.right <= innerWidth + 1;
            }),
        ),
      ).toBe(true);
      await expect(
        page.getByRole("region", { name: "최근 채팅" }),
      ).toBeInViewport();
      await page.getByRole("button", { name: "채팅", exact: true }).click();
      await page
        .getByRole("textbox", { name: "채팅 메시지" })
        .fill("화면에서 바로 읽는 채팅");
      await page.getByRole("button", { name: "전송", exact: true }).click();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("region", { name: "최근 채팅" }),
      ).toContainText("화면에서 바로 읽는 채팅");
      await page.screenshot({ path: `test-results-pages/dark-${width}.png` });
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await page.locator('[data-tile="1"]').click();
      await page.getByRole("button", { name: "카드 돌리기" }).click();
      await page.screenshot({
        path: `test-results-pages/dark-card-${width}.png`,
      });
    } finally {
      await context.close();
    }
  });
}
