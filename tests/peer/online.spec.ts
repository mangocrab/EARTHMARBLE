import { test, expect, type Page } from "@playwright/test";
async function login(p: Page, name: string) {
  await p.goto("/");
  await p.getByLabel("탐사대원 닉네임").fill(name);
  await p.getByRole("button", { name: "탐사대원 등록" }).click();
  await expect(p.getByRole("button", { name: "자동 매칭" })).toBeVisible();
}
test("Pages 브라우저 두 명이 방 코드로 접속·준비·게임 상태를 직접 동기화한다", async ({
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
    await A.getByLabel("방 유형").selectOption("online");
    await A.getByLabel("방 비밀번호").fill("earth");
    await A.getByRole("button", { name: "탐사대 만들기" }).click();
    const code = await A.locator(".waiting strong").innerText();
    await B.getByRole("button", { name: "방 참가하기" }).click();
    await B.getByLabel("방 코드").fill(code);
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
      .poll(() =>
        B.locator('.tokens span[title="방장"]').evaluate((e) =>
          e.closest(".tile")!.getAttribute("data-tile"),
        ),
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
  await page.getByLabel("방 유형").selectOption("online");
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
