import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { io } from "socket.io-client";
import { signAccount } from "../fixtures/site-adapter";
const url = "http://127.0.0.1:3199";
test("서명된 사이트 계정 자동 로그인, 프로필 표시와 위조 거부", async ({
  browser,
}) => {
  const accountId = "site:" + randomUUID();
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: "site_session",
      value: signAccount(
        { id: accountId, name: "사이트 대원", profile: "/earth.svg" },
        "earth-tests-only",
      ),
      url,
      httpOnly: true,
    },
  ]);
  const page = await context.newPage();
  await page.goto(url);
  await expect(page.getByRole("button", { name: "방 만들기" })).toBeEnabled();
  await expect(page.getByLabel("탐사대원 닉네임")).toHaveCount(0);
  await expect(page.locator(".identity")).toContainText("사이트 대원");
  const response = await page.request.post(url + "/api/session", {
    data: { name: "위조 이름", id: "other" },
  });
  expect((await response.json()).id).toBe(accountId);
  await page.getByRole("button", { name: "방 만들기" }).click();
  await page.getByRole("button", { name: "탐사대 만들기" }).click();
  await expect(page.locator(".crew-list img")).toHaveAttribute(
    "src",
    "/earth.svg",
  );
  await expect
    .poll(() =>
      page
        .locator(".crew-list img")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await context.addCookies([
    { name: "site_session", value: "tampered.signature", url, httpOnly: true },
  ]);
  await page.reload();
  await expect(page.getByText("사이트 계정으로 탐사하기")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("사이트에 먼저 로그인");
  await expect(page.getByLabel("탐사대원 닉네임")).toHaveCount(0);
  expect(
    (
      await page.request.post(url + "/api/session", { data: { name: "시도" } })
    ).status(),
  ).toBe(401);
  const cookie = (await context.cookies())
    .map((c) => `${c.name}=${c.value}`)
    .join(";");
  const probe = io(url, {
    transports: ["websocket"],
    extraHeaders: { cookie },
    reconnection: false,
  });
  const rejected = await new Promise<string>((resolve, reject) => {
    probe.on("connect", () =>
      reject(new Error("Forged site session accepted")),
    );
    probe.on("connect_error", (e) => resolve(e.message));
  });
  probe.disconnect();
  expect(rejected).toContain("사이트 로그인");
  await context.addCookies([
    {
      name: "site_session",
      value: signAccount(
        { id: accountId, name: "사이트 대원", profile: "/earth.svg" },
        "earth-tests-only",
      ),
      url,
      httpOnly: true,
    },
  ]);
  await page.getByRole("button", { name: "사이트 로그인 다시 확인" }).click();
  await expect(page.getByText("사이트 대원님의 방")).toBeVisible();
  await context.close();
});
