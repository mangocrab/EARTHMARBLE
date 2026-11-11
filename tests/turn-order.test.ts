import { expect, it } from "vitest";
import { createGame, apply, CARDS } from "../game-core";
function choices(n: number): number[][] {
  return n === 1
    ? [[]]
    : Array.from({ length: n }, (_, i) =>
        choices(n - 1).map((tail) => [i, ...tail]),
      ).flat();
}
it.each([2, 3, 4])(
  "%i인 무작위 순서는 모든 순열을 같은 확률로 만들고 저장 후에도 유지된다",
  (n) => {
    const permutations = new Set<string>();
    const starters = Array(n).fill(0);
    for (const path of choices(n)) {
      let calls = 0;
      const g = createGame(
        Array.from({ length: n }, (_, i) => ({
          id: String(i),
          name: `대원${i}`,
        })),
        1000,
        () => (++calls < CARDS.length ? 0 : path[calls - CARDS.length]),
      );
      expect([...g.turnOrder!].sort()).toEqual(
        Array.from({ length: n }, (_, i) => i),
      );
      expect(g.players.map((p) => p.id)).toEqual(
        Array.from({ length: n }, (_, i) => String(i)),
      );
      starters[g.turn]++;
      permutations.add(g.turnOrder!.join());
      const restored = JSON.parse(JSON.stringify(g));
      for (let i = 0; i < n + 1; i++) {
        expect(restored.turn).toBe(g.turnOrder![i % n]);
        restored.phase = "end";
        apply(
          restored,
          restored.players[restored.turn].id,
          { type: "end" },
          1001 + i,
          () => 0,
        );
      }
    }
    expect(permutations.size).toBe(choices(n).length);
    expect(new Set(starters).size).toBe(1);
  },
);
it("무작위 순서에서 파산자는 건너뛰고 더블은 현재 차례를 유지한다", () => {
  const g = createGame(
    [0, 1, 2, 3].map((i) => ({ id: String(i), name: String(i) })),
    1000,
    (max) => max - 1,
  );
  expect(g.turnOrder).toEqual([3, 2, 1, 0]);
  g.players[2].bankrupt = true;
  g.phase = "end";
  g.extra = true;
  apply(g, "3", { type: "end" }, 1001, () => 0);
  expect(g.turn).toBe(3);
  g.phase = "end";
  apply(g, "3", { type: "end" }, 1002, () => 0);
  expect(g.turn).toBe(1);
});
