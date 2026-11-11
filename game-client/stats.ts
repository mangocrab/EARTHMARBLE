import {
  emptyStats,
  validStats,
  addResult,
  type Stats,
  type GameResult,
} from "../game-social";
export function localStats(id: string): Stats {
  try {
    const v = JSON.parse(localStorage.getItem(`earth-records:${id}`) || "null");
    if (validStats(v?.stats)) return v.stats;
  } catch {}
  return emptyStats();
}
export function saveLocalResult(id: string, r: GameResult): Stats {
  const key = `earth-records:${id}`;
  try {
    const old = JSON.parse(localStorage.getItem(key) || "null"),
      stats = validStats(old?.stats) ? old.stats : emptyStats();
    const ids: Array<string> = Array.isArray(old?.games)
      ? old.games.filter((v: unknown) => typeof v === "string")
      : [];
    if (ids.includes(r.gameId)) return stats;
    const next = addResult(stats, r);
    ids.push(r.gameId);
    localStorage.setItem(key, JSON.stringify({ stats: next, games: ids }));
    return next;
  } catch {
    return addResult(localStats(id), r);
  }
}
