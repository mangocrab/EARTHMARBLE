import { defineConfig } from "vite";
export default defineConfig(({ mode }) => {
  const pages = mode === "pages";
  const community = mode === "community";
  const repo = process.env.GITHUB_REPOSITORY?.split("/")[1] || "EARTHMARBLE";
  const path =
    process.env.PAGES_BASE_PATH ||
    (repo.toLowerCase().endsWith(".github.io") ? "/" : `/${repo}/`);
  if (pages && (!path.startsWith("/") || path.startsWith("//")))
    throw new Error("PAGES_BASE_PATH must be an absolute pathname");
  return {
    base:
      (pages
        ? path
        : process.env.GAME_BASE_PATH ||
          (community ? "/minigames/earthmarble/" : "/")
      ).replace(/\/+$/, "") + "/",
    build: {
      outDir: pages ? "dist-pages" : community ? "dist-community" : "dist",
      chunkSizeWarningLimit: 800,
    },
  };
});
