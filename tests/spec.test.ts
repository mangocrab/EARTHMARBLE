import { it, expect, describe } from "vitest";
import {
  createGame,
  land,
  apply,
  tick as rawTick,
  CARDS,
  view,
  type Game,
} from "../game-core";
import { landingForecast, analyze, decide, liquidationPlan } from "../game-ai";
import {
  diceOrientation,
  DICE_FACES,
  FACE_NORMALS,
  topFace,
} from "../game-client/dice-orientation";
// Advance only presentation stages; payment and player decisions remain explicit.
function settle(g: Game) {
  for (let i = 0; ["moving", "reveal"].includes(g.phase) && i < 500; i++)
    rawTick(g, g.animationUntil, () => 0);
}
function tick(g: Game, now: number, rng: (max: number) => number) {
  const changed = rawTick(g, now, rng);
  if (changed) settle(g);
  return changed;
}
const start = 10000;
const create = () =>
  createGame(
    [
      { id: "a", name: "대지", ai: "hard" },
      { id: "b", name: "바다" },
    ],
    start,
    () => 0,
  );
function drawCard(g: Game, id: number) {
  g.drawPile =
    id === 27
      ? [27, 1, ...g.drawPile.filter((i) => i !== 27 && i !== 1)]
      : [id, ...g.drawPile.filter((i) => i !== id)];
  g.players[0].position = 2;
  land(g, start, () => 0);
  settle(g);
}
describe("30장 카드의 정확한 결과", () => {
  it.each(CARDS.map((c) => [c.id, c.name] as const))("%i %s", (id) => {
    const g = create(),
      p = g.players[0];
    g.fund = 250000;
    if (id === 12 || id === 13) {
      g.estates[1] = { owner: "a", buildings: [true, true, true] };
      g.estates[11] = { owner: "a", buildings: [true, false, false] };
    }
    if (id === 30) {
      g.estates[1] = { owner: "a", buildings: [true, true, true] };
      g.estates[37] = { owner: "a", buildings: [true, true, true] };
    }
    drawCard(g, id);
    const gains: Record<number, number> = {
      1: 200000,
      2: 150000,
      3: 100000,
      4: 100000,
      5: 300000,
      6: 300000,
      14: 200000,
    };
    const costs: Record<number, number> = {
      7: 100000,
      8: 100000,
      9: 50000,
      10: 100000,
      11: 150000,
      12: 100000,
      13: 50000,
    };
    const destinations: Record<number, number> = {
      15: 20,
      16: 5,
      17: 25,
      18: 39,
      19: 32,
      20: 1,
      21: 3,
      22: 30,
      23: 10,
      26: 0,
      27: 2,
      28: 0,
      29: 39,
    };
    if (id in gains) {
      expect(p.cash).toBe(1500000 + gains[id]);
      expect(g.phase).toBe("end");
    }
    if (id in costs) {
      expect(g.payment?.amount).toBe(costs[id]);
      expect(p.cash).toBe(1500000);
      apply(g, "a", { type: "pay" }, start, () => 0);
      expect(p.cash).toBe(1500000 - costs[id]);
      expect(g.fund).toBe(250000 + ([10, 11].includes(id) ? costs[id] : 0));
    }
    if (id in destinations) expect(p.position).toBe(destinations[id]);
    if (id === 15) {
      expect(p.cash).toBe(1750000);
      expect(g.fund).toBe(0);
    }
    if ([16, 17, 18, 19, 20, 21, 29].includes(id))
      expect(g.phase).toBe("purchase");
    if (id === 22) {
      expect(p.low).toBe(true);
      expect(p.freeLow).toBe(true);
      expect(p.held).toEqual([]);
    }
    if (id === 23) {
      expect(p.tide).toBe(3);
      expect(g.extra).toBe(false);
      expect(p.cash).toBe(1500000);
      expect(p.laps).toBe(0);
    }
    if (id === 24 || id === 25) {
      expect(p.held).toEqual([id]);
      expect(g.discardPile).not.toContain(id);
      expect(view(g, "b").players[0].held).toEqual([]);
    } else expect(g.discardPile).toContain(id);
    if (id === 26 || id === 28) {
      expect(p.laps).toBe(1);
      expect(p.cash).toBe(1700000);
    }
    if (id === 27) {
      expect(p.cash).toBe(1900000);
      expect(p.laps).toBe(1);
      expect(g.lastCard).toBe(1);
    }
    if (id === 30) {
      expect(g.estates[37]).toBeUndefined();
      expect(g.estates[1].buildings).toEqual([true, true, true]);
      expect(p.cash).toBe(2575000);
    }
    expect(
      [
        ...g.drawPile,
        ...g.discardPile,
        ...g.players.flatMap((p) => p.held),
      ].sort((a, b) => a - b),
    ).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });
  it.each([0, 9, 19])(
    "보관 카드 사용은 덱 순서를 유지하고 버림 더미로 보낸다 (회전 %i)",
    (offset) => {
      const g = create();
      g.players[0].held = [24];
      g.players[0].tide = 3;
      g.drawPile = g.drawPile.filter((id) => id !== 24);
      g.drawPile = [
        ...g.drawPile.slice(offset),
        ...g.drawPile.slice(0, offset),
      ];
      const order = [...g.drawPile];
      apply(g, "a", { type: "use", card: 24 }, start, () => 0);
      expect(g.drawPile).toEqual(order);
      expect(g.discardPile).toEqual([24]);
      expect(g.players[0].held).toEqual([]);
      expect(new Set([...g.drawPile, ...g.discardPile]).size).toBe(30);
    },
  );
});
describe("공개 정보 기반 AI 분석과 자산 선택", () => {
  it("2d6의 각 합계 확률을 사용한다", () => {
    const p = landingForecast(0, 1);
    expect(p[2]).toBeCloseTo(1 / 36);
    expect(p[7]).toBeCloseTo(6 / 36);
    expect(p[12]).toBeCloseTo(1 / 36);
    expect(p.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
  it("상대 자산과 자신의 통행료 위험을 분석한다", () => {
    const g = create();
    const before = analyze(g, g.players[0]);
    g.players[1].cash *= 4;
    const wealth = analyze(g, g.players[0]);
    expect(wealth.rivalAssets).toBeGreaterThan(before.rivalAssets);
    expect(wealth.reserve).toBeGreaterThan(before.reserve);
    g.players[0].position = 37;
    g.estates[39] = { owner: "b", buildings: [] };
    const risk = analyze(g, g.players[0]);
    expect(risk.expectedToll).toBeGreaterThan(0);
    expect(risk.worstToll).toBe(2000000);
    expect(risk.reserve).toBeGreaterThan(wealth.reserve);
  });
  it("통행료 위험이 크면 시설 투자보다 유동성을 유지한다", () => {
    const g = create();
    g.phase = "build";
    g.players[0].position = 37;
    g.players[0].laps = 3;
    g.players[0].cash = 500000;
    g.estates[37] = { owner: "a", buildings: [false, false, false] };
    g.estates[39] = { owner: "b", buildings: [] };
    expect(decide(g).type).toBe("skip");
  });
  it("공개 상태가 같으면 상대 손패와 덱 순서가 달라도 같은 결정을 한다", () => {
    const g = create();
    g.phase = "purchase";
    g.players[0].position = 11;
    const expected = decide(g);
    g.players[1].held = [24, 25];
    g.drawPile.reverse();
    expect(decide(g)).toEqual(expected);
  });
  it("자동 매각은 필요한 금액까지 싼 땅부터 판다", () => {
    const g = create();
    g.players[0].cash = 0;
    g.estates[1] = { owner: "a", buildings: [false, false, false] };
    g.estates[5] = { owner: "a", buildings: [] };
    expect(liquidationPlan(g, g.players[0], 80000)).toEqual([
      { type: "sell", tile: 1 },
      { type: "sell", tile: 5 },
    ]);
  });
  it("자동 매각은 싼 시설부터 매각하고 부족할 때 토지를 판다", () => {
    const g = create();
    g.players[0].cash = 0;
    g.phase = "debt";
    g.payment = { amount: 250000 };
    g.estates[1] = { owner: "a", buildings: [true, true, true] };
    const plan = liquidationPlan(g, g.players[0], 250000);
    expect(plan.slice(0, 3).map((a) => a.building)).toEqual([0, 1, 2]);
    apply(g, "a", { type: "auto-sell" }, start, () => 0);
    expect(g.players[0].cash).toBe(250000);
    expect(g.estates[1]).toBeUndefined();
    tick(g, start + 200, () => 0);
    expect(g.players[0].cash).toBe(0);
    expect(g.players[0].bankrupt).toBe(false);
  });
});
it.each(DICE_FACES)("주사위 %i의 실제 면을 윗방향으로 정렬한다", (face) => {
  const q = diceOrientation(face);
  const normal = FACE_NORMALS[face].clone().applyQuaternion(q);
  expect(normal.x).toBeCloseTo(0);
  expect(normal.y).toBeCloseTo(1);
  expect(normal.z).toBeCloseTo(0);
  expect(topFace(q)).toBe(face);
});
