import { describe, it, expect } from "vitest";
import { createGame, finish, type Game } from "../game-core";
import {
  social,
  DEFAULT_EMOJIS,
  chat,
  result,
  emptyStats,
  addResult,
  totalStats,
  emojis,
} from "../game-social";
const actor = { id: "a", name: "대원" };
describe("공통 채팅 규칙", () => {
  it.each([false, true])(
    "참가자/관전자 간격을 권한 기준으로 검사한다 (%s)",
    (spectator) => {
      const s = social({});
      const gap = spectator ? 5000 : 3000;
      chat(
        s,
        actor,
        spectator,
        { kind: "text", text: "안녕하세요 <script>" },
        10000,
      );
      expect(() =>
        chat(s, actor, spectator, { kind: "quick", quick: 0 }, 10000 + gap - 1),
      ).toThrow("초");
      chat(s, actor, spectator, { kind: "quick", quick: 0 }, 10000 + gap);
      expect(s.chat).toHaveLength(2);
      expect(s.chat[0].spectator).toBe(spectator);
    },
  );
  it.each(["quick", "normal"] as const)(
    "매칭 %s에서는 자유 채팅과 카탈로그 밖 이모티콘을 거부한다",
    (mode) => {
      const s = social({}, mode);
      expect(() =>
        chat(s, actor, false, { kind: "text", text: "금지" }, 10000),
      ).toThrow("퀵채팅");
      expect(() =>
        chat(s, actor, true, { kind: "emoji", emoji: "earth" }, 10000),
      ).toThrow("퀵채팅");
      chat(s, actor, true, { kind: "quick", quick: 1 }, 10000);
      expect(s.chat[0].spectator).toBe(true);
    },
  );
  it("저장된 방에 원본 20종을 추가하고 사이트 이모티콘은 유지한다", () => {
    const room = { social: social({}) };
    room.social.emojis = [
      { id: "earth", label: "지구", text: "🌍" },
      { id: "site", label: "사이트", url: "/site-emojis/hello.png" },
      {
        id: "yangi_01",
        label: "덮어쓰기",
        url: "https://example.com/fake.png",
      },
    ];
    const state = social(room);
    expect(state.emojis).toHaveLength(21);
    expect(state.emojis[0]).toEqual(DEFAULT_EMOJIS[0]);
    expect(state.emojis.at(-1)?.id).toBe("site");
    expect(social(room).emojis).toHaveLength(21);
    expect(new Set(DEFAULT_EMOJIS.map((e) => e.id)).size).toBe(20);
  });
  it.each(["private", "quick", "normal"] as const)(
    "%s 방의 참가자와 관전자가 원본 스티커를 보내며 간격을 지킨다",
    (mode) => {
      for (const spectator of [false, true]) {
        const state = social({}, mode);
        state.emojis = [
          {
            id: "yangi_01",
            label: "가짜",
            url: "https://example.com/fake.png",
          },
          { id: "site", label: "사이트", text: "X" },
        ];
        const gap = spectator ? 5000 : 3000;
        const message = chat(
          state,
          actor,
          spectator,
          { kind: "emoji", emoji: "yangi_01" },
          10000,
        );
        expect(message.emoji).toEqual(DEFAULT_EMOJIS[0]);
        expect(message.spectator).toBe(spectator);
        expect(() =>
          chat(
            state,
            actor,
            spectator,
            { kind: "emoji", emoji: "jion_10" },
            10000 + gap - 1,
          ),
        ).toThrow("초");
        chat(
          state,
          actor,
          spectator,
          { kind: "emoji", emoji: "jion_10" },
          10000 + gap,
        );
        expect(state.chat[1].emoji).toEqual(DEFAULT_EMOJIS[19]);
        if (mode !== "private")
          expect(() =>
            chat(
              state,
              actor,
              spectator,
              { kind: "emoji", emoji: "site" },
              10000 + gap * 2,
            ),
          ).toThrow("퀵채팅");
      }
    },
  );
  it("호스트 카탈로그의 이모티콘만 사용하고 입력 길이와 카탈로그를 검사한다", () => {
    const s = social({});
    s.emojis = emojis([
      { id: "site", label: "사이트", url: "/site-emojis/hello.png" },
    ]);
    expect(() =>
      chat(s, actor, false, { kind: "emoji", emoji: "unknown" }, 0),
    ).toThrow();
    expect(() =>
      chat(s, actor, false, { kind: "text", text: "x".repeat(201) }, 0),
    ).toThrow();
    chat(s, actor, false, { kind: "emoji", emoji: "site" }, 0);
    expect(s.chat[0].emoji?.url).toBe("/site-emojis/hello.png");
    expect(() =>
      emojis([{ id: "x", label: "나쁜 주소", url: "javascript:alert(1)" }]),
    ).toThrow();
  });
  it("특수 사용자 ID도 쿨다운을 우회할 수 없다", () => {
    const s = social({}),
      user = { id: "__proto__", name: "특수" };
    chat(s, user, false, { kind: "quick", quick: 0 }, 10000);
    expect(() =>
      chat(s, user, false, { kind: "quick", quick: 0 }, 10001),
    ).toThrow();
    expect(Object.getPrototypeOf(s.cooldowns)).toBe(Object.prototype);
  });
});
describe("인원별 전적", () => {
  const game = (n: number) =>
    createGame(
      Array.from({ length: n }, (_, i) => ({ id: String(i), name: String(i) })),
      10000,
      () => 0,
    );
  it.each([2, 3, 4])("%i인 최종 순위와 승패를 계산한다", (n) => {
    const g = game(n);
    g.players.forEach((p, i) => (p.cash = 1000 - i * 100));
    finish(g);
    for (let i = 0; i < n; i++) {
      const r = result(g, String(i), "game")!;
      expect(r.rank).toBe(i + 1);
      expect(r.win).toBe(i < (n === 4 ? 2 : 1));
    }
    const s = addResult(emptyStats(), result(g, "0", "game")!);
    expect(totalStats(s)).toEqual({ games: 1, wins: 1, losses: 0 });
  });
  it("AI만 상대하는 싱글과 관전자는 전적에서 제외한다", () => {
    const g = game(2);
    g.players[1].ai = "normal";
    finish(g);
    expect(result(g, "0", "game")).toBeUndefined();
    delete g.players[1].ai;
    expect(result(g, "viewer", "game")).toBeUndefined();
  });
  it("동점은 공동 순위이고 파산자는 생존자 아래에 둔다", () => {
    const g = game(4);
    g.players.forEach((p) => (p.cash = 0));
    g.players[3].bankrupt = true;
    finish(g);
    expect(result(g, "0", "g")).toMatchObject({ rank: 1, win: true });
    expect(result(g, "3", "g")).toMatchObject({ rank: 4, win: false });
  });
});
