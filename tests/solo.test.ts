import { describe, it, expect } from "vitest";
import {
  SoloController,
  SOLO_KEY,
  validSave,
  browserRandom,
  type Store,
} from "../game-client/solo";
class MemoryStore implements Store {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}
function harness() {
  const storage = new MemoryStore();
  let now = 10000,
    n = 0;
  const errors: string[] = [];
  const c = new SoloController(
    storage,
    () => now,
    (max) => (max === 6 ? n++ % 2 : 0),
    (message) => errors.push(message),
  );
  c.login("탐사자");
  return {
    c,
    storage,
    errors,
    advance: (dt: number) => {
      now += dt;
    },
    now: () => now,
  };
}
function command(c: SoloController, data: Record<string, unknown>) {
  const state = c.snapshot();
  const request = {
    requestId: crypto.randomUUID(),
    version:
      data.type === "action"
        ? state.room!.game!.version
        : (state.room?.version ?? 0),
    ...data,
  };
  c.command(request);
  return request;
}
function start(c: SoloController, count = 1) {
  command(c, {
    type: "solo-start",
    count,
    levels: Array(count).fill("normal"),
    minutes: 30,
  });
}
describe("브라우저 단독 AI 탐사", () => {
  it.each([1, 2, 3])("AI %i명과 실제 규칙으로 시작한다", (count) => {
    const { c, storage } = harness();
    start(c, count);
    const g = c.snapshot().room!.game!;
    expect(g.players).toHaveLength(count + 1);
    expect(g.players.slice(1).every((p) => p.ai === "normal")).toBe(true);
    expect(
      g.players.every((p) => p.cash === (count === 1 ? 1500000 : 3000000)),
    ).toBe(true);
    expect(validSave(JSON.parse(storage.getItem(SOLO_KEY)!))).toBe(true);
  });
  it("사람 이동·구매 포기 후 AI가 같은 규칙으로 행동한다", () => {
    const { c, advance } = harness();
    start(c);
    command(c, { type: "action", action: { type: "roll" } });
    advance(2400);
    c.step();
    expect(c.snapshot().room!.game!.players[0].position).toBe(3);
    command(c, { type: "action", action: { type: "skip" } });
    advance(200);
    c.step();
    expect(c.snapshot().room!.game!.turn).toBe(1);
    advance(2400);
    c.step();
    expect(c.snapshot().room!.game!.players[1].position).toBe(3);
    expect(
      c.snapshot().room!.game!.log.some((l) => l.includes("탐사봇 1 · 주사위")),
    ).toBe(true);
  });
  it("잘못된 차례·상태 버전·중복 요청을 검사한다", () => {
    const { c } = harness();
    start(c);
    const request = command(c, { type: "action", action: { type: "roll" } });
    const before = c.snapshot().room!.game!;
    c.command(request);
    expect(c.snapshot().room!.game).toEqual(before);
    expect(() =>
      command(c, { type: "action", action: { type: "buy" } }),
    ).toThrow();
    expect(() =>
      command(c, { type: "action", version: -1, action: { type: "roll" } }),
    ).toThrow();
  });
  it("일시 정지 중 시간과 AI가 멈추고 다시 이어진다", () => {
    const { c, advance } = harness();
    start(c);
    const before = c.snapshot().room!.game!;
    command(c, { type: "solo-pause", paused: true });
    advance(300000);
    c.step();
    expect(c.snapshot().room!.game!.version).toBe(before.version);
    expect(() =>
      command(c, { type: "action", action: { type: "roll" } }),
    ).toThrow();
    command(c, { type: "solo-pause", paused: false });
    expect(c.snapshot().room!.game!.deadline).toBe(before.deadline + 300000);
    expect(c.snapshot().room!.game!.endsAt).toBe(before.endsAt + 300000);
  });
  it("새로고침 시 덱·자산·중지 상태와 남은 시간을 복구한다", () => {
    const { c, storage, advance, now } = harness();
    start(c, 2);
    command(c, { type: "solo-pause", paused: true });
    const data = JSON.parse(storage.getItem(SOLO_KEY)!);
    advance(3600000);
    const restored = new SoloController(storage, now, () => 0);
    expect(restored.identity).toEqual(c.identity);
    expect(restored.snapshot().paused).toBe(true);
    expect(restored.snapshot().room!.game!.players).toEqual(
      c.snapshot().room!.game!.players,
    );
    expect(restored.snapshot().room!.game!.deadline).toBe(
      data.room.game.deadline + 3600000,
    );
    restored.save();
    expect(JSON.parse(storage.getItem(SOLO_KEY)!).room.game.drawPile).toEqual(
      data.room.game.drawPile,
    );
  });
  it("탭이 숨겨져 있던 동안 경기 시간을 소비하지 않는다", () => {
    const { c, advance } = harness();
    start(c);
    const before = c.snapshot().room!.game!.endsAt;
    c.pause();
    advance(600000);
    c.step();
    c.resume();
    expect(c.snapshot().room!.game!.endsAt).toBe(before + 600000);
  });
  it("손상된 저장을 거부하고 새 탐사를 준비한다", () => {
    const storage = new MemoryStore();
    storage.setItem(SOLO_KEY, '{"schema":1,"room":{}}');
    const errors: string[] = [];
    const c = new SoloController(
      storage,
      () => 10000,
      () => 0,
      (e) => errors.push(e),
    );
    expect(c.snapshot().room).toBeNull();
    expect(errors).toHaveLength(1);
    c.login("새 탐사자");
    start(c);
    expect(c.snapshot().room!.game!.players).toHaveLength(2);
  });
  it("카드가 누락되거나 중복된 저장은 복구하지 않는다", () => {
    const { c, storage } = harness();
    start(c);
    const data = JSON.parse(storage.getItem(SOLO_KEY)!);
    data.room.game.drawPile[0] = data.room.game.drawPile[1];
    expect(validSave(data)).toBe(false);
  });
  it("저장 권한이 없어도 현재 탐사를 플레이할 수 있다", () => {
    const errors: string[] = [];
    const c = new SoloController(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error("storage denied");
        },
        removeItem: () => {},
      },
      () => 10000,
      () => 0,
      (e) => errors.push(e),
    );
    c.login("대원");
    start(c);
    command(c, { type: "action", action: { type: "roll" } });
    expect(c.snapshot().room!.game!.phase).toBe("animation");
    expect(errors).toHaveLength(1);
  });
  it("명시적인 새 탐사 준비로만 진행 중 게임을 지운다", () => {
    const { c } = harness();
    start(c);
    expect(() => command(c, { type: "leave" })).toThrow();
    command(c, { type: "solo-reset" });
    expect(c.snapshot().room).toBeNull();
    expect(c.identity!.name).toBe("탐사자");
    start(c, 3);
    expect(c.snapshot().room!.game!.players).toHaveLength(4);
  });
  it("브라우저 난수의 범위를 검증한다", () => {
    for (const max of [1, 6, 30, 4294967296])
      for (let i = 0; i < 10; i++) {
        const n = browserRandom(max);
        expect(n).toBeGreaterThanOrEqual(0);
        expect(n).toBeLessThan(max);
      }
    expect(() => browserRandom(0)).toThrow();
  });
});
