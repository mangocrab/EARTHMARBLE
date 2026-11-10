import { describe, it, expect } from "vitest";
import { randomInt } from "node:crypto";
import {
  createGame,
  apply,
  tick as rawTick,
  BOARD,
  CARDS,
  land,
  rent,
  view,
  draw,
  assets,
  remainingMs,
  type Game,
} from "../game-core";
import { decide } from "../game-ai";
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
const users = [
  { id: "a", name: "지구" },
  { id: "b", name: "달" },
  { id: "c", name: "화성" },
  { id: "d", name: "금성" },
];
const game = (n = 2) => createGame(users.slice(0, n), start, randomInt);
const act = (g: Game, type: string, extra = {}) => {
  apply(g, g.players[g.turn].id, { type, ...extra }, start, randomInt);
  settle(g);
};
const count = (g: Game) => [
  ...g.drawPile,
  ...g.discardPile,
  ...g.players.flatMap((p) => p.held),
];
function card(g: Game, id: number) {
  g.drawPile = [id, ...g.drawPile.filter((x) => x !== id)];
  g.players[0].position = 2;
  land(g, start, randomInt);
  settle(g);
}
describe("명세 데이터와 시작 자산", () => {
  it("40개 고유 칸과 30개 카드, 모든 소유지 과학 설명", () => {
    expect(BOARD).toHaveLength(40);
    expect(CARDS).toHaveLength(30);
    expect(new Set(BOARD.map((t) => t.id)).size).toBe(40);
    for (const t of BOARD.filter((t) => t.price)) {
      expect(t.science!.length).toBeGreaterThan(50);
      expect(t.rents?.length).toBe(t.costs!.length + 1);
    }
  });
  it.each([2, 3, 4])("%i인 시작 연구비", (n) => {
    const g = game(n);
    expect(
      g.players.every((p) => p.cash === (n === 2 ? 1500000 : 3000000)),
    ).toBe(true);
  });
  it("AI도 참가 인원으로 계산하며 시작 이후 재계산하지 않는다", () => {
    const g = createGame(
      [
        { ...users[0] },
        { ...users[1], ai: "hard" },
        { ...users[2], ai: "easy" },
      ],
      start,
      randomInt,
    );
    expect(g.players[1].cash).toBe(3000000);
    g.players[1].bankrupt = true;
    tick(g, start + 1, randomInt);
    expect(g.players[0].cash).toBe(3000000);
  });
  it("정상 이동 완주 보상과 완주 횟수", () => {
    const g = game();
    g.players[0].position = 39;
    apply(g, "a", { type: "roll" }, start, () => 0);
    tick(g, start + 2500, randomInt);
    expect(g.players[0].position).toBe(1);
    expect(g.players[0].cash).toBe(1700000);
    expect(g.players[0].laps).toBe(1);
  });
});
describe("건설과 누적 통행료", () => {
  it("건물 없음/관측소/연구소/종합연구센터 누적", () => {
    const g = game();
    g.estates[1] = { owner: "a", buildings: [false, false, false] };
    expect(rent(g, 1)).toBe(2000);
    g.estates[1].buildings[0] = true;
    expect(rent(g, 1)).toBe(12000);
    g.estates[1].buildings[1] = true;
    expect(rent(g, 1)).toBe(102000);
    g.estates[1].buildings[2] = true;
    expect(rent(g, 1)).toBe(352000);
  });
  it("0바퀴 건설 금지, 완주 단계까지 순서대로, 단계별 비용과 누적 건물 유지", () => {
    const g = game();
    g.players[0].position = 1;
    g.estates[1] = { owner: "a", buildings: [false, false, false] };
    land(g, start, randomInt);
    expect(g.phase).toBe("end");
    expect(() => act(g, "build")).toThrow();
    for (let i = 0; i < 3; i++) {
      g.players[0].laps = i + 1;
      land(g, start, randomInt);
      expect(g.phase).toBe("build");
      const cash = g.players[0].cash;
      act(g, "build");
      expect(g.players[0].cash).toBe(cash - BOARD[1].costs![i]);
      expect(g.estates[1].buildings.slice(0, i + 1).every(Boolean)).toBe(true);
      expect(() => act(g, "build")).toThrow();
    }
  });
  it("자신의 차례와 실제 도착 상태를 검사", () => {
    const g = game();
    expect(() => apply(g, "b", { type: "roll" }, start, randomInt)).toThrow();
    expect(() => act(g, "buy")).toThrow();
    expect(() => act(g, "build")).toThrow();
  });
  it("특수 소유지 고정 통행료, 건설 불가", () => {
    const g = game();
    g.players[0].position = 39;
    g.estates[39] = { owner: "a", buildings: [] };
    g.players[0].laps = 10;
    land(g, start, randomInt);
    expect(g.phase).toBe("end");
    expect(rent(g, 39)).toBe(2000000);
    expect(() => act(g, "build")).toThrow();
  });
  it("정확한 금액 정산, 중복 지급 방지, 면제권 반환", () => {
    const g = game();
    g.estates[1] = { owner: "b", buildings: [true, true, true] };
    g.players[0].position = 1;
    land(g, start, randomInt);
    act(g, "pay");
    expect(g.players[0].cash).toBe(1148000);
    expect(g.players[1].cash).toBe(1852000);
    expect(() => act(g, "pay")).toThrow();
    g.players[0].held = [25];
    g.drawPile = g.drawPile.filter((id) => id !== 25);
    land(g, start, randomInt);
    act(g, "use", { card: 25 });
    expect(g.players[0].cash).toBe(1148000);
    expect(g.players[0].held).toHaveLength(0);
    expect(count(g).sort((a, b) => a - b)).toEqual(CARDS.map((c) => c.id));
  });
  it("매각은 절반, 시설료 제외, 시설 우선 매각", () => {
    const g = game();
    g.estates[1] = { owner: "a", buildings: [true, true, false] };
    expect(() => act(g, "sell", { tile: 1 })).toThrow();
    act(g, "sell", { tile: 1, building: 1 });
    expect(rent(g, 1)).toBe(12000);
    expect(g.players[0].cash).toBe(1575000);
    act(g, "sell", { tile: 1, building: 0 });
    act(g, "sell", { tile: 1 });
    expect(g.players[0].cash).toBe(1625000);
    expect(g.estates[1]).toBeUndefined();
    expect(() => act(g, "sell", { tile: 3 })).toThrow();
  });
});
describe("카드 덱과 비공개 정보", () => {
  it("전체 30장 중복 없이 순서대로 추첨", () => {
    const g = game(),
      order = [...g.drawPile];
    expect(new Set(order).size).toBe(30);
    for (const id of order) expect(draw(g, randomInt)).toBe(id);
  });
  it("즉시 카드는 버림, 보관 카드는 손, 재셔플에서 보관 제외", () => {
    const g = game();
    card(g, 24);
    expect(g.players[0].held).toContain(24);
    card(g, 1);
    expect(g.discardPile).toContain(1);
    expect(g.players[0].cash).toBe(1700000);
    g.discardPile.push(...g.drawPile);
    g.drawPile = [];
    const id = draw(g, randomInt);
    expect(id).not.toBe(24);
    expect(count(g)).not.toContain(id);
    expect(g.drawPile).not.toContain(24);
  });
  it("빈 덱/빈 버림 처리", () => {
    const g = game();
    g.drawPile = [];
    g.discardPile = [];
    g.players[0].position = 2;
    land(g, start, randomInt);
    expect(g.phase).toBe("end");
    expect(g.log.at(-1)).toContain("없습니다");
  });
  it("자신의 카드만 조회, 덱 순서와 상대 손패는 숨기고 뽑은 카드 ID 공개", () => {
    const g = game();
    card(g, 24);
    const a = view(g, "a"),
      b = view(g, "b");
    expect(a.players[0].held).toEqual([24]);
    expect(b.players[0].held).toEqual([]);
    expect(b.players[0].cardCount).toBe(1);
    expect(b.drawPile).toBeUndefined();
    expect(b.discardPile).toBeUndefined();
    expect(b.lastCard).toBe(24);
  });
  it("22번 이동/면제 효과와 실제 카드 수 분리", () => {
    const g = game();
    card(g, 22);
    expect(g.players[0].position).toBe(30);
    expect(g.players[0].freeLow).toBe(true);
    expect(g.discardPile).toContain(22);
    g.phase = "low";
    g.estates[32] = { owner: "b", buildings: [] };
    act(g, "travel", { destination: 0 });
    expect(g.players[0].cash).toBe(1500000);
    expect(g.players[0].freeLow).toBe(false);
    expect(count(g)).toHaveLength(30);
  });
  it("이동 카드의 경유 통행료 처리 후 목적지 효과", () => {
    const g = game();
    g.estates[15] = { owner: "b", buildings: [] };
    card(g, 20);
    expect(g.players[0].position).toBe(15);
    expect(g.payment?.amount).toBe(300000);
    act(g, "pay");
    expect(g.players[0].position).toBe(1);
    expect(g.phase).toBe("purchase");
    expect(g.players[1].cash).toBe(1800000);
  });
  it("모든 카드 효과의 단일 실행 후 카드 총수 유지", () => {
    for (const c of CARDS) {
      const g = game();
      card(g, c.id);
      expect(count(g).sort((a, b) => a - b)).toEqual(CARDS.map((c) => c.id));
      expect(g.lastCard).toBe(c.id);
    }
  });
});
describe("만조·간조·타이머·파산", () => {
  it("세 번째 더블은 보상 없이 즉시 만조", () => {
    const g = game();
    g.doubles = 2;
    g.players[0].position = 39;
    apply(g, "a", { type: "roll" }, start, () => 0);
    tick(g, start + 2500, randomInt);
    expect(g.players[0].position).toBe(10);
    expect(g.players[0].tide).toBe(3);
    expect(g.players[0].cash).toBe(1500000);
    expect(g.players[0].laps).toBe(0);
  });
  it("만조 3회 실패 후 다음 차례 정상 이동, 탈출 더블 추가 굴림 없음", () => {
    const g = game();
    const p = g.players[0];
    p.position = 10;
    p.tide = 3;
    for (let i = 0; i < 3; i++) {
      g.phase = "roll";
      let n = 0;
      apply(g, "a", { type: "roll" }, start, () => n++ % 2);
      tick(g, start + 2500, randomInt);
      expect(p.tide).toBe(2 - i);
      expect(p.position).toBe(10);
    }
    g.phase = "roll";
    p.tide = 1;
    apply(g, "a", { type: "roll" }, start, () => 1);
    tick(g, start + 2500, randomInt);
    expect(p.position).toBe(14);
    expect(g.extra).toBe(false);
    expect(g.doubles).toBe(0);
  });
  it("탈출권은 만조에서만 사용 가능", () => {
    const g = game();
    card(g, 24);
    g.phase = "roll";
    expect(() => act(g, "use", { card: 24 })).toThrow();
    g.players[0].tide = 3;
    act(g, "use", { card: 24 });
    expect(g.players[0].tide).toBe(0);
    expect(count(g)).toHaveLength(30);
  });
  it("간조 요금과 갯벌 도착료 별도 정산, 강제 이동 완주 보상 없음", () => {
    const g = game();
    g.players[0].position = 30;
    g.players[0].low = true;
    g.phase = "low";
    g.estates[32] = { owner: "b", buildings: [] };
    act(g, "travel", { destination: 32 });
    expect(g.payment?.amount).toBe(200000);
    act(g, "pay");
    expect(g.payment?.amount).toBe(400000);
    act(g, "pay");
    expect(g.players[0].cash).toBe(900000);
    expect(g.players[1].cash).toBe(2100000);
    expect(g.players[0].laps).toBe(0);
  });
  it("자연보호기금 납부와 전액 환급", () => {
    const g = game();
    g.players[0].position = 38;
    land(g, start, randomInt);
    act(g, "pay");
    expect(g.fund).toBe(150000);
    g.players[0].position = 20;
    land(g, start, randomInt);
    expect(g.fund).toBe(0);
    expect(g.players[0].cash).toBe(1500000);
  });
  it("60초 시간초과 자동 굴림/구매포기 및 애니메이션 시간 분리", () => {
    const g = game();
    g.players[0].position = 39;
    expect(tick(g, start + 59999, randomInt)).toBe(false);
    expect(tick(g, start + 60000, () => 0)).toBe(true);
    expect(g.phase).toBe("animation");
    expect(tick(g, start + 61000, randomInt)).toBe(false);
    tick(g, start + 62500, randomInt);
    expect(g.deadline).toBe(start + 62500 + 480);
    g.phase = "purchase";
    tick(g, g.deadline, randomInt);
    expect(g.phase).toBe("end");
  });
  it("파산 후 은행 반환, 보관 카드 반환, 시작 연구비 변경 없이 승리", () => {
    const g = game();
    g.players[0].cash = 0;
    g.players[0].position = 39;
    g.estates[1] = { owner: "a", buildings: [true, false, false] };
    g.estates[39] = { owner: "b", buildings: [] };
    g.players[0].held = [24, 25];
    g.drawPile = g.drawPile.filter((x) => x !== 24 && x !== 25);
    land(g, start, randomInt);
    act(g, "bankrupt");
    expect(g.estates[1]).toBeUndefined();
    expect(g.players[0].bankrupt).toBe(true);
    expect(g.players[1].cash).toBe(1500000);
    expect(g.winner).toEqual(["b"]);
    expect(count(g).sort((a, b) => a - b)).toEqual(CARDS.map((c) => c.id));
  });
  it("제한 시간 종료 총자산 승리/동률 공동 승리", () => {
    const g = game();
    g.estates[1] = { owner: "b", buildings: [true, true, true] };
    expect(assets(g, g.players[1])).toBe(2000000);
    tick(g, g.endsAt, randomInt);
    expect(g.winner).toEqual(["b"]);
    const tie = game();
    tick(tie, tie.endsAt, randomInt);
    expect(tie.winner).toEqual(["a", "b"]);
  });
});
it("서버 AI 장기 시뮬레이션: 유효한 행동, 정수 자산, 30장 불변식", () => {
  for (const difficulty of ["easy", "normal", "hard"] as const) {
    let now = start;
    const g = createGame(
      users.map((u) => ({ ...u, ai: difficulty })),
      now,
      randomInt,
      30,
    );
    for (let i = 0; i < 3000 && g.phase !== "finished"; i++) {
      now += 1000;
      tick(g, now, randomInt);
      if (g.phase !== "animation" && !g.winner) {
        apply(g, g.players[g.turn].id, decide(g), now, randomInt);
      }
      expect(new Set(count(g)).size).toBe(30);
      expect(count(g)).toHaveLength(30);
      expect(
        g.players.every((p) => Number.isInteger(p.cash) && p.cash >= 0),
      ).toBe(true);
    }
  }
});
it("실제 구매 및 자기 소유지 도착 시 통행료 없음", () => {
  const g = game();
  g.players[0].position = 1;
  land(g, start, randomInt);
  act(g, "buy");
  expect(g.players[0].cash).toBe(1450000);
  expect(g.estates[1].owner).toBe("a");
  land(g, start, randomInt);
  expect(g.payment).toBeUndefined();
  expect(g.players[0].cash).toBe(1450000);
});
it("면제권 선택이 없으면 자동 정산, 선택이 있으면 대기", () => {
  const g = game();
  g.players[0].position = 1;
  g.estates[1] = { owner: "b", buildings: [true, true, false] };
  land(g, start, randomInt);
  tick(g, start + 1, randomInt);
  expect(g.players[0].cash).toBe(1398000);
  expect(g.players[1].cash).toBe(1602000);
  g.players[0].held = [25];
  land(g, start, randomInt);
  tick(g, start + 2, randomInt);
  expect(g.phase).toBe("toll");
  expect(g.players[0].cash).toBe(1398000);
});
it("간조 이용료에는 통행료 면제권 사용 불가", () => {
  const g = game();
  g.phase = "low";
  g.players[0].low = true;
  g.players[0].held = [25];
  g.estates[32] = { owner: "b", buildings: [] };
  act(g, "travel", { destination: 0 });
  expect(g.phase).toBe("debt");
  expect(() => act(g, "use", { card: 25 })).toThrow();
});

describe("서버 시간 경계", () => {
  it.each([0, 1, 199])(
    "타이머 검사 전이라도 마감 %i ms 이후 구매를 거절한다",
    (late) => {
      const g = game();
      g.players[0].position = 1;
      land(g, start, randomInt);
      const before = structuredClone(g);
      expect(() =>
        apply(g, "a", { type: "buy" }, g.deadline + late, randomInt),
      ).toThrow("행동 시간");
      expect(g).toEqual(before);
      tick(g, g.deadline + late, randomInt);
      expect(g.phase).toBe("end");
      expect(g.estates[1]).toBeUndefined();
    },
  );
  it("행동 마감 직전 요청은 허용한다", () => {
    const g = game();
    g.players[0].position = 1;
    land(g, start, randomInt);
    apply(g, "a", { type: "buy" }, g.deadline - 1, randomInt);
    expect(g.estates[1].owner).toBe("a");
  });
  it("게임 종료 시각 이후에는 보유 자산을 매각할 수 없다", () => {
    const g = game();
    g.estates[1] = { owner: "a", buildings: [false, false, false] };
    g.deadline = g.endsAt + 60000;
    const before = structuredClone(g);
    expect(() =>
      apply(g, "a", { type: "sell", tile: 1 }, g.endsAt, randomInt),
    ).toThrow("게임 제한 시간");
    expect(g).toEqual(before);
    tick(g, g.endsAt, randomInt);
    expect(g.phase).toBe("finished");
  });
  it("시간 초과 자동 굴림은 계속 동작한다", () => {
    const g = game();
    tick(g, g.deadline, () => 0);
    expect(g.phase).toBe("animation");
    expect(g.dice).toEqual([1, 1]);
  });
  it("시간 초과 후 종료 대기 중에는 매각을 막고 다음 차례로 진행한다", () => {
    const g = game();
    g.phase = "purchase";
    g.estates[1] = { owner: "a", buildings: [false, false, false] };
    const deadline = g.deadline;
    tick(g, deadline, randomInt);
    expect(g.phase).toBe("end");
    expect(() =>
      apply(g, "a", { type: "sell", tile: 1 }, deadline + 1, randomInt),
    ).toThrow("행동 시간");
    apply(g, "a", { type: "end" }, deadline + 1, randomInt);
    expect(g.turn).toBe(1);
    expect(g.deadline).toBe(deadline + 60001);
  });
});

describe("하나의 행동 시간 예산", () => {
  it("주사위를 늦게 굴려도 연출 시간만 제외하고 남은 시간은 유지한다", () => {
    const g = game();
    const deadline = g.deadline;
    g.players[0].position = 39;
    apply(g, "a", { type: "roll" }, start + 59000, () => 0);
    tick(g, start + 61400, randomInt);
    expect(g.deadline).toBe(deadline + 2400 + 480);
    expect(g.deadline - (start + 61880)).toBe(1000);
  });
  it("만조 탈출권 사용으로 새 60초를 받지 않는다", () => {
    const g = game();
    g.players[0].tide = 3;
    g.players[0].held = [24];
    g.drawPile = g.drawPile.filter((id) => id !== 24);
    const deadline = g.deadline;
    apply(g, "a", { type: "use", card: 24 }, start + 59000, randomInt);
    expect(g.players[0].tide).toBe(0);
    expect(g.deadline).toBe(deadline);
  });
  it("매각 후 자동 정산은 대기 시간만 제외하고 기존 예산을 이어간다", () => {
    const g = game();
    g.phase = "low";
    g.players[0].low = true;
    g.players[0].cash = 190000;
    g.estates[32] = { owner: "b", buildings: [] };
    g.estates[1] = { owner: "a", buildings: [false, false, false] };
    const deadline = g.deadline;
    apply(g, "a", { type: "travel", destination: 3 }, start, randomInt);
    apply(g, "a", { type: "sell", tile: 1 }, start + 59000, randomInt);
    tick(g, start + 59200, randomInt);
    expect(g.phase).toBe("purchase");
    expect(g.players[0].position).toBe(3);
    expect(g.deadline).toBe(deadline + 200 + 720);
    expect(g.deadline - (start + 59920)).toBe(1000);
    expect(g.players[1].cash).toBe(1700000);
  });
});

it("시간 초과 시 자산 매각 후에도 전액을 납부할 수 없으면 파산한다", () => {
  const g = game();
  g.players[0].cash = 100000;
  g.players[0].position = 38;
  g.estates[1] = { owner: "a", buildings: [false, false, false] };
  g.players[0].held = [24];
  g.drawPile = g.drawPile.filter((id) => id !== 24);
  land(g, start, randomInt);
  expect(g.phase).toBe("debt");
  tick(g, g.deadline, randomInt);
  expect(g.players[0].bankrupt).toBe(true);
  expect(g.players[0].cash).toBe(0);
  expect(g.fund).toBe(125000);
  expect(g.estates[1]).toBeUndefined();
  expect(count(g).sort((a, b) => a - b)).toEqual(CARDS.map((c) => c.id));
  expect(g.winner).toEqual(["b"]);
});
it("통행료 면제권 선택 시간은 멈추지 않으며 만료 시 카드 없이 자동 지급한다", () => {
  const g = game();
  g.players[0].held = [25];
  g.drawPile = g.drawPile.filter((id) => id !== 25);
  g.estates[1] = { owner: "b", buildings: [false, false, false] };
  g.players[0].position = 1;
  land(g, start + 59000, randomInt);
  expect(g.pausedAt).toBeUndefined();
  expect(remainingMs(g, start + 59500)).toBe(500);
  tick(g, g.deadline, randomInt);
  expect(g.players[0].held).toEqual([25]);
  expect(g.players[0].cash).toBe(1498000);
  expect(g.players[1].cash).toBe(1502000);
  expect(g.phase).toBe("end");
});
it("더블의 추가 굴림에는 새 60초를 지급한다", () => {
  const g = game();
  g.players[0].position = 39;
  apply(g, "a", { type: "roll" }, start + 59000, () => 0);
  tick(g, start + 61400, randomInt);
  apply(g, "a", { type: "skip" }, start + 61500, randomInt);
  apply(g, "a", { type: "end" }, start + 61600, randomInt);
  expect(g.turn).toBe(0);
  expect(g.phase).toBe("roll");
  expect(g.doubles).toBe(1);
  expect(remainingMs(g, start + 61600)).toBe(60000);
  expect(g.pausedAt).toBeUndefined();
});
it("주사위 연출 중 저장 후 복구해도 남은 시간은 동일하다", () => {
  const g = game();
  g.players[0].position = 39;
  apply(g, "a", { type: "roll" }, start + 59000, () => 0);
  const restored: Game = JSON.parse(JSON.stringify(g));
  expect(remainingMs(restored, start + 61000)).toBe(1000);
  tick(restored, start + 61400, randomInt);
  expect(remainingMs(restored, start + 61880)).toBe(1000);
  expect(restored.pausedAt).toBeUndefined();
});
it("중지 시각이 없는 기존 주사위 스냅샷도 복구한다", () => {
  const g = game();
  g.players[0].position = 39;
  apply(g, "a", { type: "roll" }, start + 59000, () => 0);
  delete g.pausedAt;
  tick(g, start + 61400, randomInt);
  expect(remainingMs(g, start + 61880)).toBe(1000);
});
