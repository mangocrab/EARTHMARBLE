import { describe, it, expect } from "vitest";
import {
  createGame,
  apply,
  tick,
  land,
  view,
  BOARD,
  autoSalePlan,
  estateValue,
  type Game,
} from "../game-core";
const base = 10000;
const rng = () => 0;
const game = () =>
  createGame(
    [
      { id: "a", name: "나" },
      { id: "b", name: "상대" },
    ],
    base,
    rng,
  );
function settle(g: Game) {
  for (
    let i = 0;
    ["moving", "reveal", "animation"].includes(g.phase) && i < 500;
    i++
  )
    tick(g, g.animationUntil, rng);
  expect(["moving", "reveal", "animation"]).not.toContain(g.phase);
}
function draw(g: Game, id: number, position = 2, follow = 24) {
  g.drawPile = [
    id,
    ...(id !== follow ? [follow] : []),
    ...g.drawPile.filter((c) => c !== id && c !== follow),
  ];
  g.players[0].position = position;
  land(g, base, rng);
  settle(g);
}
describe("추가 요청 규칙", () => {
  it.each([6, 7, 8, 9, 10, 11, 12])(
    "%i칸 이동은 6칸과 같은 1440ms 안에 정확히 완료",
    (sum) => {
      const g = game();
      let i = 0;
      const dice = sum <= 7 ? [1, sum - 1] : [6, sum - 6];
      apply(g, "a", { type: "roll" }, base, () => dice[i++] - 1);
      tick(g, base + 2400, rng);
      for (let elapsed = 40; elapsed <= 1440; elapsed += 40) {
        tick(g, base + 2400 + elapsed, rng);
        if (elapsed < 1440) expect(g.phase).toBe("moving");
      }
      expect(g.players[0].position).toBe(sum);
      expect(g.motion).toBeUndefined();
    },
  );
  it("전 지구 탐사도 1440ms 이동 후 재추첨을 공개하고, 공개 전에 두 번째 효과를 적용하지 않는다", () => {
    const g = game();
    g.extra = true;
    g.doubles = 1;
    g.drawPile = [27, 1, ...g.drawPile.filter((c) => c !== 27 && c !== 1)];
    g.players[0].position = 2;
    land(g, base, rng);
    tick(g, base + 3600, rng);
    expect(g.phase).toBe("moving");
    tick(g, base + 3600 + 1440, rng);
    expect(g.players[0].position).toBe(2);
    expect(g.players[0].cash).toBe(1700000);
    expect(g.pendingCard).toBe(1);
    expect(view(g, "b").pendingCard).toBe(1);
    expect(g.extra).toBe(true);
    tick(g, g.animationUntil, rng);
    expect(g.players[0].cash).toBe(1900000);
    tick(g, base + 10000, rng);
    expect(g.turn).toBe(0);
    expect(g.phase).toBe("roll");
    expect([
      ...g.drawPile,
      ...g.discardPile,
      ...g.players.flatMap((p) => p.held),
    ]).toHaveLength(30);
  });
  it.each([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
    22, 24, 25, 26, 27, 28, 29, 30,
  ])("더블로 뽑은 %i번 카드 처리 후에도 추가 차례 유지", (id) => {
    const g = game();
    g.players[0].cash = 10000000;
    g.drawPile = [
      id,
      ...(id !== 24 ? [24] : []),
      ...g.drawPile.filter((c) => c !== id && c !== 24),
    ];
    apply(g, "a", { type: "roll" }, base, rng); // 1 + 1 → card 2
    settle(g);
    if (g.payment) {
      apply(g, "a", { type: "pay" }, base + 10000, rng);
      settle(g);
    }
    if (g.phase === "purchase" || g.phase === "build")
      apply(g, "a", { type: "skip" }, base + 10000, rng);
    expect(g.extra).toBe(true);
    expect(g.phase).toBe("end");
    tick(g, base + 15000, rng);
    expect(g.turn).toBe(0);
    expect(["roll", "low"]).toContain(g.phase);
    expect(g.players[1].position).toBe(0);
  });
  it("만조 탈출 더블 → 카드 → 추가 굴림을 보장하고 세 번째 연속 더블은 만조로 보낸다", () => {
    const g = game();
    g.players[0].position = 10;
    g.players[0].tide = 3;
    g.drawPile = [24, ...g.drawPile.filter((c) => c !== 24)];
    apply(g, "a", { type: "roll" }, base, rng);
    settle(g);
    expect(g.players[0].tide).toBe(0);
    expect(g.extra).toBe(true);
    expect(g.doubles).toBe(1);
    tick(g, base + 10000, rng);
    expect(g.phase).toBe("roll");
    expect(g.turn).toBe(0);
    apply(g, "a", { type: "roll" }, base + 10000, rng);
    settle(g); // 12→14
    apply(g, "a", { type: "skip" }, base + 15000, rng);
    tick(g, base + 15000, rng);
    apply(g, "a", { type: "roll" }, base + 16000, rng);
    settle(g);
    expect(g.players[0].position).toBe(10);
    expect(g.players[0].tide).toBe(3);
    expect(g.extra).toBe(false);
  });
  it("간조에서 출발지를 넘는 지정 이동도 보상하고 간조 자신은 선택할 수 없다", () => {
    const g = game();
    g.players[0].position = 30;
    g.players[0].low = true;
    g.phase = "low";
    const before = structuredClone(g);
    expect(() =>
      apply(g, "a", { type: "travel", destination: 30 }, base, rng),
    ).toThrow("목적지");
    expect(g).toEqual(before);
    apply(g, "a", { type: "travel", destination: 1 }, base, rng);
    settle(g);
    expect(g.players[0].cash).toBe(1700000);
    expect(g.players[0].laps).toBe(1);
  });
  it.each([26, 28, 29])(
    "%i번 카드로 출발지에 도착하거나 통과할 때 보상",
    (id) => {
      const g = game();
      draw(g, id);
      expect(g.players[0].cash).toBe(1700000);
      expect(g.players[0].laps).toBe(1);
    },
  );
  it("만조 발생 카드로 출발지를 넘어도 보상과 완주를 지급하지 않는다", () => {
    const g = game();
    g.extra = true;
    draw(g, 23, 35);
    expect(g.players[0].position).toBe(10);
    expect(g.players[0].cash).toBe(1500000);
    expect(g.players[0].laps).toBe(0);
    expect(g.extra).toBe(false);
  });
  it("구조조정은 땅과 건물을 합한 판매 대금으로 가장 비싼 소유지를 고른다", () => {
    const g = game();
    g.estates[1] = { owner: "a", buildings: [true, true, true] };
    g.estates[37] = { owner: "a", buildings: [false, false, false] };
    expect(estateValue(g, 1) / 2).toBe(250000);
    expect(estateValue(g, 37) / 2).toBe(175000);
    draw(g, 30);
    expect(g.estates[1]).toBeUndefined();
    expect(g.estates[37]).toBeDefined();
    expect(g.players[0].cash).toBe(1750000);
  });
  it("수동 매각은 해당 땅의 비싼 건물부터, 순서 위반은 상태를 바꾸지 않는다", () => {
    const g = game();
    g.estates[1] = { owner: "a", buildings: [true, true, true] };
    const before = structuredClone(g);
    expect(() =>
      apply(g, "a", { type: "sell", tile: 1, building: 0 }, base, rng),
    ).toThrow("비싼");
    expect(g).toEqual(before);
    for (const i of [2, 1, 0])
      apply(g, "a", { type: "sell", tile: 1, building: i }, base, rng);
    apply(g, "a", { type: "sell", tile: 1 }, base, rng);
    expect(g.players[0].cash).toBe(1750000);
  });
  it("자동 매각은 모든 건물을 비싼 순서로 먼저, 그 뒤 땅은 싼 순서로 필요한 만큼 판매", () => {
    const g = game(),
      p = g.players[0];
    p.cash = 0;
    g.estates[1] = { owner: "a", buildings: [true, true, true] };
    g.estates[11] = { owner: "a", buildings: [true, false, false] };
    g.estates[3] = { owner: "a", buildings: [false, false, false] };
    g.estates[5] = { owner: "a", buildings: [] };
    const plan = autoSalePlan(g, p, 450000);
    expect(plan.slice(0, 4)).toEqual([
      { type: "sell", tile: 1, building: 2 },
      { type: "sell", tile: 1, building: 1 },
      { type: "sell", tile: 11, building: 0 },
      { type: "sell", tile: 1, building: 0 },
    ]);
    expect(plan.slice(4).map((a) => a.tile)).toEqual([1, 3, 11, 5]);
    g.phase = "debt";
    g.payment = { amount: 450000, to: "b", toll: false };
    apply(g, "a", { type: "auto-sell" }, base, rng);
    const raised = plan.reduce(
      (s, a) =>
        s +
        (a.building === undefined
          ? BOARD[a.tile!].price!
          : BOARD[a.tile!].costs![a.building]) /
          2,
      0,
    );
    expect(p.cash).toBe(raised);
    expect(p.cash).toBeGreaterThanOrEqual(450000);
    tick(g, base + 40, rng);
    expect(p.cash).toBe(raised - 450000);
    expect(g.players[1].cash).toBe(1950000);
  });
  it("건물만으로 부족분을 채우면 토지를 팔지 않으며, 남의 자산은 매각하지 않는다", () => {
    const g = game(),
      p = g.players[0];
    p.cash = 0;
    g.estates[1] = { owner: "a", buildings: [true, true, true] };
    g.estates[39] = { owner: "b", buildings: [] };
    g.phase = "debt";
    g.payment = { amount: 200000 };
    apply(g, "a", { type: "auto-sell" }, base, rng);
    expect(p.cash).toBe(200000);
    expect(g.estates[1].buildings).toEqual([true, false, false]);
    expect(g.estates[39].owner).toBe("b");
  });
});
