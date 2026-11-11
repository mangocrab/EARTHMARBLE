import React, { useState } from "react";
import {
  QUICK_CHATS,
  totalStats,
  emptyStats,
  type Stats,
} from "../game-social";
import type { Room } from "./protocol";
export type ProfileCard = {
  id: string;
  name: string;
  profile?: string;
  url?: string;
  stats: Stats;
  source?: string;
  ai?: boolean;
};
type Command = (data: Record<string, unknown>, done?: () => void) => void;
export function ChatPanel({
  room,
  meId,
  now,
  busy,
  command,
}: {
  room: Room;
  meId: string;
  now: number;
  busy: boolean;
  command: Command;
}) {
  const [text, setText] = useState("");
  const last = (room.chat || []).findLast((m) => m.actor === meId)?.at;
  const seconds = room.isSpectator ? 5 : 3;
  const wait =
    last === undefined
      ? 0
      : Math.max(0, Math.ceil((seconds * 1000 - (now - last)) / 1000));
  const locked = busy || wait > 0;
  return (
    <div className="chat-panel">
      <p>
        {room.mode && room.mode !== "private" ? "퀵채팅 전용" : "자유 채팅"} ·
        참가자 3초 / 관전자 5초 간격
      </p>
      <div
        className="chat-log"
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
                src={m.emoji.url}
                alt={m.emoji.label}
              />
            ) : (
              m.emoji?.text || m.text
            )}
          </p>
        ))}
      </div>
      <p role="status">
        {wait
          ? `${wait}초 뒤 전송할 수 있습니다.`
          : `${seconds}초에 한 번 전송할 수 있습니다.`}
      </p>
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
      {(!room.mode || room.mode === "private") && (
        <>
          <div className="emoji-tray" aria-label="이모티콘">
            {(room.emojis || []).map((e) => (
              <button
                key={e.id}
                aria-label={`${e.label} 이모티콘`}
                disabled={locked}
                onClick={() =>
                  command({ type: "chat", kind: "emoji", emoji: e.id })
                }
              >
                {e.url ? (
                  <img className="chat-emoji" src={e.url} alt={e.label} />
                ) : (
                  e.text
                )}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!locked && text.trim())
                command({ type: "chat", kind: "text", text }, () =>
                  setText(""),
                );
            }}
          >
            <label>
              메시지
              <textarea
                aria-label="채팅 메시지"
                maxLength={200}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
              />
            </label>
            <button className="primary" disabled={locked || !text.trim()}>
              전송
            </button>
          </form>
        </>
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
export function ProfilePanel({ profile }: { profile: ProfileCard }) {
  const [details, setDetails] = useState(false),
    stats = profile.stats || emptyStats(),
    total = totalStats(stats);
  const max = Math.max(...Object.values(stats).map((v) => v.games));
  const rate = (w: number, n: number) =>
    n ? `${((w / n) * 100).toFixed(1)}%` : "0.0%";
  return (
    <div className="profile-card">
      <div className="profile-heading">
        <span className="avatar">
          {profile.profile ? (
            <img src={profile.profile} alt="" />
          ) : (
            profile.name.slice(0, 1)
          )}
        </span>
        <h3>{profile.name}</h3>
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
