import {
  BOARD,
  active,
  assets,
  rent,
  autoSalePlan,
  type Game,
  type Player,
  type Action,
} from "../game-core";

// Forecasts use public positions, cash and estates. Opponent hands and deck order
// are deliberately excluded; cards and future decisions are unknown.
export function landingForecast(position: number, turns = 6) {
  let distribution = Array(40).fill(0) as number[];
  distribution[position] = 1;
  const visits = Array(40).fill(0) as number[];
  for (let turn = 0; turn < turns; turn++) {
    const next = Array(40).fill(0) as number[];
    for (let i = 0; i < 40; i++)
      for (let dice = 2; dice <= 12; dice++)
        next[(i + dice) % 40] +=
          (distribution[i] * (6 - Math.abs(7 - dice))) / 36;
    for (let i = 0; i < 40; i++) visits[i] += next[i] * Math.pow(0.87, turn);
    distribution = next;
  }
  return visits;
}
export function analyze(g: Game, p: Player, now = g.deadline - 60000) {
  const rivals = g.players.filter((q) => q.id !== p.id && !q.bankrupt);
  const turns = Math.max(1, Math.min(8, Math.ceil((g.endsAt - now) / 150000)));
  const traffic = Array(40).fill(0) as number[];
  for (const rival of rivals) {
    const forecast = landingForecast(rival.position, turns);
    for (let i = 0; i < 40; i++)
      traffic[i] += forecast[i] * (rival.tide > 0 ? 0.65 : 1);
  }
  const own = landingForecast(p.position, 3);
  let expectedToll = 0,
    worstToll = 0;
  for (const [id, e] of Object.entries(g.estates))
    if (e.owner !== p.id) {
      const fee = rent(g, +id);
      expectedToll += own[+id] * fee;
      if (own[+id] > 0) worstToll = Math.max(worstToll, fee);
    }
  const rivalAssets = rivals.length
    ? rivals.reduce((n, q) => n + assets(g, q), 0) / rivals.length
    : 0;
  const pressure = rivalAssets / Math.max(1, assets(g, p));
  const reserve = Math.ceil(
    Math.max(100000, expectedToll * 1.6 + worstToll * 0.18) *
      (pressure > 1.25 ? 1.15 : 1),
  );
  return { traffic, expectedToll, worstToll, rivalAssets, pressure, reserve };
}

/** Liquidate only the needed amount: cheap buildings first, then cheap land. */
export function liquidationPlan(
  g: Game,
  p: Player,
  required: number,
): Action[] {
  return autoSalePlan(g, p, required);
}
export function decide(g: Game, now = g.deadline - 60000): Action {
  const p = active(g),
    hard = p.ai === "hard",
    easy = p.ai === "easy",
    analysis = analyze(g, p, now);
  const reserve = easy
    ? 0
    : hard
      ? analysis.reserve
      : Math.max(150000, analysis.expectedToll * 1.1);
  function investment(tile: number, building?: number) {
    const t = BOARD[tile],
      cost = building === undefined ? t.price! : t.costs![building];
    if (p.cash - cost < reserve) return false;
    if (easy) return true;
    const yieldRent =
      building === undefined
        ? t.rents![0] +
          (t.costs?.length
            ? t
                .rents!.slice(1, Math.min(p.laps + 1, 3) + 1)
                .reduce((s, n) => s + n, 0) * 0.2
            : 0)
        : t.rents![building + 1];
    const income = analysis.traffic[tile] * yieldRent;
    const minimum =
      cost * (hard ? 0.004 : 0.001) * (analysis.pressure > 1.25 ? 0.7 : 1);
    return income >= minimum;
  }
  if (g.phase === "roll")
    return p.tide && p.held.includes(24)
      ? { type: "use", card: 24 }
      : { type: "roll" };
  if (g.phase === "purchase")
    return { type: investment(p.position) ? "buy" : "skip" };
  if (g.phase === "build") {
    const i = g.estates[p.position].buildings.findIndex((v) => !v);
    return { type: investment(p.position, i) ? "build" : "skip", building: i };
  }
  if (g.phase === "low") {
    if (easy) return { type: "travel", destination: 20 };
    const fee =
      g.estates[32] && g.estates[32].owner !== p.id && !p.freeLow ? 200000 : 0;
    if (p.cash < fee) return { type: "skip" };
    function score(id: number) {
      const t = BOARD[id],
        e = g.estates[id];
      if (id === 20) return g.fund;
      if (id === 0) return 0;
      if (!t.price) return -50000;
      if (e?.owner === p.id) {
        const stage = e.buildings.findIndex((v) => !v);
        return stage >= 0 && p.laps >= stage + 1 && investment(id, stage)
          ? analysis.traffic[id] * t.rents![stage + 1]
          : 0;
      }
      if (e) return -rent(g, id);
      if (t.price > p.cash - fee - reserve) return -Infinity;
      return (
        analysis.traffic[id] * t.rents![0] -
        (hard ? t.price * 0.005 : t.price * 0.001)
      );
    }
    const best = BOARD.filter((t) => t.id !== 30).sort(
      (a, b) => score(b.id) - score(a.id) || a.id - b.id,
    )[0];
    return score(best.id) < fee
      ? { type: "skip" }
      : { type: "travel", destination: best.id };
  }
  if (g.payment) {
    if (
      g.phase === "toll" &&
      p.held.includes(25) &&
      (g.payment.amount >= Math.max(30000, analysis.expectedToll * 0.5) ||
        p.cash < g.payment.amount)
    )
      return { type: "use", card: 25 };
    if (p.cash >= g.payment.amount) return { type: "pay" };
    return autoSalePlan(g, p, g.payment.amount - p.cash).length
      ? { type: "auto-sell" }
      : { type: "bankrupt" };
  }
  return { type: "end" };
}
