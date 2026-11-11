import boardData from "./board.json" with { type: "json" };
import cardData from "./cards.json" with { type: "json" };
export type Difficulty = "easy" | "normal" | "hard";
export interface Tile {
  id: number;
  name: string;
  kind: string;
  zone: number;
  price?: number;
  costs?: number[];
  rents?: number[];
  science?: string;
  field?: string;
}
export const BOARD: Tile[] = boardData;
export const CARDS = cardData;
export const ZONES = ["지상현상", "해상현상", "기상현상", "천문현상"];
export const BUILDINGS = ["관측소", "연구소", "종합연구센터"];
export interface Player {
  id: string;
  name: string;
  ai?: Difficulty;
  cash: number;
  position: number;
  laps: number;
  held: number[];
  tide: number;
  low: boolean;
  freeLow: boolean;
  bankrupt: boolean;
}
export interface Estate {
  owner: string;
  buildings: boolean[];
}
export type Phase =
  | "roll"
  | "animation"
  | "moving"
  | "reveal"
  | "purchase"
  | "build"
  | "toll"
  | "debt"
  | "low"
  | "end"
  | "finished";
export interface Payment {
  amount: number;
  to?: string;
  fund?: boolean;
  toll?: boolean;
  after?: number[];
}
export interface Game {
  players: Player[];
  estates: Record<number, Estate>;
  turn: number;
  turnOrder?: number[];
  phase: Phase;
  version: number;
  dice: [number, number];
  doubles: number;
  extra: boolean;
  deadline: number;
  pausedAt?: number;
  endsAt: number;
  animationUntil: number;
  pendingSteps: number;
  motion?: {
    remaining: number;
    direction: number;
    reward: boolean;
    total: number;
    done: number;
    label: string;
    finish: "land" | "stop" | "transport" | "high";
    after?: number[];
  };
  pendingCard?: number;
  escapeRoll: boolean;
  fund: number;
  drawPile: number[];
  discardPile: number[];
  deckVersion: number;
  payment?: Payment;
  log: string[];
  lastActions?: Record<string, string>;
  lastCard?: number;
  winner?: string[];
  settlement?: { tile: number; parts: number[]; amount: number };
}
export interface Action {
  type: string;
  tile?: number;
  building?: number;
  card?: number;
  destination?: number;
}
export type Random = (max: number) => number;
const requireRule = (v: unknown, message: string) => {
  if (!v) throw new Error(message);
};
export const active = (g: Game) => g.players[g.turn];
export function remainingMs(
  g: Pick<Game, "deadline" | "pausedAt">,
  now: number,
) {
  return Math.max(0, g.deadline - (g.pausedAt ?? now));
}
function pauseClock(g: Game, now: number) {
  g.pausedAt ??= now;
}
function resumeClock(g: Game, now: number) {
  if (g.pausedAt !== undefined) {
    g.deadline += Math.max(0, now - g.pausedAt);
    delete g.pausedAt;
  }
}
function canAutoPay(g: Game) {
  return (
    !!g.payment &&
    active(g).cash >= g.payment.amount &&
    !(g.phase === "toll" && active(g).held.includes(25))
  );
}

export function shuffle<T>(items: T[], rng: Random) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function createGame(
  users: { id: string; name: string; ai?: Difficulty }[],
  now: number,
  rng: Random,
  minutes = 30,
): Game {
  requireRule(users.length >= 2 && users.length <= 4, "참가자는 2~4명입니다.");
  requireRule(
    new Set(users.map((p) => p.id)).size === users.length,
    "중복 참가자입니다.",
  );
  const game: Game = {
    players: users.map((p) => ({
      ...p,
      cash: users.length === 2 ? 1500000 : 3000000,
      position: 0,
      laps: 0,
      held: [],
      tide: 0,
      low: false,
      freeLow: false,
      bankrupt: false,
    })),
    estates: {},
    turn: 0,
    phase: "roll",
    version: 0,
    dice: [1, 1],
    doubles: 0,
    extra: false,
    deadline: now + 60000,
    endsAt: now + minutes * 60000,
    animationUntil: 0,
    pendingSteps: 0,
    escapeRoll: false,
    fund: 0,
    drawPile: shuffle(
      CARDS.map((c) => c.id),
      rng,
    ),
    discardPile: [],
    deckVersion: 0,
    log: ["탐사를 시작합니다. 출발지를 통과하면 연구비 20만을 받습니다."],
  };
  // Keep player identities/colors stable while drawing a fresh order each game.
  const remaining = users.map((_, i) => i);
  game.turnOrder = [];
  while (remaining.length > 1)
    game.turnOrder.push(remaining.splice(rng(remaining.length), 1)[0]);
  game.turnOrder.push(remaining[0]);
  game.turn = game.turnOrder[0];
  game.log.push(
    `진행 순서 · ${game.turnOrder.map((i) => users[i].name).join(" → ")}`,
  );
  return game;
}
function log(g: Game, text: string) {
  (g.lastActions ??= {})[active(g).id] = text;
  g.log.push(text);
  g.log = g.log.slice(-100);
}
export function rent(g: Game, id: number) {
  const t = BOARD[id],
    e = g.estates[id];
  return (t.rents ?? []).reduce(
    (s, n, i) => s + (i === 0 || e?.buildings[i - 1] ? n : 0),
    0,
  );
}
export function assets(g: Game, p: Player) {
  return (
    p.cash +
    Object.entries(g.estates).reduce(
      (s, [id, e]) =>
        s +
        (e.owner === p.id
          ? BOARD[+id].price! +
            e.buildings.reduce(
              (v, b, i) => v + (b ? BOARD[+id].costs![i] : 0),
              0,
            )
          : 0),
      0,
    )
  );
}
function returnCard(g: Game, id: number) {
  g.discardPile.push(id);
  g.deckVersion++;
}
export function finish(g: Game) {
  const alive = g.players.filter((p) => !p.bankrupt);
  const max = Math.max(...alive.map((p) => assets(g, p)));
  g.winner = alive.filter((p) => assets(g, p) === max).map((p) => p.id);
  g.phase = "finished";
  delete g.pausedAt;
  log(g, "탐사 종료 · 최종 자산으로 결과를 확정했습니다.");
}
function checkWinner(g: Game) {
  if (g.players.filter((p) => !p.bankrupt).length <= 1) finish(g);
}
export function estateValue(g: Pick<Game, "estates">, id: number) {
  const t = BOARD[id],
    e = g.estates[id];
  return (
    t.price! +
    (e?.buildings ?? []).reduce(
      (sum, built, i) => sum + (built ? t.costs![i] : 0),
      0,
    )
  );
}
export function nextSaleBuilding(g: Pick<Game, "estates">, id: number) {
  return (g.estates[id]?.buildings ?? [])
    .flatMap((built, i) => (built ? [i] : []))
    .sort((a, b) => b - a)[0];
}
export function autoSalePlan(g: Game, p: Player, required: number): Action[] {
  const owned = BOARD.filter((t) => g.estates[t.id]?.owner === p.id);
  // Only a property's highest remaining tier is eligible at each step.
  const pending = new Map(
    owned.map((t) => [t.id, [...g.estates[t.id].buildings]]),
  );
  const buildings: { type: string; tile: number; building: number }[] = [];
  for (;;) {
    const candidates = owned
      .flatMap((t) => {
        const building = pending.get(t.id)!.findLastIndex(Boolean);
        return building < 0 ? [] : [{ type: "sell", tile: t.id, building }];
      })
      .sort(
        (a, b) =>
          BOARD[a.tile].costs![a.building] - BOARD[b.tile].costs![b.building] ||
          a.tile - b.tile,
      );
    const next = candidates[0];
    if (!next) break;
    buildings.push(next);
    pending.get(next.tile)![next.building] = false;
  }
  const lands: Action[] = owned
    .sort((a, b) => a.price! - b.price! || a.id - b.id)
    .map((t) => ({ type: "sell", tile: t.id }));
  const result: Action[] = [];
  let raised = 0;
  for (const a of [...buildings, ...lands]) {
    if (raised >= required) break;
    raised +=
      (a.building === undefined
        ? BOARD[a.tile!].price!
        : BOARD[a.tile!].costs![a.building]) / 2;
    result.push(a);
  }
  return result;
}
function autoSell(g: Game, p: Player, amount: number) {
  for (const a of autoSalePlan(g, p, amount - p.cash))
    sell(g, p, a.tile!, a.building);
}
export function sell(g: Game, p: Player, id: number, building?: number) {
  const t = BOARD[id],
    e = g.estates[id];
  requireRule(e && e.owner === p.id, "자신의 소유지만 매각할 수 있습니다.");
  if (building !== undefined) {
    requireRule(
      Number.isInteger(building) &&
        building >= 0 &&
        building < 3 &&
        e.buildings[building],
      "없는 시설입니다.",
    );
    requireRule(
      building === nextSaleBuilding(g, id),
      "비싼 건물부터 순서대로 매각하세요.",
    );
    e.buildings[building] = false;
    p.cash += t.costs![building] / 2;
    log(g, `${p.name} · ${t.name} ${BUILDINGS[building]} 매각`);
  } else {
    requireRule(!e.buildings.some(Boolean), "건물을 먼저 매각하세요.");
    p.cash += t.price! / 2;
    delete g.estates[id];
    log(g, `${p.name} · ${t.name} 매각`);
  }
}
function resolveInsolvency(g: Game, p: Player, now: number, rng: Random) {
  const due = g.payment!.amount;
  autoSell(g, p, due);
  if (p.cash >= due) {
    log(g, `${p.name} · 자동 매각으로 부족분을 충당하여 파산을 취소했습니다.`);
    completePayment(g, now, rng);
  } else bankrupt(g, p);
}
function bankrupt(g: Game, p: Player) {
  p.bankrupt = true;
  p.freeLow = false;
  for (const [id, e] of Object.entries(g.estates))
    if (e.owner === p.id) delete g.estates[+id];
  for (const id of p.held) returnCard(g, id);
  p.held = [];
  if (g.payment) {
    const amount = Math.max(0, p.cash);
    if (g.payment.to) {
      const q = g.players.find((x) => x.id === g.payment!.to);
      if (q) q.cash += amount;
    } else if (g.payment.fund) g.fund += amount;
  }
  p.cash = 0;
  g.payment = undefined;
  log(
    g,
    `${p.name} 파산 · 자산을 모두 매각하고 남은 연구비를 전액 지급했습니다.`,
  );
  g.phase = "end";
  g.extra = false;
  checkWinner(g);
}
function stop(g: Game) {
  g.phase = "end";
}
function pay(g: Game, p: Player, payment: Payment, now: number) {
  g.payment = payment;
  g.phase = payment.to && payment.toll !== false ? "toll" : "debt";
  if (canAutoPay(g)) pauseClock(g, now);
  log(g, `${p.name} · ${payment.amount.toLocaleString()} 연구비 정산 대기`);
}
function completePayment(g: Game, now: number, rng: Random) {
  const p = active(g),
    v = g.payment!;
  requireRule(
    p.cash >= v.amount,
    "연구비가 부족합니다. 자산을 매각하거나 파산하세요.",
  );
  resumeClock(g, now);
  p.cash -= v.amount;
  if (v.to) g.players.find((x) => x.id === v.to)!.cash += v.amount;
  else if (v.fund) g.fund += v.amount;
  log(
    g,
    `${p.name} · ${v.to ? g.players.find((q) => q.id === v.to)!.name + "에게 " : "은행에 "}${v.amount.toLocaleString()} 연구비 지급 완료`,
  );
  g.payment = undefined;
  if (v.after?.length) transport(g, v.after, now, rng);
  else stop(g);
}
function high(g: Game, p: Player) {
  p.position = 10;
  p.tide = 3;
  p.low = false;
  g.extra = false;
  g.doubles = 0;
  stop(g);
}
function move(g: Game, steps: number, reward: boolean) {
  const p = active(g);
  for (let i = 0; i < Math.abs(steps); i++) {
    p.position = (p.position + (steps < 0 ? -1 : 1) + 40) % 40;
    if (reward && p.position === 0) {
      p.laps++;
      p.cash += 200000;
      log(g, `${p.name} · 출발지 통과, 연구비 20만 지급 (${p.laps}회 완주)`);
    }
  }
}
export function movementInterval(total: number) {
  return total > 0 ? (240 * Math.min(6, total)) / total : 240;
}
function beginMove(
  g: Game,
  steps: number,
  reward: boolean,
  now: number,
  label: string,
  finish: NonNullable<Game["motion"]>["finish"] = "land",
  after?: number[],
) {
  pauseClock(g, now);
  g.motion = {
    remaining: Math.abs(steps),
    direction: steps < 0 ? -1 : 1,
    reward: reward && finish !== "high",
    total: Math.abs(steps),
    done: 0,
    label,
    finish,
    after,
  };
  g.phase = "moving";
  g.animationUntil = now + movementInterval(Math.abs(steps));
  log(g, `${active(g).name} · ${label} (${Math.abs(steps)}칸)`);
}
function transport(g: Game, path: number[], now: number, rng: Random) {
  const [target, ...after] = path;
  beginMove(
    g,
    (target - active(g).position + 40) % 40,
    true,
    now,
    `지정 이동 → ${BOARD[target].name}`,
    "transport",
    after,
  );
}
function finishMotion(g: Game, now: number, rng: Random) {
  const m = g.motion!,
    p = active(g);
  delete g.motion;
  resumeClock(g, now);
  if (m.finish === "high") high(g, p);
  else if (m.finish === "stop") stop(g);
  else if (m.finish === "transport" && m.after?.length) {
    const e = g.estates[p.position];
    if (e && e.owner !== p.id)
      pay(
        g,
        p,
        { amount: rent(g, p.position), to: e.owner, after: m.after },
        now,
      );
    else transport(g, m.after, now, rng);
  } else land(g, now, rng);
}
export function draw(g: Game, rng: Random) {
  if (!g.drawPile.length) {
    g.drawPile = shuffle(g.discardPile, rng);
    g.discardPile = [];
    g.deckVersion++;
  }
  const id = g.drawPile.shift();
  if (id) g.deckVersion++;
  return id;
}
function drawEffect(g: Game, now: number, rng: Random) {
  const p = active(g),
    id = draw(g, rng);
  if (!id) {
    log(g, "현재 뽑을 수 있는 카드가 없습니다.");
    stop(g);
    return;
  }
  g.lastCard = id;
  // The drawn card remains in the discard pile during the public reveal so
  // physical card accounting stays exact across saves and reconnects.
  g.discardPile.push(id);
  g.pendingCard = id;
  g.phase = "reveal";
  g.animationUntil = now + 3600;
  pauseClock(g, now);
  log(g, `${p.name} · 카드 공개: ${CARDS[id - 1].name}`);
}
function resolveCard(g: Game, now: number, rng: Random) {
  const p = active(g),
    id = g.pendingCard!;
  delete g.pendingCard;
  resumeClock(g, now);
  if (CARDS[id - 1].cardType === "consumable") {
    g.discardPile.splice(g.discardPile.indexOf(id), 1);
    p.held.push(id);
    log(g, `${p.name} · ${CARDS[id - 1].name} → 보유 카드`);
    stop(g);
    return;
  }
  log(g, `${p.name} · ${CARDS[id - 1].name}: ${CARDS[id - 1].effect}`);
  const gains: Record<number, number> = {
    1: 200000,
    2: 150000,
    3: 100000,
    4: 100000,
    5: 300000,
    6: 300000,
    14: 200000,
  };
  if (gains[id]) {
    p.cash += gains[id];
    stop(g);
    return;
  }
  const fees: Record<number, number> = {
    7: 100000,
    8: 100000,
    9: 50000,
    10: 100000,
    11: 150000,
  };
  if (fees[id]) {
    pay(g, p, { amount: fees[id], fund: id === 10 || id === 11 }, now);
    return;
  }
  if (id === 12 || id === 13) {
    const rates = id === 12 ? [10000, 30000, 50000] : [5000, 15000, 25000];
    const amount = Object.values(g.estates)
      .filter((e) => e.owner === p.id)
      .reduce(
        (v, e) =>
          v + e.buildings.reduce((s, b, i) => s + (b ? rates[i] : 0), 0),
        0,
      );
    if (amount) pay(g, p, { amount }, now);
    else stop(g);
    return;
  }
  const destinations: Record<number, number> = {
    15: 20,
    16: 5,
    17: 25,
    18: 39,
    19: 32,
    22: 30,
    26: 0,
  };
  if (id in destinations) {
    if (id === 22) p.freeLow = true;
    transport(g, [destinations[id]], now, rng);
    return;
  }
  if (id === 20 || id === 21) {
    transport(g, id === 20 ? [15, 1] : [28, 3], now, rng);
    return;
  }
  if (id === 23) {
    beginMove(g, (10 - p.position + 40) % 40, false, now, "만조 이동", "high");
    return;
  }
  if (id === 27) {
    beginMove(g, 40, true, now, "카드 효과 · 한 바퀴 후 재추첨", "land");
    return;
  }
  if (id === 28 || id === 29) {
    beginMove(g, id === 28 ? -2 : -3, true, now, "카드 효과 · 뒤로 이동");
    return;
  }
  if (id === 30) {
    const ids = Object.keys(g.estates)
      .map(Number)
      .filter((i) => g.estates[i].owner === p.id)
      .sort((a, b) => estateValue(g, b) - estateValue(g, a) || a - b);
    if (ids.length) {
      const i = ids[0];
      for (let n = 2; n >= 0; n--)
        if (g.estates[i].buildings[n]) sell(g, p, i, n);
      sell(g, p, i);
    }
    stop(g);
  }
}
export function land(g: Game, now: number, rng: Random) {
  const p = active(g),
    t = BOARD[p.position];
  log(g, `${p.name} → ${t.name}`);
  g.settlement = undefined;
  if (t.kind === "property") {
    const e = g.estates[t.id];
    if (!e) g.phase = "purchase";
    else if (e.owner === p.id) {
      const stage = e.buildings.findIndex((v) => !v);
      g.phase =
        t.costs?.length && stage >= 0 && p.laps >= stage + 1 ? "build" : "end";
    } else {
      g.settlement = {
        tile: t.id,
        parts: t.rents!.map((n, i) => (i === 0 || e.buildings[i - 1] ? n : 0)),
        amount: rent(g, t.id),
      };
      pay(g, p, { amount: rent(g, t.id), to: e.owner }, now);
    }
  } else if (t.kind === "card") drawEffect(g, now, rng);
  else if (t.kind === "high") high(g, p);
  else if (t.kind === "low") {
    p.low = true;
    stop(g);
  } else if (t.kind === "refund") {
    p.cash += g.fund;
    log(g, `${p.name} · 자연보호기금 ${g.fund.toLocaleString()} 환급`);
    g.fund = 0;
    stop(g);
  } else if (t.kind === "fund") pay(g, p, { amount: 150000, fund: true }, now);
  else stop(g);
}
function next(g: Game, now: number) {
  if (g.phase === "finished") return;
  delete g.pausedAt;
  if (g.extra && !active(g).bankrupt && !active(g).tide) {
    log(g, `${active(g).name} · 더블로 한 번 더 굴립니다.`);
    g.phase = active(g).low ? "low" : "roll";
    g.deadline = now + 60000;
    g.extra = false;
    return;
  }
  do {
    const order = g.turnOrder ?? g.players.map((_, i) => i);
    g.turn = order[(order.indexOf(g.turn) + 1) % order.length];
  } while (active(g).bankrupt);
  g.doubles = 0;
  g.extra = false;
  g.phase = active(g).low ? "low" : "roll";
  g.deadline = now + 60000;
}
export function apply(
  g: Game,
  actor: string,
  a: Action,
  now: number,
  rng: Random,
) {
  requireRule(g.phase !== "finished", "종료된 게임입니다.");
  requireRule(now < g.endsAt, "게임 제한 시간이 종료됐습니다.");
  requireRule(
    (g.phase === "end" && a.type === "end") || remainingMs(g, now) > 0,
    "행동 시간이 초과됐습니다. 서버의 자동 처리를 기다리세요.",
  );
  performAction(g, actor, a, now, rng);
}
// Automatic timeout actions run after the deadline; clients always use apply().
function performAction(
  g: Game,
  actor: string,
  a: Action,
  now: number,
  rng: Random,
) {
  requireRule(g.phase !== "finished", "종료된 게임입니다.");
  requireRule(active(g).id === actor, "자신의 차례가 아닙니다.");
  const p = active(g);
  if (a.type === "sell") {
    requireRule(
      !["animation", "moving", "reveal"].includes(g.phase),
      "연출 중에는 매각할 수 없습니다.",
    );
    requireRule(
      Number.isInteger(a.tile) && !!BOARD[a.tile!]?.price,
      "잘못된 소유지입니다.",
    );
    sell(g, p, a.tile!, a.building);
    if (canAutoPay(g)) pauseClock(g, now);
    return;
  }
  if (a.type === "auto-sell") {
    requireRule(
      (g.phase === "toll" || g.phase === "debt") && !!g.payment,
      "정산 중에 자동 매각할 수 있습니다.",
    );
    requireRule(p.cash < g.payment!.amount, "이미 정산할 연구비가 충분합니다.");
    requireRule(
      autoSalePlan(g, p, g.payment!.amount - p.cash).length > 0,
      "매각할 자산이 없습니다.",
    );
    log(g, `${p.name} · 부족분 자동 매각 (싼 건물 우선, 토지도 싼 순서)`);
    autoSell(g, p, g.payment!.amount);
    if (canAutoPay(g)) pauseClock(g, now);
    return;
  }
  if (a.type === "bankrupt") {
    requireRule(
      g.phase === "debt" || g.phase === "toll",
      "정산 중에만 파산할 수 있습니다.",
    );
    requireRule(p.cash < g.payment!.amount, "연구비로 정산할 수 있습니다.");
    resolveInsolvency(g, p, now, rng);
    return;
  }
  if (a.type === "use") {
    requireRule(a.card === 24 || a.card === 25, "사용할 수 없는 카드입니다.");
    requireRule(p.held.includes(a.card!), "보유하지 않은 카드입니다.");
    if (a.card === 24) {
      requireRule(g.phase === "roll" && p.tide > 0, "만조 탈출 시 사용하세요.");
      p.tide = 0;
      log(g, `${p.name} · 만조 탈출권 사용`);
    } else {
      requireRule(
        g.phase === "toll" && !!g.payment?.to,
        "통행료 정산 전에 사용하세요.",
      );
      const path = g.payment?.after;
      log(g, `${p.name} · 통행료 면제권 사용 (지급 0)`);
      if (g.settlement) g.settlement.amount = 0;
      g.payment = undefined;
      if (path) transport(g, path, now, rng);
      else stop(g);
    }
    p.held.splice(p.held.indexOf(a.card!), 1);
    returnCard(g, a.card!);
    return;
  }
  switch (a.type) {
    case "roll": {
      requireRule(
        g.phase === "roll" || g.phase === "low",
        "주사위를 굴릴 수 없습니다.",
      );
      p.low = false;
      g.dice = [rng(6) + 1, rng(6) + 1];
      g.extra = false;
      const double = g.dice[0] === g.dice[1];
      g.escapeRoll = p.tide > 0;
      if (!g.escapeRoll) {
        g.doubles = double ? g.doubles + 1 : 0;
        g.extra = double;
      }
      pauseClock(g, now);
      g.pendingSteps = g.dice[0] + g.dice[1];
      g.phase = "animation";
      g.animationUntil = now + 2400;
      log(
        g,
        `${p.name} · 주사위 ${g.dice.join(" + ")} = ${g.pendingSteps}칸${double ? " · 더블! 추가 주사위" : ""}`,
      );
      break;
    }
    case "buy": {
      requireRule(g.phase === "purchase", "구매할 수 없는 상태입니다.");
      const t = BOARD[p.position];
      requireRule(
        !g.estates[t.id] && t.price && p.cash >= t.price,
        "구매할 연구비가 부족합니다.",
      );
      p.cash -= t.price!;
      g.estates[t.id] = { owner: p.id, buildings: t.costs!.map(() => false) };
      log(g, `${p.name} · ${t.name} 구매 (${t.price!.toLocaleString()})`);
      stop(g);
      break;
    }
    case "build": {
      requireRule(g.phase === "build", "건설할 수 없는 상태입니다.");
      const t = BOARD[p.position],
        e = g.estates[t.id],
        i = e?.buildings.findIndex((b) => !b);
      requireRule(
        e?.owner === p.id && i !== undefined && i >= 0 && p.laps >= i + 1,
        "건설 해금 조건을 확인하세요.",
      );
      requireRule(
        a.building === undefined || a.building === i,
        "관측소 → 연구소 → 종합연구센터 순서로 건설하세요.",
      );
      const cost = t.costs![i];
      requireRule(p.cash >= cost, "건설할 연구비가 부족합니다.");
      p.cash -= cost;
      e.buildings[i] = true;
      log(
        g,
        `${p.name} · ${t.name} ${BUILDINGS[i]} 건설 (${cost.toLocaleString()})`,
      );
      const nextStage = e.buildings.findIndex((b) => !b);
      if (nextStage < 0 || p.laps < nextStage + 1) stop(g);
      break;
    }
    case "skip":
      requireRule(
        ["purchase", "build", "low"].includes(g.phase),
        "포기할 수 없는 상태입니다.",
      );
      log(
        g,
        `${p.name} · ${BOARD[p.position].name} ${g.phase === "purchase" ? "구매 포기" : g.phase === "build" ? "건설 마침" : "간조 이용 포기"}`,
      );
      if (g.phase === "low") {
        p.low = false;
        g.phase = "roll";
      } else stop(g);
      break;
    case "pay":
      requireRule(
        g.phase === "toll" || g.phase === "debt",
        "정산할 비용이 없습니다.",
      );
      completePayment(g, now, rng);
      break;
    case "travel": {
      requireRule(g.phase === "low", "간조에서만 이동할 수 있습니다.");
      requireRule(
        Number.isInteger(a.destination) &&
          a.destination! >= 0 &&
          a.destination! < 40 &&
          a.destination !== 30,
        "목적지를 확인하세요.",
      );
      p.low = false;
      const e = g.estates[32];
      if (e && e.owner !== p.id && !p.freeLow) {
        pay(
          g,
          p,
          {
            amount: 200000,
            to: e.owner,
            toll: false,
            after: [a.destination!],
          },
          now,
        );
      } else {
        p.freeLow = false;
        transport(g, [a.destination!], now, rng);
      }
      break;
    }
    case "end":
      requireRule(g.phase === "end", "도착 효과를 먼저 처리하세요.");
      next(g, now);
      break;
    default:
      throw new Error("알 수 없는 행동입니다.");
  }
}
export function tick(g: Game, now: number, rng: Random) {
  if (g.phase === "finished") return false;
  if (now >= g.endsAt) {
    finish(g);
    return true;
  }
  if (g.phase === "animation" && now >= g.animationUntil) {
    // Older snapshots did not store the pause start; infer it from the animation.
    pauseClock(g, g.animationUntil - 2400);
    resumeClock(g, now);
    const p = active(g);
    if (g.escapeRoll) {
      if (g.dice[0] === g.dice[1]) {
        p.tide = 0;
        g.doubles = 1;
        g.extra = true;
        log(g, `${p.name} · 더블로 만조 탈출! 도착 효과 후 한 번 더 굴립니다.`);
        beginMove(g, g.pendingSteps, true, now, "주사위 이동");
      } else {
        p.tide--;
        log(g, `${p.name} · 만조 탈출 실패 · 남은 시도 ${p.tide}회`);
        stop(g);
      }
    } else if (g.doubles === 3) {
      beginMove(
        g,
        (10 - p.position + 40) % 40,
        false,
        now,
        "더블 3회 · 만조 이동 (출발지 보상 없음)",
        "high",
      );
    } else {
      beginMove(g, g.pendingSteps, true, now, "주사위 이동");
    }
    return true;
  }
  if (g.phase === "moving") {
    if (now + 0.0001 < g.animationUntil) return false;
    const m = g.motion!;
    while (m.remaining > 0 && now + 0.0001 >= g.animationUntil) {
      move(g, m.direction, m.reward && m.finish !== "high");
      m.remaining--;
      m.done++;
      g.animationUntil += movementInterval(m.total);
    }
    if (!m.remaining) finishMotion(g, now, rng);
    return true;
  }
  if (g.phase === "reveal") {
    if (now < g.animationUntil) return false;
    resolveCard(g, now, rng);
    return true;
  }
  if (canAutoPay(g)) {
    completePayment(g, now, rng);
    return true;
  }
  if (g.phase === "end") {
    next(g, now);
    return true;
  }
  if (g.phase !== "animation" && now >= g.deadline) {
    const p = active(g);
    if (g.phase === "purchase" || g.phase === "build") stop(g);
    else if (g.phase === "low" || g.phase === "roll")
      performAction(g, p.id, { type: "roll" }, now, rng);
    else if (g.payment) {
      if (p.cash >= g.payment.amount) completePayment(g, now, rng);
      else resolveInsolvency(g, p, now, rng);
    }
    return true;
  }
  return false;
}
export function view(g: Game, id: string) {
  return {
    ...g,
    drawPile: undefined,
    discardPile: undefined,
    drawCount: g.drawPile.length,
    discardCount: g.discardPile.length,
    players: g.players.map((p) => ({
      ...p,
      held: p.id === id ? p.held : [],
      cardCount: p.held.length,
    })),
    lastCard: g.lastCard,
  };
}
export type GameView = ReturnType<typeof view>;
