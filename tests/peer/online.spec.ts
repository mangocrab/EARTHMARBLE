import { test, expect, type Page, type Frame } from "@playwright/test";
async function login(p: Page | Frame, name: string) {
  await ("addInitScript" in p ? p : p.page()).addInitScript(() => {
    crypto.getRandomValues = ((b: Uint32Array) => {
      b.fill(0);
      return b;
    }) as typeof crypto.getRandomValues;
  });
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
    await expect(A.locator(".waiting").getByRole("status")).toContainText(
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
    await A.getByRole("button", {
      name: "빠른게임 (2인)",
      exact: true,
    }).click();
    await expect(A.locator(".matching")).toBeVisible();
    await B.getByRole("button", { name: "자동 매칭" }).click();
    await B.getByRole("button", {
      name: "빠른게임 (2인)",
      exact: true,
    }).click();
    await expect(A.locator(".tile")).toHaveCount(40, { timeout: 20000 });
    await expect(B.locator(".tile")).toHaveCount(40, { timeout: 20000 });
    await expect(A.locator(".players-panel")).toContainText("매칭2");
    await expect(B.locator(".players-panel")).toContainText("매칭1");
    await A.getByRole("button", { name: "채팅", exact: true }).click();
    await expect(A.getByRole("textbox", { name: "채팅 메시지" })).toHaveCount(
      0,
    );
    await A.getByRole("button", {
      name: "양이 하트 이모티콘",
      exact: true,
    }).click();
    const received = B.getByRole("region", { name: "최근 채팅" }).getByAltText(
      "양이 하트",
    );
    await expect(received).toBeVisible();
    await expect
      .poll(() => received.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBe(512);
    await expect(
      A.getByRole("button", { name: "양이 하트 이모티콘", exact: true }),
    ).toBeDisabled();
    await B.getByRole("button", { name: "채팅", exact: true }).click();
    await B.getByRole("button", { name: "지온", exact: true }).click();
    await B.getByRole("button", {
      name: "지온 최고 이모티콘",
      exact: true,
    }).click();
    await expect(
      A.getByRole("log", { name: "방 채팅" }).getByAltText("지온 최고"),
    ).toBeVisible();
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
  await page
    .getByRole("button", { name: "빠른게임 (2인)", exact: true })
    .click();
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
  // Stop the deliberately rejected socket attempts before closing the routed context.
  await page.goto("about:blank");
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
    await expect(A.locator(".waiting").getByRole("status")).toContainText(
      "친구는 방 목록에서",
    );
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
      "방장이 방에서 내보냈습니다",
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
    const playing = B.getByRole("button", {
      name: "목록방장님의 방 관전",
      exact: true,
    });
    await expect(playing).toBeVisible();
    await expect(playing).toContainText("게임 중");
    await expect(playing).toContainText("목록손님");
    await expect(playing).toContainText("분 경과");
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
      await expect(p.locator(".waiting").getByRole("status")).toContainText(
        "친구는 방 목록",
        {
          timeout: 15000,
        },
      );
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

test("게임 중 관전 입장·시점 전환·자유 채팅·방장 강퇴", async ({ browser }) => {
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const [A, B, C] = await Promise.all(contexts.map((c) => c.newPage()));
  try {
    await login(A, "관전방장");
    await login(B, "관전대원");
    await login(C, "지켜보는사람");
    await A.getByRole("button", { name: "방 만들기" }).click();
    await A.getByLabel("최대 인원").selectOption("2");
    await A.getByRole("button", { name: "탐사대 만들기" }).click();
    await B.getByRole("button", { name: "방 참가하기" }).click();
    await B.getByRole("button", {
      name: "관전방장님의 방 참가",
      exact: true,
    }).click({ timeout: 20000 });
    for (const P of [A, B])
      await P.getByRole("button", { name: "준비 완료", exact: true }).click();
    await A.getByRole("button", { name: "탐사 시작" }).click();
    await C.getByRole("button", { name: "방 참가하기" }).click();
    const row = C.getByRole("button", {
      name: "관전방장님의 방 관전",
      exact: true,
    });
    await expect(row).toContainText("게임 중", { timeout: 20000 });
    await expect(row).toContainText("관전대원");
    await expect(row).toContainText("분 경과");
    await row.click();
    await expect(C.locator(".tile")).toHaveCount(40);
    await C.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        C.locator(".board-scroll").evaluate((e) => {
          const r = e.getBoundingClientRect();
          return (
            r.left >= 0 &&
            r.right <= innerWidth + 1 &&
            r.top >= 0 &&
            r.bottom <= innerHeight + 1
          );
        }),
      )
      .toBe(true);
    await expect(C.getByRole("button", { name: "주사위 굴리기" })).toHaveCount(
      0,
    );
    await expect(C.locator(".watching-player")).toContainText("관전방장");
    await C.getByRole("button", {
      name: "관전대원 화면 관전",
      exact: true,
    }).click();
    await expect(C.locator(".watching-player")).toContainText("관전대원");
    await C.screenshot({ path: "test-results-peer/spectator-mobile.png" });
    await C.getByRole("button", { name: "채팅", exact: true }).click();
    await C.getByRole("textbox", { name: "채팅 메시지" }).fill(
      "잘 보고 있어요",
    );
    await C.getByRole("button", { name: "전송", exact: true }).click();
    await expect(C.locator(".spectator-message")).toContainText("관전");
    await expect(
      C.getByRole("button", { name: "전송", exact: true }),
    ).toBeDisabled();
    await expect(A.locator(".chat-unread")).toHaveText("1");
    await expect(A.getByRole("region", { name: "최근 채팅" })).toContainText(
      "잘 보고 있어요",
    );
    await A.getByRole("button", { name: /채팅 열기/ }).click();
    await expect(A.getByRole("log", { name: "방 채팅" })).toContainText(
      "잘 보고 있어요",
    );
    await expect(A.locator(".chat-unread")).toHaveCount(0);
    await A.keyboard.press("Escape");
    await A.getByRole("button", { name: /관전 목록/ }).click();
    await expect(A.getByRole("dialog")).toContainText("지켜보는사람");
    await A.getByRole("button", {
      name: "지켜보는사람 관전 강퇴",
      exact: true,
    }).click();
    await expect(C.getByRole("alert")).toContainText("방장이 방에서");
    await expect(C.getByRole("dialog")).toHaveCount(0);
    await expect(C.getByRole("button", { name: "방 만들기" })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test("일반 매칭 30초 안내에서 거절은 유지하고 수락은 빠른게임으로 전환한다", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    A = await a.newPage();
  try {
    await A.clock.install();
    await login(A, "오래기다림");
    await A.getByRole("button", { name: "자동 매칭" }).click();
    await A.getByRole("button", {
      name: "일반게임 (4인)",
      exact: true,
    }).click();
    await expect(A.locator(".matching")).toContainText("일반게임");
    await expect(A.locator(".matching")).toContainText("대기 1명");
    await A.clock.fastForward(31000);
    await expect(A.getByRole("alertdialog")).toContainText(
      "현재 4인게임 매칭이 지연되고 있습니다.",
    );
    await A.getByRole("button", {
      name: "거절 · 일반게임 유지",
      exact: true,
    }).click();
    await A.clock.fastForward(31000);
    await expect(A.getByRole("alertdialog")).toHaveCount(0);
    await expect(A.locator(".matching")).toContainText("일반게임");
    await A.getByRole("button", { name: "매칭 취소", exact: true }).click();
    await A.getByRole("button", { name: "자동 매칭" }).click();
    await A.getByRole("button", {
      name: "일반게임 (4인)",
      exact: true,
    }).click();
    await expect(A.locator(".matching")).toContainText("일반게임");
    await expect(A.locator(".matching")).toContainText("대기 1명");
    await A.clock.fastForward(31000);
    await A.getByRole("button", {
      name: "수락 · 빠른게임으로 변경",
      exact: true,
    }).click();
    await expect(A.locator(".matching")).toContainText("빠른게임 · 2인");
    await expect(A.getByRole("alertdialog")).toHaveCount(0);
  } finally {
    await a.close();
  }
});

test("사람끼리 끝낸 게임 전적은 양쪽 기기에 한 번만 저장하고 상세보기에 반영한다", async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    A = await a.newPage(),
    B = await b.newPage();
  try {
    await A.clock.install();
    await login(A, "기록주인");
    await login(B, "기록손님");
    await A.getByRole("button", { name: "방 만들기" }).click();
    await A.getByRole("button", { name: "탐사대 만들기" }).click();
    await B.getByRole("button", { name: "방 참가하기" }).click();
    await B.getByRole("button", {
      name: "기록주인님의 방 참가",
      exact: true,
    }).click({ timeout: 20000 });
    for (const P of [A, B])
      await P.getByRole("button", { name: "준비 완료", exact: true }).click();
    await A.getByRole("button", { name: "탐사 시작" }).click();
    await expect(B.locator(".tile")).toHaveCount(40);
    await A.clock.fastForward(31 * 60000);
    await expect(A.locator(".result-dialog")).toBeVisible();
    await expect(B.locator(".result-dialog")).toBeVisible();
    for (const P of [A, B]) {
      await P.getByRole("button", { name: "전적 보기", exact: true }).click();
      await expect(P.locator(".profile-card")).toContainText("전체 1판");
      await P.getByRole("button", { name: "상세보기", exact: true }).click();
      await expect(P.locator(".records-table tbody tr")).toHaveCount(4);
      await P.keyboard.press("Escape");
    }
    await A.clock.fastForward(10000);
    await A.getByRole("button", { name: "전적 보기", exact: true }).click();
    await expect(A.locator(".profile-card")).toContainText("전체 1판");
  } finally {
    await a.close();
    await b.close();
  }
});

test("Pages 새로고침은 대기실·게임·관전 자리를 복구하고 개인 방에서 재경기한다", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext(),
    browser.newContext(),
  ]);
  const [A, B, C] = await Promise.all(contexts.map((c) => c.newPage()));
  try {
    await A.clock.install();
    await login(A, "복구방장");
    await login(B, "복구대원");
    await login(C, "복구관전");
    await A.getByRole("button", { name: "방 만들기" }).click();
    await A.getByRole("button", { name: "탐사대 만들기" }).click();
    await B.getByRole("button", { name: "방 참가하기" }).click();
    await B.getByRole("button", {
      name: "복구방장님의 방 참가",
      exact: true,
    }).click({ timeout: 20000 });
    await expect(B.locator(".waiting h1")).toHaveText("복구방장님의 방");
    expect(
      await B.evaluate(() => {
        const r = JSON.parse(
          sessionStorage.getItem("earthmarble.peer.v1") || "null",
        );
        return (
          !!r?.token &&
          r.owner ===
            JSON.parse(localStorage.getItem("earthmarble.solo.v1")!).identity.id
        );
      }),
    ).toBe(true);
    await B.reload();
    await expect(B.locator(".waiting h1")).toHaveText("복구방장님의 방", {
      timeout: 20000,
    });
    await expect(A.locator(".crew-list article:not(.empty-seat)")).toHaveCount(
      2,
    );
    for (const P of [A, B])
      await P.getByRole("button", { name: "준비 완료", exact: true }).click();
    await A.getByRole("button", { name: "탐사 시작" }).click();
    await expect(B.locator(".tile")).toHaveCount(40);
    await C.getByRole("button", { name: "방 참가하기" }).click();
    await C.getByRole("button", {
      name: "복구방장님의 방 관전",
      exact: true,
    }).click({ timeout: 20000 });
    await C.getByRole("button", {
      name: "복구대원 화면 관전",
      exact: true,
    }).click();
    await A.getByRole("button", { name: "채팅", exact: true }).click();
    await A.getByRole("textbox", { name: "채팅 메시지" }).fill(
      "새로고침해도 남는 기록",
    );
    await A.getByRole("button", { name: "전송", exact: true }).click();
    await A.keyboard.press("Escape");
    await expect(B.getByRole("region", { name: "최근 채팅" })).toContainText(
      "새로고침해도 남는 기록",
    );
    await A.reload();
    await expect(A.locator(".tile")).toHaveCount(40, { timeout: 25000 });
    await expect(B.getByRole("region", { name: "최근 채팅" })).toContainText(
      "새로고침해도 남는 기록",
    );
    await expect(B.getByRole("alert")).toHaveCount(0);
    await B.reload();
    await expect(B.locator(".tile")).toHaveCount(40, { timeout: 25000 });
    await C.reload();
    await expect(C.locator(".watching-player")).toContainText("복구대원", {
      timeout: 25000,
    });
    await expect(C.getByRole("button", { name: "주사위 굴리기" })).toHaveCount(
      0,
    );
    await A.clock.fastForward(31 * 60000);
    await expect(A.locator(".result-dialog")).toBeVisible();
    await A.getByRole("button", {
      name: "방으로 돌아가기",
      exact: true,
    }).click();
    await expect(A.locator(".waiting h1")).toHaveText("복구방장님의 방");
    await expect(B.locator(".waiting h1")).toHaveText("복구방장님의 방");
    await expect(
      C.getByRole("button", { name: "관전 중", exact: true }),
    ).toBeDisabled();
    for (const P of [A, B])
      await P.getByRole("button", { name: "준비 완료", exact: true }).click();
    await A.getByRole("button", { name: "탐사 시작" }).click();
    await expect(B.locator(".tile")).toHaveCount(40);
    await A.clock.fastForward(31 * 60000);
    await expect(A.locator(".result-dialog")).toBeVisible();
    await A.getByRole("button", { name: "전적 보기", exact: true }).click();
    await expect(A.locator(".profile-card")).toContainText("전체 2판");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test("빠른게임 혼자 60초 대기하면 어려움 AI와 시작한다", async ({ page }) => {
  await page.clock.install();
  await login(page, "AI매칭대원");
  await page.getByRole("button", { name: "자동 매칭" }).click();
  await page
    .getByRole("button", { name: "빠른게임 (2인)", exact: true })
    .click();
  await expect(page.locator(".matching")).toContainText("대기 1명");
  await expect(page.locator(".matching")).toContainText("어려움 AI");
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100));
  await page.clock.fastForward(55000);
  await expect(page.locator(".tile")).toHaveCount(0);
  await page.clock.fastForward(6000);
  await expect(page.locator(".tile")).toHaveCount(40);
  await expect(page.locator(".players-panel")).toContainText(
    "지구 탐사 AI · 어려움",
  );
  await expect(page.locator(".player")).toHaveCount(2);
  await expect(
    page.getByRole("button", { name: /^주사위 굴리기/ }),
  ).toBeEnabled();
});
