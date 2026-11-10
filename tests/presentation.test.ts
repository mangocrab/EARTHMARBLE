import { describe, it, expect } from "vitest";
import {
  createGame,
  apply,
  tick,
  land,
  view,
  BOARD,
  remainingMs,
} from "../game-core";
const now = 10000;
const game = () =>
  createGame(
    [
      { id: "a", name: "나" },
      { id: "b", name: "상대" },
    ],
    now,
    () => 0,
  );
describe("순서가 보이는 보드게임 진행", () => {
  it.each(
    Array.from({ length: 36 }, (_, i) => [Math.floor(i / 6) + 1, (i % 6) + 1]),
  )("주사위 %i + %i: 중복 틱 없이 정확히 한 칸씩 이동", (a, b) => {
    const g = game();
    g.players[0].position = 37;
    let n = 0;
    apply(g, "a", { type: "roll" }, now, () => [a - 1, b - 1][n++]);
    tick(g, now + 2400, () => 0);
    expect(g.phase).toBe("moving");
    expect(g.players[0].position).toBe(37);
    for (let step = 1; step <= a + b; step++) {
      const at = now + 2400 + step * 240;
      tick(g, at, () => 0);
      expect(g.players[0].position).toBe((37 + step) % 40);
      if (step < a + b) {
        expect(tick(g, at, () => 0)).toBe(false);
        expect(g.motion?.done).toBe(step);
      }
    }
    expect(g.motion).toBeUndefined();
    expect(g.players[0].laps).toBe(a + b >= 3 ? 1 : 0);
    expect(g.players[1].position).toBe(0);
  });
  it("추첨 결과는 모두 공개하고 지원금은 공개 이후 뽑은 사람에게 한 번만 적용", () => {
    const g = game();
    g.drawPile = [1, ...g.drawPile.filter((id) => id !== 1)];
    g.players[0].position = 2;
    land(g, now, () => 0);
    expect(g.phase).toBe("reveal");
    expect(view(g, "a").pendingCard).toBe(1);
    expect(view(g, "b").pendingCard).toBe(1);
    expect(g.players.map((p) => p.cash)).toEqual([1500000, 1500000]);
    expect(tick(g, now + 3599, () => 0)).toBe(false);
    const restored = structuredClone(g);
    tick(restored, now + 3600, () => 0);
    expect(restored.players.map((p) => p.cash)).toEqual([1700000, 1500000]);
    expect(restored.discardPile.filter((id) => id === 1)).toHaveLength(1);
    tick(restored, now + 3800, () => 0);
    expect(restored.players[0].cash).toBe(1700000);
  });
  it("보관형 카드도 공개 후 손패로 이동하고 덱에 중복되지 않는다", () => {
    const g = game();
    g.drawPile = [24, ...g.drawPile.filter((id) => id !== 24)];
    g.players[0].position = 2;
    land(g, now, () => 0);
    expect(view(g, "b").pendingCard).toBe(24);
    expect(g.players[0].held).toEqual([]);
    tick(g, now + 3600, () => 0);
    expect(g.players[0].held).toEqual([24]);
    expect(g.discardPile).not.toContain(24);
    expect(view(g, "b").lastCard).toBe(24);
    expect(view(g, "b").players[0].held).toEqual([]);
  });
  it("완주 조건 내에서 한 번 도착해 세 시설을 순서대로 건설", () => {
    const g = game(),
      p = g.players[0];
    p.position = 1;
    p.laps = 3;
    g.estates[1] = { owner: "a", buildings: [false, false, false] };
    land(g, now, () => 0);
    expect(() =>
      apply(g, "a", { type: "build", building: 2 }, now, () => 0),
    ).toThrow("순서");
    for (let i = 0; i < 3; i++) {
      expect(g.phase).toBe("build");
      apply(g, "a", { type: "build", building: i }, now, () => 0);
    }
    expect(g.estates[1].buildings).toEqual([true, true, true]);
    expect(p.cash).toBe(1500000 - BOARD[1].costs!.reduce((a, b) => a + b, 0));
    expect(g.phase).toBe("end");
  });
  it("건설을 중간에 마치거나 자금 부족으로 거절해도 앞선 건설을 유지", () => {
    const g = game(),
      p = g.players[0];
    p.position = 1;
    p.laps = 3;
    p.cash = BOARD[1].costs![0];
    g.estates[1] = { owner: "a", buildings: [false, false, false] };
    land(g, now, () => 0);
    apply(g, "a", { type: "build", building: 0 }, now, () => 0);
    expect(() =>
      apply(g, "a", { type: "build", building: 1 }, now, () => 0),
    ).toThrow("부족");
    apply(g, "a", { type: "skip" }, now, () => 0);
    expect(g.estates[1].buildings).toEqual([true, false, false]);
    expect(g.phase).toBe("end");
  });
  it("이동 중 저장/복구해도 경로와 남은 행동 예산은 유지", () => {
    const g = game();
    let n = 0;
    apply(g, "a", { type: "roll" }, now + 59000, () => n++ % 2);
    tick(g, now + 61400, () => 0);
    tick(g, now + 61640, () => 0);
    const restored = structuredClone(g);
    expect(restored.players[0].position).toBe(1);
    expect(remainingMs(restored, now + 62000)).toBe(1000);
    tick(restored, now + 61880, () => 0);
    tick(restored, now + 62120, () => 0);
    expect(restored.players[0].position).toBe(3);
    expect(remainingMs(restored, now + 62120)).toBe(1000);
    expect(restored.phase).toBe("purchase");
  });
});
