import { beforeAll, afterAll, it, expect } from "vitest";
import express from "express";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { io, type Socket } from "socket.io-client";
import { randomUUID } from "node:crypto";
import { createEarthMarble } from "../game-server/index";
import { createIdentityAdapter, signAccount } from "./fixtures/site-adapter";
const data = mkdtempSync(join(tmpdir(), "earth-community-"));
const prefix = "/minigames/earthmarble/";
let game: Awaited<ReturnType<typeof createEarthMarble>>, url: string;
const clients: Socket[] = [];
const key = "community-unit-only";
const siteCookie = (id: string) =>
  `site_session=${signAccount({ id, name: id === "owner" ? "커뮤니티 대원" : "방문 대원", profile: "/community/avatar.png" }, key)}`;
let title = "지구 수호자";
let slowCatalog: Promise<void> | undefined;
let catalogStarted: (() => void) | undefined;
beforeAll(async () => {
  process.env.SITE_TEST_SIGNING_KEY = key;
  const host = express(),
    server = createServer(host);
  host.get("/community/ping", (_req, res) => res.json({ community: true }));
  const adapter = createIdentityAdapter();
  adapter.profile = async () => ({
    banner: "/community/banner.png",
    frame: "/community/frame.png",
    title,
    url: "/members/owner",
  });
  adapter.emojis = async (identity) => {
    if (slowCatalog) {
      catalogStarted?.();
      await slowCatalog;
    }
    return identity.id === "owner"
      ? [
          {
            id: "community_hello",
            label: "커뮤니티 인사",
            url: "/community/hello.png",
          },
        ]
      : [];
  };
  game = await createEarthMarble({
    app: host,
    httpServer: server,
    identityAdapter: adapter,
    basePath: prefix,
    dataDir: data,
    serveAssets: false,
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(async () => {
  clients.forEach((s) => s.disconnect());
  await game?.close();
  rmSync(data, { recursive: true, force: true });
});
async function login(id: string) {
  const site = siteCookie(id);
  const r = await fetch(url + prefix + "api/session", {
    method: "POST",
    headers: { cookie: site, "content-type": "application/json" },
    body: JSON.stringify({
      id: "forged",
      name: "위조 이름",
      title: "위조 칭호",
    }),
  });
  expect(r.status).toBe(200);
  expect((await r.json()).id).toBe(id);
  expect(r.headers.get("set-cookie")).toContain(`Path=${prefix}`);
  return site + "; " + r.headers.get("set-cookie")!.split(";")[0];
}
it("같은 HTTP 서버의 커뮤니티 라우트와 하위 경로의 게임 인증·프로필·개인 이모티콘을 연결한다", async () => {
  expect(await (await fetch(url + "/community/ping")).json()).toEqual({
    community: true,
  });
  expect((await fetch(url + prefix + "api/me")).status).toBe(401);
  const cookie = await login("owner");
  const profile = await (
    await fetch(url + prefix + "api/profile/owner", { headers: { cookie } })
  ).json();
  expect(profile).toMatchObject({
    id: "owner",
    name: "커뮤니티 대원",
    profile: "/community/avatar.png",
    banner: "/community/banner.png",
    frame: "/community/frame.png",
    title,
    url: "/members/owner",
  });
  title = "새 커뮤니티 칭호";
  expect(
    (
      await (
        await fetch(url + prefix + "api/profile/owner", { headers: { cookie } })
      ).json()
    ).title,
  ).toBe(title);
  const catalog = await (
    await fetch(url + prefix + "api/emojis", { headers: { cookie } })
  ).json();
  expect(catalog).toHaveLength(21);
  expect(catalog).toContainEqual({
    id: "community_hello",
    label: "커뮤니티 인사",
    url: "/community/hello.png",
  });
  expect(
    (
      await fetch(url + prefix + "api/emojis", {
        headers: {
          cookie: "site_session=tampered; " + cookie.split("; ").at(-1),
        },
      })
    ).status,
  ).toBe(401);
});
it("매칭에서도 보유한 커뮤니티 이모티콘만 보내며 자유 입력과 미보유 ID는 거절한다", async () => {
  async function connect(id: string) {
    const cookie = await login(id);
    const socket = io(url, {
      path: prefix + "socket.io",
      transports: ["websocket"],
      extraHeaders: { cookie },
      reconnection: false,
    });
    clients.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("connect_error", reject);
    });
    let state: any;
    socket.on("state", (s) => {
      state = s;
    });
    const command = (data: object) =>
      new Promise<any>((done) =>
        socket.emit(
          "command",
          { requestId: randomUUID(), version: 0, ...data },
          done,
        ),
      );
    return {
      socket,
      command,
      get state() {
        return state;
      },
    };
  }
  const A = await connect("owner"),
    B = await connect("guest");
  expect((await A.command({ type: "match", mode: "quick" })).ok).toBe(true);
  expect((await B.command({ type: "match", mode: "quick" })).ok).toBe(true);
  await expect.poll(() => A.state?.room?.mode).toBe("quick");
  expect(
    (await B.command({ type: "chat", kind: "emoji", emoji: "community_hello" }))
      .ok,
  ).toBe(false);
  expect(
    (await B.command({ type: "chat", kind: "text", text: "금지" })).ok,
  ).toBe(false);
  expect(
    (
      await A.command({
        type: "chat",
        kind: "emoji",
        emoji: "community_hello",
        url: "https://untrusted.example/fake.png",
      })
    ).ok,
  ).toBe(true);
  await expect
    .poll(() => B.state?.room?.chat?.at(-1)?.emoji?.url)
    .toBe("/community/hello.png");
});

it("느린 이모티콘 조회와 실패한 전송이 다른 참가자의 채팅을 잠그거나 되돌리지 않는다", async () => {
  const A = clients[0],
    B = clients[1];
  let state: any;
  A.on("state", (value) => {
    state = value;
  });
  const send = (socket: Socket, data: object) =>
    new Promise<any>((done) =>
      socket.emit(
        "command",
        { requestId: randomUUID(), version: 0, ...data },
        done,
      ),
    );
  let release!: () => void;
  slowCatalog = new Promise<void>((done) => {
    release = done;
  });
  const started = new Promise<void>((done) => {
    catalogStarted = done;
  });
  const pending = send(A, { type: "chat", kind: "emoji", emoji: "not_owned" });
  try {
    await started;
    expect((await send(B, { type: "chat", kind: "quick", quick: 0 })).ok).toBe(
      true,
    );
  } finally {
    release();
    slowCatalog = undefined;
    catalogStarted = undefined;
  }
  expect((await pending).ok).toBe(false);
  await expect.poll(() => state?.room?.chat?.at(-1)?.text).toBe("안녕하세요!");
});
