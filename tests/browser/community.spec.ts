import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { signAccount } from "../fixtures/site-adapter";
test("같은 커뮤니티 서버의 iframe에서 계정·프로필 장식·이모티콘과 바로 채팅을 사용한다", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
  });
  const url = "http://127.0.0.1:3220";
  try {
    await context.addCookies([
      {
        name: "site_session",
        value: signAccount(
          {
            id: "site:" + randomUUID(),
            name: "커뮤니티 회원",
            profile: "/community-assets/avatar.svg",
            frame: "/community-assets/frame.svg",
            title: "지구 수호자",
          },
          "earth-tests-only",
        ),
        url,
        httpOnly: true,
      },
    ]);
    const page = await context.newPage();
    await page.goto(url + "/community");
    const game = page.frameLocator('iframe[title="커뮤니티 미니게임"]');
    await expect(game.locator(".identity")).toContainText("커뮤니티 회원");
    await expect(game.getByLabel("탐사대원 닉네임")).toHaveCount(0);
    await game.getByRole("button", { name: "내 프로필과 전적" }).click();
    await expect(game.locator(".profile-card")).toContainText("지구 수호자");
    await expect(game.locator(".community-banner")).toHaveAttribute(
      "src",
      "/community-assets/banner.svg",
    );
    for (const selector of [
      ".community-banner",
      ".avatar-photo",
      ".community-frame",
    ]) {
      await expect
        .poll(() =>
          game
            .locator(".profile-card " + selector)
            .evaluate((img: HTMLImageElement) => img.naturalWidth),
        )
        .toBeGreaterThan(0);
    }
    await page.screenshot({ path: "test-results/community-profile.png" });
    await page.keyboard.press("Escape");
    await game.getByRole("button", { name: "방 만들기" }).click();
    await game.getByRole("button", { name: "탐사대 만들기" }).click();
    await game
      .getByRole("textbox", { name: "바로 채팅 입력", exact: true })
      .fill("커뮤니티에서 바로 대화");
    await game
      .getByRole("button", { name: "바로 채팅 전송", exact: true })
      .click();
    await expect(game.getByRole("region", { name: "최근 채팅" })).toContainText(
      "커뮤니티에서 바로 대화",
    );
    const nextDraft = game.getByRole("textbox", {
      name: "바로 채팅 입력",
      exact: true,
    });
    await nextDraft.fill("다음 메시지는 미리 작성");
    await expect(nextDraft).toBeEnabled();
    await expect(
      game.getByRole("button", { name: "바로 채팅 전송", exact: true }),
    ).toBeDisabled();
    await game
      .getByRole("region", { name: "최근 채팅" })
      .getByRole("button", { name: "이모티콘", exact: true })
      .click();
    await game.getByRole("button", { name: "커뮤니티", exact: true }).click();
    const sticker = game.getByRole("button", {
      name: "커뮤니티 인사 이모티콘",
      exact: true,
    });
    await expect(sticker).toBeEnabled({ timeout: 5000 });
    await sticker.click();
    await expect(
      game
        .getByRole("region", { name: "최근 채팅" })
        .getByAltText("커뮤니티 인사"),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
