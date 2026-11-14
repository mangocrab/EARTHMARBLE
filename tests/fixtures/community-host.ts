import express from "express";
import { createServer } from "node:http";
import { createEarthMarble } from "../../game-server/index";
import { createIdentityAdapter } from "./site-adapter";
const app = express(),
  server = createServer(app);
app.get("/community/ping", (_req, res) => res.json({ community: true }));
app.get("/community", (_req, res) =>
  res.send(
    '<h1>테스트 커뮤니티</h1><iframe title="커뮤니티 미니게임" src="/minigames/earthmarble/" style="border:0;width:100%;height:90dvh"></iframe>',
  ),
);
app.get("/community-assets/:asset", (req, res) => {
  const asset = req.params.asset;
  const body =
    asset === "frame.svg"
      ? '<rect x="2" y="2" width="60" height="60" rx="12" fill="none" stroke="#ac8647" stroke-width="4"/>'
      : asset === "banner.svg"
        ? '<rect width="64" height="64" fill="#494955"/>'
        : '<circle cx="32" cy="32" r="26" fill="#8c7897"/>';
  res
    .type("image/svg+xml")
    .send(
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">${body}</svg>`,
    );
});
const adapter = createIdentityAdapter();
adapter.profile = async () => ({
  banner: "/community-assets/banner.svg",
  frame: "/community-assets/frame.svg",
  title: "지구 수호자",
  url: "/community",
});
adapter.emojis = async () => [
  {
    id: "community_wave",
    label: "커뮤니티 인사",
    url: "/community-assets/sticker.svg",
  },
];
await createEarthMarble({
  app,
  httpServer: server,
  identityAdapter: adapter,
  basePath: "/minigames/earthmarble/",
  distDir: "dist-community",
  development: false,
  dataDir: ".data/e2e-community",
});
server.listen(3220, "127.0.0.1");
