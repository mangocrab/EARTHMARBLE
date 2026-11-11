import { test, expect, type Page, type Frame } from "@playwright/test";
async function login(p: Page | Frame, name: string) {
  await p.goto("/");
  await p.getByLabel("탐사대원 닉네임").fill(name);
  await p.getByRole("button", { name: "탐사대원 등록" }).click();
  await expect(p.getByRole("button", { name: "자동 매칭" })).toBeVisible();
}
test("Pages 브라우저 두 명이 방 목록 선택·비밀번호·게임 상태를 직접 동기화한다", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    A = await a.newPage(),
    B = await b.newPage();
  try {
    await login(A, "방장");
    await login(B, "손님");
    await A.getByRole("button", { name: "방 만들기" }).click();
    await expect(A.getByLabel("방 유형")).toHaveCount(0);
    await A.getByLabel("AI 대원 초대 허용").uncheck();
    await A.getByLabel("최대 인원").selectOption("2");
    await A.getByLabel("탐사 시간").selectOption("20");
    await A.getByLabel("방 비밀번호").fill("earth");
    await A.getByRole("button", { name: "탐사대 만들기" }).click();
    await expect(A.locator(".waiting h1")).toHaveText("방장님의 방");
    await expect(A.locator(".waiting")).toContainText("20분 탐사 · 최대 2명");
    await expect(
      A.getByRole("button", { name: "AI 초대", exact: true }),
    ).toHaveCount(0);
    await expect(A.getByRole("status")).toContainText(
      "친구는 방 목록에서 이 방을 선택",
    );
    const hostName = await A.locator(".waiting strong").innerText();
    // Switching tabs must not replace the shared room with the dormant solo state.
    await A.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      delete (document as any).hidden;
    });
    await expect(A.locator(".waiting strong")).toHaveText(hostName);
    await B.getByRole("button", { name: "방 참가하기" }).click();
    await expect(B.getByLabel("방 코드")).toHaveCount(0);
    await B.getByRole("button", {
      name: "방장님의 방 참가",
      exact: true,
    }).click();
    await B.getByLabel("비밀번호", { exact: true }).fill("wrong");
    await B.getByRole("dialog")
      .getByRole("button", { name: "참가하기" })
      .click();
    await expect(B.getByRole("alert")).toContainText("비밀번호");
    await B.getByLabel("비밀번호", { exact: true }).fill("earth");
    await B.getByRole("dialog")
      .getByRole("button", { name: "참가하기" })
      .click();
    await expect(B.locator(".waiting h1")).toContainText("방장", {
      timeout: 15000,
    });
    await expect(A.locator(".crew-list")).toContainText("손님");
    await A.getByRole("button", { name: "준비 완료", exact: true }).click();
    await B.getByRole("button", { name: "준비 완료", exact: true }).click();
    await A.getByRole("button", { name: "탐사 시작" }).click();
    await expect(A.locator(".tile")).toHaveCount(40);
    await expect(B.locator(".tile")).toHaveCount(40);
    await expect(B.getByRole("button", { name: "주사위 굴리기" })).toHaveCount(
      0,
    );
    await A.getByRole("button", { name: "주사위 굴리기" }).click();
    await expect(B.locator(".live-activity")).toContainText("방장 · 주사위");
    await expect
      .poll(
        () =>
          B.locator('.tokens span[title="방장"]').evaluate(
            (e) => e.closest(".tile")?.getAttribute("data-tile") ?? "0",
          ),
        { timeout: 10000 },
      )
      .not.toBe("0");
  } finally {
    await a.close();
    await b.close();
  }
});
test("서버 주소 없이 실제 두 브라우저가 자동 매칭된다", async ({ browser }) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    A = await a.newPage(),
    B = await b.newPage();
  try {
    await login(A, "매칭1");
    await login(B, "매칭2");
    await A.getByRole("button", { name: "자동 매칭" }).click();
    await expect(A.locator(".matching")).toBeVisible();
    await B.getByRole("button", { name: "자동 매칭" }).click();
    await expect
      .poll(
        async () =>
          (await A.locator(".tile").count()) === 40 ||
          (
            await A.locator(".matching")
              .textContent()
              .catch(() => "")
          )?.includes("대기 2명"),
        { timeout: 25000 },
      )
      .toBeTruthy();
    await expect(A.locator(".tile")).toHaveCount(40, { timeout: 20000 });
    await expect(B.locator(".tile")).toHaveCount(40, { timeout: 20000 });
    await expect(A.locator(".players-panel")).toContainText("매칭2");
    await expect(B.locator(".players-panel")).toContainText("매칭1");
  } finally {
    await a.close();
    await b.close();
  }
});

test("온라인 방에 AI만 초대해 시작하면 저장되는 싱글플레이가 된다", async ({
  page,
}) => {
  await login(page, "AI방장");
  await page.getByRole("button", { name: "방 만들기" }).click();
  await expect(page.getByLabel("방 유형")).toHaveCount(0);
  await page.getByRole("button", { name: "탐사대 만들기" }).click();
  await page.getByRole("button", { name: "AI 초대", exact: true }).click();
  await page.getByRole("button", { name: "준비 완료", exact: true }).click();
  await page.getByRole("button", { name: "탐사 시작" }).click();
  await expect(page.locator(".tile")).toHaveCount(40);
  await expect(
    page.getByRole("button", { name: "일시정지", exact: true }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("earthmarble.solo.v1")!),
  );
  expect(saved.room.game.players).toHaveLength(2);
  expect(saved.room.game.players[1].ai).toBe("normal");
  await page.reload();
  await expect(page.locator(".tile")).toHaveCount(40);
});
test("매칭 취소 후 다른 싱글플레이 방을 만들 수 있다", async ({ page }) => {
  await login(page, "취소대원");
  await page.getByRole("button", { name: "자동 매칭" }).click();
  await expect(page.locator(".matching")).toBeVisible();
  await page.getByRole("button", { name: "매칭 취소" }).click();
  await expect(page.getByRole("button", { name: "방 만들기" })).toBeVisible();
  await page.getByRole("button", { name: "방 만들기" }).click();
  await page.getByRole("button", { name: "탐사대 만들기" }).click();
  await expect(page.locator(".waiting h1")).toContainText("취소대원");
});

test("친구 연결이 차단돼도 같은 방에서 AI를 초대해 바로 싱글플레이할 수 있다", async ({
  page,
}) => {
  await page.routeWebSocket("ws://127.0.0.1:3206/**", (socket) =>
    socket.close(),
  );
  await login(page, "연결없는대원");
  await page.getByRole("button", { name: "방 만들기" }).click();
  await page.getByRole("button", { name: "탐사대 만들기" }).click();
  await expect(page.locator(".waiting strong")).toHaveText("연결없는대원");
  await expect(page.getByRole("status")).toContainText(
    "방 목록에 등록하지 못했습니다.",
  );
  await page.getByLabel("AI 난이도").selectOption("easy");
  await page.getByRole("button", { name: "AI 초대", exact: true }).click();
  await page.getByRole("button", { name: "준비 완료", exact: true }).click();
  await page.getByRole("button", { name: "탐사 시작" }).click();
  await expect(page.locator(".tile")).toHaveCount(40);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("earthmarble.solo.v1")!),
  );
  expect(saved.room.game.players[1].ai).toBe("easy");
  await page.reload();
  await expect(page.locator(".tile")).toHaveCount(40);
});

test("방장이 사람과 AI를 강퇴하면 대기실과 상대 화면에 즉시 반영된다", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext();
  const hostPage = await a.newPage(),
    B = await b.newPage();
  await hostPage.goto("/embed-example.html");
  const A = hostPage.frames().find((frame) => frame.parentFrame())!;
  try {
    await login(A, "강퇴방장");
    await login(B, "강퇴손님");
    await A.getByRole("button", { name: "방 만들기" }).click();
    await A.getByRole("button", { name: "탐사대 만들기" }).click();
    await expect(A.getByRole("status")).toContainText("친구는 방 목록에서");
    await B.getByRole("button", { name: "방 참가하기" }).click();
    await B.getByRole("button", {
      name: "강퇴방장님의 방 참가",
      exact: true,
    }).click();
    await expect(B.locator(".waiting h1")).toContainText("강퇴방장");
    await expect(B.getByRole("button", { name: /내보내기/ })).toHaveCount(0);
    await A.getByRole("button", { name: "AI 초대", exact: true }).click();
    const bot = A.locator(".crew-list article").filter({ hasText: "AI ·" });
    await bot.getByRole("button", { name: /내보내기/ }).click();
    await expect(
      A.locator(".crew-list article").filter({ hasText: "AI ·" }),
    ).toHaveCount(0);
    await A.getByRole("button", {
      name: "강퇴손님 내보내기",
      exact: true,
    }).click();
    await expect(B.getByRole("button", { name: "방 만들기" })).toBeVisible();
    await expect(B.getByRole("alert")).toContainText(
      "방장이 대기실에서 내보냈습니다",
    );
    await B.getByRole("button", { name: "방 참가하기" }).click();
    await B.getByRole("button", {
      name: "강퇴방장님의 방 참가",
      exact: true,
    }).click();
    await expect(B.getByRole("alert")).toContainText(
      "강퇴되어 다시 참가할 수 없습니다",
    );
    await expect(A.locator(".waiting h1")).toHaveText("강퇴방장님의 방");
  } finally {
    await a.close();
    await b.close();
  }
});

test("열린 방 목록은 새 방·정원·AI 변경·시작을 실시간으로 반영한다", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    c = await browser.newContext();
  const A = await a.newPage(),
    B = await b.newPage(),
    C = await c.newPage();
  try {
    await login(A, "목록방장");
    await login(B, "목록구경");
    await login(C, "목록손님");
    await C.getByRole("button", { name: "방 참가하기" }).click();
    await expect(C.getByRole("status")).toContainText("열린 방이 없습니다", {
      timeout: 15000,
    });
    await A.getByRole("button", { name: "방 만들기" }).click();
    await A.getByLabel("최대 인원").selectOption("2");
    await A.getByRole("button", { name: "탐사대 만들기" }).click();
    const row = C.getByRole("button", {
      name: "목록방장님의 방 참가",
      exact: true,
    });
    await expect(row).toContainText("1/2명", { timeout: 20000 });
    await A.getByRole("button", { name: "AI 초대", exact: true }).click();
    await expect(row).toContainText("2/2명");
    await expect(row).toBeDisabled();
    await A.getByRole("button", { name: /탐사봇.*내보내기/ }).click();
    await expect(row).toBeEnabled();
    await expect(row).toContainText("1/2명");
    await B.getByRole("button", { name: "방 참가하기" }).click();
    const observer = B.getByRole("button", {
      name: "목록방장님의 방 참가",
      exact: true,
    });
    await expect(observer).toBeVisible({ timeout: 20000 });
    // The first browser browsing an empty directory can subsequently join a room.
    await row.click();
    await expect(C.locator(".waiting h1")).toHaveText("목록방장님의 방");
    await expect(A.locator(".crew-list")).toContainText("목록손님");
    await expect(observer).toBeDisabled({ timeout: 25000 });
    await A.getByRole("button", { name: "준비 완료", exact: true }).click();
    await C.getByRole("button", { name: "준비 완료", exact: true }).click();
    await A.getByRole("button", { name: "탐사 시작" }).click();
    await expect(observer).toHaveCount(0, { timeout: 25000 });
    await expect(B.getByRole("status")).toContainText("열린 방이 없습니다", {
      timeout: 25000,
    });
  } finally {
    await a.close();
    await b.close();
    await c.close();
  }
});

test("목록을 중계하던 방장이 나가도 다른 열린 방은 다시 목록에 나타난다", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    c = await browser.newContext();
  const A = await a.newPage(),
    B = await b.newPage(),
    C = await c.newPage();
  try {
    await login(A, "첫방장");
    await login(B, "둘째방장");
    await login(C, "목록대원");
    for (const p of [A, B]) {
      await p.getByRole("button", { name: "방 만들기" }).click();
      await p.getByRole("button", { name: "탐사대 만들기" }).click();
      await expect(p.getByRole("status")).toContainText("친구는 방 목록", {
        timeout: 15000,
      });
    }
    await C.getByRole("button", { name: "방 참가하기" }).click();
    await expect(
      C.getByRole("button", { name: "첫방장님의 방 참가", exact: true }),
    ).toBeVisible({ timeout: 20000 });
    await expect(
      C.getByRole("button", { name: "둘째방장님의 방 참가", exact: true }),
    ).toBeVisible();
    await a.close();
    await expect(
      C.getByRole("button", { name: "첫방장님의 방 참가", exact: true }),
    ).toHaveCount(0, { timeout: 30000 });
    await C.getByRole("button", {
      name: "둘째방장님의 방 참가",
      exact: true,
    }).click({ timeout: 30000 });
    await expect(C.locator(".waiting h1")).toHaveText("둘째방장님의 방");
  } finally {
    await a.close();
    await b.close();
    await c.close();
  }
});
