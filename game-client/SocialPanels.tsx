import React, { useState, useRef, useLayoutEffect } from "react";
import {
  QUICK_CHATS,
  quickEmoji,
  totalStats,
  emptyStats,
  type Stats,
} from "../game-social";
import { emojiSource } from "./emojis";
import type { Room } from "./protocol";
import type { CommunityProfile } from "../identity-adapter";
export type ProfileCard = CommunityProfile & {
  id: string;
  name: string;
  profile?: string;
  url?: string;
  stats: Stats;
  source?: string;
  ai?: boolean;
};
type Command = (data: Record<string, unknown>, done?: () => void) => void;
export function ChatComposer({
  room,
  meId,
  now,
  busy,
  command,
  draft,
  setDraft,
  inline = false,
}: {
  room: Room;
  meId: string;
  now: number;
  busy: boolean;
  command: Command;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  inline?: boolean;
}) {
  const wait = chatWait(room, meId, now);
  return (
    <form
      className={`chat-composer ${inline ? "inline-composer" : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!busy && !wait && draft.trim()) {
          const sent = draft;
          command({ type: "chat", kind: "text", text: sent }, () =>
            setDraft((current) => (current === sent ? "" : current)),
          );
        }
      }}
    >
      <label
        className="sr-only"
        htmlFor={inline ? "inline-chat" : "dialog-chat"}
      >
        채팅 메시지
      </label>
      <textarea
        id={inline ? "inline-chat" : "dialog-chat"}
        data-chat-input
        aria-label={inline ? "바로 채팅 입력" : "채팅 메시지"}
        rows={1}
        maxLength={200}
        value={draft}
        placeholder={
          wait
            ? `${wait}초 뒤 전송 · 미리 입력할 수 있어요`
            : "메시지를 입력하세요"
        }
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (
            e.key === "Enter" &&
            !e.shiftKey &&
            !e.nativeEvent.isComposing &&
            e.keyCode !== 229
          ) {
            e.preventDefault();
            e.currentTarget.form?.requestSubmit();
          }
        }}
      />
      <button
        className="primary"
        disabled={busy || !!wait || !draft.trim()}
        aria-label={inline ? "바로 채팅 전송" : "전송"}
      >
        {wait ? `${wait}초` : "전송"}
      </button>
    </form>
  );
}
export function chatWait(room: Room, meId: string, now: number) {
  const last = (room.chat || []).findLast((m) => m.actor === meId)?.at;
  return last === undefined
    ? 0
    : Math.max(
        0,
        Math.ceil(((room.isSpectator ? 5000 : 3000) - (now - last)) / 1000),
      );
}
export function ChatPanel({
  room,
  meId,
  now,
  busy,
  command,
  draft,
  setDraft,
  view = "chat",
  open,
}: {
  room: Room;
  meId: string;
  now: number;
  busy: boolean;
  command: Command;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  view?: string;
  open: (panel: string) => void;
}) {
  const [character, setCharacter] = useState("yangi");
  const history = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useLayoutEffect(() => {
    following.current = true;
  }, [view]);
  useLayoutEffect(() => {
    if (following.current && history.current)
      history.current.scrollTop = history.current.scrollHeight;
  }, [room.chat?.at(-1)?.id, view]);
  const privateRoom = !room.mode || room.mode === "private";
  const choices = (room.emojis || []).filter((e) =>
    character === "site"
      ? !quickEmoji(e.id)
      : e.id.startsWith(`${character}_`) && !!quickEmoji(e.id),
  );
  const wait = chatWait(room, meId, now),
    locked = busy || wait > 0;
  return (
    <div className={`chat-panel chat-view-${view}`}>
      <nav className="chat-tools" aria-label="채팅 메뉴">
        <button aria-pressed={view === "chat"} onClick={() => open("chat")}>
          채팅 내역
        </button>
        <button
          aria-pressed={view === "quick-chat"}
          onClick={() => open("quick-chat")}
        >
          퀵채팅
        </button>
        <button aria-pressed={view === "emojis"} onClick={() => open("emojis")}>
          이모티콘
        </button>
      </nav>
      {view === "chat" && (
        <div
          className="chat-log"
          ref={history}
          onScroll={(e) => {
            const el = e.currentTarget;
            following.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          }}
          role="log"
          aria-label="방 채팅"
          aria-live="polite"
        >
          {!(room.chat || []).length && <p>아직 채팅이 없습니다.</p>}
          {(room.chat || []).map((m) => (
            <p
              key={m.id}
              className={
                m.spectator ? "chat-message spectator-message" : "chat-message"
              }
            >
              {m.spectator && <span className="spectator-badge">관전</span>}{" "}
              <b>{m.name}</b>{" "}
              <time>
                {new Date(m.at).toLocaleTimeString("ko-KR", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
              <br />
              {m.emoji?.url ? (
                <img
                  className="chat-emoji"
                  src={emojiSource(m.emoji)}
                  alt={m.emoji.label}
                />
              ) : (
                m.emoji?.text || m.text
              )}
            </p>
          ))}
        </div>
      )}
      <p className="chat-rate" role="status">
        {wait
          ? `${wait}초 뒤 전송할 수 있습니다.`
          : `참가자 3초 · 관전자 5초 간격${privateRoom ? "" : " · 매칭은 퀵채팅과 이모티콘 전용"}`}
      </p>
      {view === "quick-chat" && (
        <div className="quick-chat" aria-label="퀵채팅">
          {QUICK_CHATS.map((label, quick) => (
            <button
              key={quick}
              disabled={locked}
              onClick={() => command({ type: "chat", kind: "quick", quick })}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {view === "emojis" && (
        <div className="sticker-picker">
          <div
            className="sticker-tabs"
            role="group"
            aria-label="이모티콘 캐릭터"
          >
            {[
              ["yangi", "양이"],
              ["jion", "지온"],
              ...(room.emojis?.some((e) => !quickEmoji(e.id))
                ? [["site", "커뮤니티"]]
                : []),
            ].map(([id, label]) => (
              <button
                key={id}
                aria-pressed={character === id}
                onClick={() => setCharacter(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="emoji-tray" aria-label="이모티콘">
            {choices.map((e) => (
              <button
                key={e.id}
                aria-label={`${e.label} 이모티콘`}
                disabled={locked}
                onClick={() =>
                  command({ type: "chat", kind: "emoji", emoji: e.id })
                }
              >
                {e.url ? (
                  <img
                    className="chat-emoji"
                    src={emojiSource(e)}
                    alt={e.label}
                  />
                ) : (
                  e.text
                )}
                <span>{e.label}</span>
              </button>
            ))}
            {!choices.length && <p>사용 가능한 이모티콘이 없습니다.</p>}
          </div>
        </div>
      )}
      {view === "chat" && privateRoom && (
        <ChatComposer
          room={room}
          meId={meId}
          now={now}
          busy={busy}
          command={command}
          draft={draft}
          setDraft={setDraft}
        />
      )}
    </div>
  );
}
export function ObserversPanel({
  room,
  meId,
  busy,
  command,
}: {
  room: Room;
  meId: string;
  busy: boolean;
  command: Command;
}) {
  return (
    <div className="observer-list">
      <p>관전자 {(room.spectators || []).length}명</p>
      {!(room.spectators || []).length && <p>현재 관전자가 없습니다.</p>}
      {(room.spectators || []).map((p) => (
        <article key={p.id}>
          <span className="spectator-badge">관전</span> <b>{p.name}</b>
          {(!room.mode || room.mode === "private") && room.host === meId && (
            <button
              disabled={busy}
              aria-label={`${p.name} 관전 강퇴`}
              onClick={() => command({ type: "kick-spectator", member: p.id })}
            >
              내보내기
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
export function CommunityAvatar({
  name,
  profile,
  frame,
}: CommunityProfile & { name: string }) {
  return (
    <span className="community-portrait">
      {profile ? (
        <img className="avatar-photo" src={profile} alt="" />
      ) : (
        name.slice(0, 1)
      )}
      {frame && (
        <img
          className="community-frame"
          src={frame}
          alt=""
          aria-hidden="true"
        />
      )}
    </span>
  );
}
export function ProfilePanel({ profile }: { profile: ProfileCard }) {
  const [details, setDetails] = useState(false),
    stats = profile.stats || emptyStats(),
    total = totalStats(stats);
  const max = Math.max(...Object.values(stats).map((v) => v.games));
  const rate = (w: number, n: number) =>
    n ? `${((w / n) * 100).toFixed(1)}%` : "0.0%";
  return (
    <div className="profile-card">
      {profile.banner && (
        <img
          className="community-banner"
          src={profile.banner}
          alt={`${profile.name} 프로필 배너`}
        />
      )}
      <div className="profile-heading">
        <span className="avatar">
          <CommunityAvatar {...profile} />
        </span>
        <div>
          <h3>{profile.name}</h3>
          {profile.title && (
            <span className="community-title">{profile.title}</span>
          )}
        </div>
      </div>
      {profile.url ? (
        <a href={profile.url} target="_blank" rel="noreferrer">
          사이트 프로필 보기 ↗
        </a>
      ) : (
        <p className="fine">사이트 프로필 연동 준비 중 · 임시 프로필</p>
      )}
      <p className="fine">
        {profile.ai
          ? "AI 대원은 전적을 기록하지 않습니다."
          : profile.source === "server"
            ? "서버 저장 전적"
            : "기기 저장 전적 · 계정 연동 전 임시 기록"}
      </p>
      <div className="profile-total">
        <b>전체 {total.games}판</b>
        <p>
          {total.wins}승 · {total.losses}패 · 승률{" "}
          {rate(total.wins, total.games)}
        </p>
      </div>
      <h4>가장 많이 플레이한 게임</h4>
      {!max ? (
        <p>기록된 게임이 없습니다.</p>
      ) : (
        [2, 3, 4]
          .filter((n) => stats[n as 2 | 3 | 4].games === max)
          .map((n) => {
            const v = stats[n as 2 | 3 | 4];
            return (
              <p key={n}>
                {n}인전 · {v.games}판 ({v.wins}승 {v.losses}패)
              </p>
            );
          })
      )}
      <button onClick={() => setDetails((v) => !v)}>
        {details ? "상세 접기" : "상세보기"}
      </button>
      {details && (
        <table className="records-table">
          <thead>
            <tr>
              <th>구분</th>
              <th>판수</th>
              <th>승</th>
              <th>패</th>
              <th>승률</th>
            </tr>
          </thead>
          <tbody>
            {[2, 3, 4, "전체"].map((key) => {
              const v = key === "전체" ? total : stats[key as 2 | 3 | 4];
              return (
                <tr key={key}>
                  <th>
                    {key}
                    {key === "전체" ? "" : "인"}
                  </th>
                  <td>{v.games}</td>
                  <td>{v.wins}</td>
                  <td>{v.losses}</td>
                  <td>{rate(v.wins, v.games)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="fine">
        사람 2명 이상인 게임만 기록 · 2/3인전 1위, 4인전 1·2위 승리 · 동점은
        공동 순위
      </p>
    </div>
  );
}
