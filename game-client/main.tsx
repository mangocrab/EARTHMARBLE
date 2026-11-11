import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { io, type Socket } from "socket.io-client";
import {
  BOARD,
  CARDS,
  BUILDINGS,
  ZONES,
  remainingMs,
  nextSaleBuilding,
  movementInterval,
  type GameView,
  type Player,
  type Action,
} from "../game-core";
import "./style.css";
import { getVolume, setVolume, unlockAudio, playSound } from "./audio";
import { PropertyArt, CardArt } from "./Art";
const Dice = React.lazy(() =>
  import("./Dice").then((m) => ({ default: m.Dice })),
);
import {
  ChatPanel,
  ObserversPanel,
  ProfilePanel,
  type ProfileCard,
} from "./SocialPanels";
import { localStats, saveLocalResult } from "./stats";
import {
  emptyStats,
  validStats,
  standing,
  type MatchMode,
  type Stats,
} from "../game-social";
import type { State, RoomListing } from "./protocol";
import type { RoomDirectory, DirectoryStatus } from "./room-directory";
import type { SoloController } from "./solo";
import type { PeerRoomController } from "./peer-room";
const SOLO =
  import.meta.env.MODE === "solo" || import.meta.env.MODE === "pages";
const money = (n: number) => n.toLocaleString("ko-KR");
const colors = ["#d85d4c", "#4884c1", "#4a9b6e", "#d1a328"];
const symbols = ["◎", "◈", "▲", "≈", "◌", "✦", "⌁", "☁", "☽"];
function Globe() {
  return (
    <svg viewBox="0 0 440 440" className="globe" aria-hidden="true">
      <defs>
        <radialGradient id="sea" cx="35%" cy="28%">
          <stop stopColor="#347a78" />
          <stop offset="1" stopColor="#102f36" />
        </radialGradient>
        <clipPath id="sphere">
          <circle cx="220" cy="220" r="153" />
        </clipPath>
      </defs>
      <g fill="none" stroke="currentColor" opacity=".22">
        <circle cx="220" cy="220" r="193" />
        <ellipse
          cx="220"
          cy="220"
          rx="218"
          ry="72"
          transform="rotate(-25 220 220)"
        />
        <path d="M20 220h400M220 20v400" strokeDasharray="3 8" />
      </g>
      <circle cx="220" cy="220" r="153" fill="url(#sea)" />
      <g clipPath="url(#sphere)" fill="#94bba1">
        <path d="m124 74 44 8 13 37 35 7 16 35-20 26-40-4-4 19 21 16-8 30-28 5-16-38-38-15-9-32-21-18zM199 234l37 15 16 39-26 62-19 27-10-47-20-44zM269 75l80 10 51 83-36 20-16 47-24-8-27-54-24-3-8 29-30-26 17-35-16-22zM297 287l41-9 32 32-23 21-43-10z" />
      </g>
      <g clipPath="url(#sphere)" fill="none" stroke="#e8efdb" opacity=".17">
        <ellipse cx="220" cy="220" rx="75" ry="153" />
        <ellipse cx="220" cy="220" rx="130" ry="153" />
        <ellipse cx="220" cy="220" rx="153" ry="60" />
        <ellipse cx="220" cy="220" rx="153" ry="118" />
      </g>
      <circle cx="395" cy="141" r="5" fill="#dcb776" />
      <circle cx="76" cy="345" r="3" fill="currentColor" />
    </svg>
  );
}
function readSetting(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeSetting(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Keep this session usable. */
  }
}
function App() {
  const [me, setMe] = useState<{ id: string; name: string } | null>(null),
    [loading, setLoading] = useState(true),
    [state, setState] = useState<State>({
      room: null,
      matching: false,
      count: 0,
      matchAt: 0,
    }),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false),
    [panel, setPanel] = useState(""),
    [selected, setSelected] = useState<number | null>(null),
    [back, setBack] = useState(false),
    [now, setNow] = useState(Date.now()),
    [reduced, setReduced] = useState(
      () =>
        readSetting("earth-reduced") === "true" ||
        matchMedia("(prefers-reduced-motion: reduce)").matches,
    ),
    [busy, setBusy] = useState(false);
  const [compact, setCompact] = useState(
    () => matchMedia("(max-width:1190px)").matches,
  );
  const [overview, setOverview] = useState(true);
  const [paymentOpen, setPaymentOpen] = useState(true);
  const [volume, updateVolume] = useState(getVolume);
  const [serverURL, setServerURL] = useState(
    () =>
      readSetting("earth-server-url") ??
      import.meta.env.VITE_GAME_SERVER_URL ??
      "",
  );
  const onlineEntry = useRef(false);
  const [onlineIntent, setOnlineIntent] = useState("match");
  const lastSoundGame = useRef<GameView | null>(null);
  useEffect(() => {
    const unlock = () => unlockAudio();
    document.addEventListener("pointerdown", unlock);
    document.addEventListener("keydown", unlock);
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, []);
  const [mapStage, setMapStage] = useState<HTMLDivElement | null>(null);
  const [boardPixels, setBoardPixels] = useState(320);
  const solo = useRef<SoloController | null>(null);
  const peerRoom = useRef<PeerRoomController | null>(null);
  const browserDirectory = useRef<RoomDirectory | null>(null);
  const [roomList, setRoomList] = useState<RoomListing[]>([]);
  const [directoryStatus, setDirectoryStatus] =
    useState<DirectoryStatus>("connecting");
  const [listRefresh, setListRefresh] = useState(0);
  const [joinRoom, setJoinRoom] = useState<RoomListing | null>(null);
  const [profile, setProfile] = useState<ProfileCard | null>(null);
  const [myStats, setMyStats] = useState<Stats>(emptyStats);
  const recordedGames = useRef(new Set<string>());
  const [declinedSlow, setDeclinedSlow] = useState(false);
  const [actionDock, setActionDock] = useState<HTMLDivElement | null>(null);
  const [identityMode, setIdentityMode] = useState("standalone");
  const socket = useRef<Socket | null>(null);
  const clockOffset = useRef(0);
  useEffect(() => {
    const media = matchMedia("(max-width:1190px)");
    const resize = () => setCompact(media.matches);
    media.addEventListener("change", resize);
    let disposed = false,
      unsubscribe: (() => void) | undefined;
    if (SOLO) {
      void import("./solo")
        .then(({ SoloController }) => {
          if (disposed) return;
          const controller = new SoloController(
            {
              getItem: (k) => localStorage.getItem(k),
              setItem: (k, v) => localStorage.setItem(k, v),
              removeItem: (k) => localStorage.removeItem(k),
            },
            Date.now,
            undefined,
            setError,
          );
          solo.current = controller;
          setMe(controller.identity);
          setConnected(true);
          setLoading(false);
          setIdentityMode("solo");
          unsubscribe = controller.subscribe((value) => {
            if (!peerRoom.current) setState(value);
          });
          if (document.hidden) controller.pause();
        })
        .catch(() => {
          setError("게임을 불러오지 못했습니다. 페이지를 새로고침하세요.");
          setLoading(false);
        });
    } else void bootstrapIdentity();
    const play = setInterval(() => {
      try {
        solo.current?.step();
      } catch (e) {
        setError((e as Error).message);
      }
    }, 40);
    const visibility = () => {
      if (document.hidden) solo.current?.pause();
      else solo.current?.resume();
    };
    const save = () => solo.current?.save();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", save);
    const i = setInterval(() => setNow(Date.now() + clockOffset.current), 200);
    return () => {
      disposed = true;
      peerRoom.current?.close();
      unsubscribe?.();
      solo.current?.dispose();
      solo.current = null;
      clearInterval(play);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", save);
      clearInterval(i);
      media.removeEventListener("change", resize);
    };
  }, []);
  useEffect(() => {
    if (!me || SOLO) return;
    const s = io();
    socket.current = s;
    s.on("connect", () => setConnected(true));
    s.on("disconnect", () => setConnected(false));
    s.on("connect_error", (e) => setError(e.message));
    s.on("room-list", (rooms: RoomListing[]) => {
      setRoomList(rooms);
      setDirectoryStatus("ready");
    });
    s.on("kicked", (message: string) => {
      setPanel("");
      setSelected(null);
      setPaymentOpen(false);
      setError(message);
    });
    s.on("state", (snapshot: State & { serverNow: number }) => {
      clockOffset.current = snapshot.serverNow - Date.now();
      setNow(snapshot.serverNow);
      setState(snapshot);
    });
    return () => {
      s.disconnect();
    };
  }, [me?.id]);
  useEffect(() => {
    if (
      !panel &&
      selected === null &&
      state.room?.game?.phase !== "reveal" &&
      state.room?.game?.phase !== "finished" &&
      !paymentOpen
    )
      return;
    const before = document.activeElement as HTMLElement;
    const modal =
      document.querySelector<HTMLElement>(
        '.card-reveal-overlay [role="dialog"]',
      ) ?? document.querySelector<HTMLElement>('[role="dialog"]');
    if (!modal) return;
    const first = () =>
      modal?.querySelector<HTMLElement>("button:not([disabled]),input,select");
    (first() ?? modal)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPanel("");
        setSelected(null);
        setPaymentOpen(false);
      }
      if (e.key === "Tab" && modal) {
        const nodes = [
          ...modal.querySelectorAll<HTMLElement>(
            'button:not([disabled]),input,select,[tabindex="0"]',
          ),
        ].filter((n) => !n.closest("[inert]"));
        const a = nodes[0],
          b = nodes.at(-1);
        if (!nodes.length) {
          e.preventDefault();
          modal.focus();
        } else if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b?.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      before?.focus();
    };
  }, [panel, selected, back, state.room?.game?.phase, paymentOpen]);
  const room = state.room,
    g = room?.game,
    isSpectator = !!room?.isSpectator,
    viewId = isSpectator ? room?.watching || g?.players[0]?.id : me?.id,
    p = g?.players.find((p) => p.id === viewId),
    turn = g?.players[g.turn],
    myTurn = !isSpectator && turn?.id === me?.id;
  useEffect(() => {
    const before = lastSoundGame.current;
    lastSoundGame.current = g ? structuredClone(g) : null;
    if (!g) return;
    if (!before) {
      if (myTurn) playSound("turn");
      return;
    }
    if (g.version === before.version) return;
    const last = g.log.at(-1) ?? "";
    if (
      g.phase === "animation" &&
      (before.phase !== "animation" ||
        g.animationUntil !== before.animationUntil)
    )
      playSound("roll");
    if (g.players.some((q, i) => q.position !== before.players[i]?.position))
      playSound("step");
    if (g.phase === "finished" && before.phase !== "finished")
      playSound("finish");
    else if (
      g.phase === "reveal" &&
      (before.phase !== "reveal" || g.pendingCard !== before.pendingCard)
    )
      playSound("card");
    else if (last !== before.log.at(-1) && last.includes(" 건설 ("))
      playSound("build");
    else if (last !== before.log.at(-1) && last.includes(" 구매 ("))
      playSound("buy");
    else if (
      p &&
      p.cash !== (before.players.find((q) => q.id === p.id)?.cash ?? p.cash)
    )
      playSound(
        p.cash > (before.players.find((q) => q.id === p.id)?.cash ?? p.cash)
          ? "gain"
          : "spend",
      );
    else if (myTurn && g.turn !== before.turn) playSound("turn");
  }, [g, myTurn, p]);
  useEffect(() => {
    if (panel !== "join" || !me) return;
    setJoinRoom(null);
    setRoomList([]);
    setDirectoryStatus(connected ? "connecting" : "offline");
    if (!connected) return;
    let stopped = false,
      directory: RoomDirectory | undefined;
    if (SOLO) {
      void import("./room-directory")
        .then(({ RoomDirectory }) => {
          if (stopped) return;
          directory = new RoomDirectory((rooms, status) => {
            if (!stopped) {
              setRoomList(rooms);
              setDirectoryStatus(status);
            }
          });
          browserDirectory.current = directory;
        })
        .catch(() => {
          if (!stopped) setDirectoryStatus("offline");
        });
    } else
      socket.current
        ?.timeout(8000)
        .emit(
          "room-list",
          (
            timeout: Error | null,
            result: { ok: boolean; rooms?: RoomListing[]; error?: string },
          ) => {
            if (stopped) return;
            if (timeout || !result?.ok) {
              setDirectoryStatus("offline");
              return;
            }
            setRoomList(result.rooms!);
            setDirectoryStatus("ready");
          },
        );
    return () => {
      stopped = true;
      directory?.close();
      if (browserDirectory.current === directory)
        browserDirectory.current = null;
    };
  }, [panel, connected, me?.id, listRefresh]);
  function refreshRooms() {
    if (SOLO && browserDirectory.current) browserDirectory.current.refresh();
    else setListRefresh((n) => n + 1);
  }
  function chooseRoom(selectedRoom: RoomListing) {
    if (
      busy ||
      (!selectedRoom.playing && selectedRoom.count >= selectedRoom.max)
    )
      return;
    if (selectedRoom.locked) setJoinRoom(selectedRoom);
    else
      command(
        {
          type: "join",
          code: selectedRoom.code,
          password: "",
          spectate: !!selectedRoom.playing,
        },
        () => setPanel(""),
      );
  }
  useEffect(() => {
    if (me) setMyStats(SOLO ? localStats(me.id) : emptyStats());
  }, [me?.id]);
  useEffect(() => {
    if (
      !me ||
      !room?.result ||
      room.isSpectator ||
      recordedGames.current.has(room.result.gameId)
    )
      return;
    recordedGames.current.add(room.result.gameId);
    if (SOLO) setMyStats(saveLocalResult(me.id, room.result));
  }, [room?.result?.gameId, me?.id]);
  useEffect(() => {
    if (!state.matching) setDeclinedSlow(false);
  }, [state.matching]);
  async function openProfile(id: string) {
    const member = room?.members.find((m) => m.id === id),
      player = g?.players.find((p) => p.id === id);
    const base: ProfileCard = {
      id,
      name: member?.name || player?.name || me?.name || "탐사대원",
      profile: member?.profile,
      stats: validStats(member?.stats)
        ? member.stats
        : id === me?.id
          ? myStats
          : emptyStats(),
      source: SOLO ? "local" : "server",
      ai: !!member?.ai,
    };
    setProfile(base);
    setPanel("profile");
    if (!SOLO && !base.ai) {
      try {
        const response = await fetch(`/api/profile/${encodeURIComponent(id)}`);
        if (response.ok) {
          const card = await response.json();
          if (validStats(card.stats))
            setProfile((current) => (current?.id === id ? card : current));
        }
      } catch {}
    }
  }
  function chooseMatch(mode: MatchMode) {
    setDeclinedSlow(false);
    command({ type: SOLO ? "peer-match" : "match", mode }, () => setPanel(""));
  }
  const [drawOrigin, setDrawOrigin] = useState<React.CSSProperties>({});
  useLayoutEffect(() => {
    if (g?.phase !== "reveal") return;
    const deck = document.querySelector(".deck-back")?.getBoundingClientRect();
    const board = document
      .querySelector(".board-scroll")
      ?.getBoundingClientRect();
    const source = deck && deck.width > 0 ? deck : board;
    const x = source ? source.left + source.width * 0.5 : innerWidth * 0.5;
    const y = source ? source.top + source.height * 0.5 : innerHeight * 0.65;
    const deckWidth = deck?.width || 32,
      deckHeight = deck?.height || 43;
    const aspect = deckWidth / deckHeight;
    const revealWidth = Math.min(
      390,
      innerWidth * 0.9,
      (innerHeight - 50) * aspect,
    );
    setDrawOrigin({
      "--draw-x": `${x - innerWidth / 2}px`,
      "--draw-y": `${y - innerHeight / 2}px`,
      "--draw-scale": `${deckWidth / revealWidth}`,
      "--deck-width": `${deckWidth}px`,
      "--reveal-width": `${revealWidth}px`,
      "--reveal-height": `${revealWidth / aspect}px`,
      "--deck-height": `${deckHeight}px`,
    } as React.CSSProperties);
  }, [g?.phase, g?.deckVersion]);
  const paymentDecision = !!(
    myTurn &&
    g?.payment &&
    ["toll", "debt"].includes(g.phase)
  );
  useEffect(() => {
    if (paymentDecision) setPaymentOpen(true);
  }, [paymentDecision, g?.payment?.amount, g?.payment?.to, p?.position]);
  type SaleGhost = {
    key: string;
    tile: number;
    owner: string;
    building?: number;
  };
  const [saleGhosts, setSaleGhosts] = useState<SaleGhost[]>([]);
  const previousEstates = useRef<{
    room: string;
    estates: NonNullable<typeof g>["estates"];
  } | null>(null);
  useEffect(() => {
    if (!g || !room) {
      previousEstates.current = null;
      return;
    }
    const prev = previousEstates.current;
    previousEstates.current = {
      room: room.id,
      estates: structuredClone(g.estates),
    };
    if (!prev || prev.room !== room.id) {
      setSaleGhosts([]);
      return;
    }
    const removed: SaleGhost[] = [];
    for (const [id, old] of Object.entries(prev.estates)) {
      const next = g.estates[+id],
        transferred = next?.owner !== old.owner;
      if (transferred)
        removed.push({
          key: `${id}-owner-${performance.now()}`,
          tile: +id,
          owner: old.owner,
        });
      old.buildings.forEach((built, i) => {
        if (built && (transferred || !next?.buildings[i]))
          removed.push({
            key: `${id}-${i}-${performance.now()}`,
            tile: +id,
            owner: old.owner,
            building: i,
          });
      });
    }
    if (removed.length) setSaleGhosts((old) => [...old, ...removed]);
  }, [g, room?.id]);
  useEffect(() => {
    if (!saleGhosts.length) return;
    const timer = setTimeout(() => setSaleGhosts([]), 1600);
    return () => clearTimeout(timer);
  }, [saleGhosts]);
  const decision = !!(myTurn && g && ["purchase", "build"].includes(g.phase));
  const lastDecision = useRef(false);
  const previousCash = useRef<Record<string, number>>({});
  const [cashChanges, setCashChanges] = useState<
    { id: string; amount: number; at: number }[]
  >([]);
  useEffect(() => {
    if (!g) return;
    const changes = g.players.flatMap((q) => {
      const before = previousCash.current[q.id];
      return before !== undefined && before !== q.cash
        ? [{ id: q.id, amount: q.cash - before, at: Date.now() }]
        : [];
    });
    previousCash.current = Object.fromEntries(
      g.players.map((q) => [q.id, q.cash]),
    );
    if (changes.length)
      setCashChanges((old) => [
        ...old.filter((c) => Date.now() - c.at < 2400),
        ...changes,
      ]);
  }, [g]);
  useEffect(() => {
    if (decision && g && p) {
      setSelected(p.position);
      setBack(false);
    } else if (lastDecision.current || g?.phase === "reveal") setSelected(null);
    lastDecision.current = decision;
  }, [decision, g?.phase, p?.position]);
  const motionText =
    g?.phase === "moving" && g.motion
      ? `${turn?.name} · ${g.motion.label} ${g.motion.done}/${g.motion.total}칸`
      : g?.phase === "reveal"
        ? `${turn?.name} · 카드 공개 중 · 잠시 후 효과 적용`
        : g?.phase === "animation"
          ? `${turn?.name} · 주사위 ${g.dice.join(" + ")} = ${g.pendingSteps}칸`
          : `${turn?.name ?? ""} · ${g?.phase === "purchase" ? "땅 구매 선택" : g?.phase === "build" ? "시설 건설 선택" : g?.phase === "low" ? "맵에서 간조 목적지를 누르세요" : g?.phase === "roll" ? "주사위를 굴리세요" : g?.phase === "toll" ? "통행료 정산" : g?.phase === "debt" ? "비용 정산" : g?.phase === "end" ? "도착 처리 완료" : "탐사 진행"}`;
  async function login(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: new FormData(e.currentTarget).get("name") };
      if (SOLO) {
        if (!solo.current) throw new Error("탐사 준비 중입니다.");
        setMe(solo.current.login(body.name));
        setError("");
        return;
      }
      const r = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const value = await r.json();
      if (!r.ok) throw new Error(value.error);
      setMe(value);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function bootstrapIdentity() {
    setLoading(true);
    try {
      const [configResponse, meResponse] = await Promise.all([
        fetch("/api/config"),
        fetch("/api/me"),
      ]);
      if (!configResponse.ok)
        throw new Error("환경 정보를 확인하지 못했습니다.");
      const config = await configResponse.json();
      setIdentityMode(config.identityMode);
      if (meResponse.ok) {
        setMe(await meResponse.json());
        setError("");
        return;
      }
      if (meResponse.status !== 401)
        throw new Error("접속 정보를 확인하지 못했습니다.");
      if (config.identityMode === "external") {
        const response = await fetch("/api/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        const identity = await response.json();
        if (!response.ok)
          throw new Error(identity.error || "사이트에 먼저 로그인하세요.");
        setMe(identity);
        setError("");
      }
    } catch (e) {
      setError(
        (e as Error).message === "Failed to fetch"
          ? "서버에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도하세요."
          : (e as Error).message,
      );
    } finally {
      setLoading(false);
    }
  }
  function openOnline(intent: string) {
    setOnlineIntent(intent);
    if (!serverURL.trim()) {
      if (intent === "match") setPanel("match-select");
      else setPanel(intent);
      return;
    }
    try {
      const target = new URL(serverURL);
      if (
        !["https:", "http:"].includes(target.protocol) ||
        target.username ||
        target.password
      )
        throw new Error();
      if (
        target.origin === location.origin &&
        target.pathname.replace(/\/+$/, "") ===
          import.meta.env.BASE_URL.replace(/\/+$/, "")
      )
        throw new Error();
      target.searchParams.set("entry", intent);
      location.assign(target.href);
    } catch {
      setError("접속할 게임 서버의 올바른 http(s) 주소를 설정하세요.");
      setPanel("online");
    }
  }
  useEffect(() => {
    if (SOLO || !connected || !me || room || onlineEntry.current) return;
    const intent = new URL(location.href).searchParams.get("entry");
    if (!["match", "create", "join"].includes(intent ?? "")) return;
    onlineEntry.current = true;
    if (intent === "match") setPanel("match-select");
    else setPanel(intent!);
  }, [connected, me, room]);
  async function getPeerRoom() {
    if (peerRoom.current) return peerRoom.current;
    if (!me) throw new Error("닉네임을 등록하세요.");
    const { PeerRoomController } = await import("./peer-room");
    const controller = new PeerRoomController(me, (message) => {
      peerRoom.current = null;
      setPanel("");
      setSelected(null);
      setPaymentOpen(false);
      setState(solo.current!.snapshot());
      if (message) setError(message);
    });
    peerRoom.current = controller;
    controller.subscribe((snapshot) => {
      clockOffset.current = snapshot.serverNow - Date.now();
      setState(snapshot);
    });
    return controller;
  }
  function command(data: Record<string, unknown>, done?: () => void) {
    if (!connected || (busy && data.type !== "cancel")) return;
    setBusy(true);
    const envelope = {
      requestId: crypto.randomUUID(),
      version: room?.version ?? 0,
      ...data,
    };
    if (SOLO) {
      void (async () => {
        let operationPeer: PeerRoomController | undefined;
        let stale = false;
        try {
          if (
            peerRoom.current &&
            data.type === "start" &&
            room?.members.every((m) => m.id === me?.id || !!m.ai)
          ) {
            if (
              room.host !== me?.id ||
              room.members.length < 2 ||
              !room.members.every((m) => m.ready)
            )
              throw new Error("두 명 이상 참가하고 모두 준비해야 합니다.");
            const levels = room.members.filter((m) => m.ai).map((m) => m.ai!);
            peerRoom.current.close();
            peerRoom.current = null;
            const local = solo.current!;
            const send = (d: Record<string, unknown>) =>
              local.command({
                requestId: crypto.randomUUID(),
                version: local.snapshot().room?.version ?? 0,
                ...d,
              });
            send({
              type: "create",
              max: room.max,
              minutes: room.minutes,
              allowAI: room.allowAI,
            });
            levels.forEach((difficulty) => send({ type: "ai", difficulty }));
            send({ type: "ready", ready: true });
            send({ type: "start" });
          } else if (
            data.type === "peer-create" ||
            data.type === "peer-match" ||
            data.type === "join"
          ) {
            if (data.type === "peer-match" && peerRoom.current) {
              peerRoom.current.close();
              peerRoom.current = null;
            }
            const online = await getPeerRoom();
            operationPeer = online;
            if (data.type === "peer-create") await online.create(envelope);
            else if (data.type === "peer-match")
              await online.match(data.mode as MatchMode);
            else await online.join(data.code, data.password, !!data.spectate);
          } else if (peerRoom.current) await peerRoom.current.command(envelope);
          else solo.current!.command(envelope);
          if (operationPeer && peerRoom.current !== operationPeer) {
            stale = true;
            return;
          }
          setError("");
          done?.();
        } catch (e) {
          if (operationPeer && peerRoom.current !== operationPeer) {
            stale = true;
            return;
          }
          if (
            ["peer-create", "peer-match", "join"].includes(String(data.type))
          ) {
            peerRoom.current?.close();
            peerRoom.current = null;
            setState(solo.current!.snapshot());
          }
          setError((e as Error).message);
        } finally {
          if (!stale) setBusy(false);
        }
      })();
      return;
    }
    const deliver = (retry: boolean) =>
      socket.current
        ?.timeout(8000)
        .emit(
          "command",
          envelope,
          (timeout: Error | null, r: { ok: boolean; error?: string }) => {
            if (timeout && retry) {
              deliver(false);
              return;
            }
            setBusy(false);
            if (timeout)
              setError(
                "응답을 확인하지 못했습니다. 재접속 후 상태를 확인하세요.",
              );
            else if (!r.ok) setError(r.error || "요청 실패");
            else {
              setError("");
              done?.();
            }
          },
        );
    deliver(true);
  }

  function action(a: Action) {
    if (isSpectator) return;
    if (g)
      command({
        type: "action",
        requestId: crypto.randomUUID(),
        version: g.version,
        action: a,
      });
  }
  function openTile(id: number) {
    if (g?.phase === "low" && myTurn && id !== 30 && !busy && !state.paused) {
      action({ type: "travel", destination: id });
      return;
    }
    setSelected(id);
    setBack(false);
  }
  const rent = (id: number) => {
    const t = BOARD[id],
      e = g?.estates[id];
    return (
      t.rents?.reduce(
        (s, n, i) => s + (i === 0 || e?.buildings[i - 1] ? n : 0),
        0,
      ) || 0
    );
  };
  const total = (q: Player) =>
    q.cash +
    Object.entries(g?.estates || {}).reduce(
      (s, [id, e]) =>
        s +
        (e.owner === q.id
          ? BOARD[+id].price! +
            e.buildings.reduce(
              (a, b, i) => a + (b ? BOARD[+id].costs![i] : 0),
              0,
            )
          : 0),
      0,
    );
  const btn = (text: string, a: Action, disabled = false) => (
    <button
      disabled={!myTurn || busy || !connected || !!state.paused || disabled}
      onClick={() => action(a)}
    >
      {text}
    </button>
  );
  const gameNow = state.paused ? (state.clockNow ?? now) : now;
  const remaining = g ? Math.ceil(remainingMs(g, gameNow) / 1000) : 0;
  useEffect(() => {
    document.documentElement.classList.toggle("game-active", !!g);
    document.documentElement.classList.toggle("solo-mode", SOLO);
    return () => document.documentElement.classList.remove("game-active");
  }, [!!g]);
  useEffect(() => {
    if (compact) setOverview(true);
  }, [compact]);
  useEffect(() => {
    if (!mapStage) return;
    const measure = () =>
      setBoardPixels(
        Math.max(
          100,
          Math.floor(Math.min(mapStage.clientWidth, mapStage.clientHeight)),
        ),
      );
    const observer = new ResizeObserver(measure);
    observer.observe(mapStage);
    measure();
    return () => observer.disconnect();
  }, [mapStage, compact]);
  useEffect(() => {
    if (!g || !p || !compact || overview) return;
    const focus = () => {
      const map = document.querySelector<HTMLElement>(".board-scroll");
      const tile = map?.querySelector<HTMLElement>(
        `[data-tile="${p.position}"]`,
      );
      if (map && tile) {
        const m = map.getBoundingClientRect(),
          t = tile.getBoundingClientRect();
        map.scrollLeft += t.left - m.left - (map.clientWidth - t.width) / 2;
        map.scrollTop += t.top - m.top - (map.clientHeight - t.height) / 2;
      }
    };
    focus();
    const resize = () => {
      focus();
      if (innerHeight < 500)
        document
          .querySelector(".board-section")
          ?.scrollIntoView({ block: "start" });
    };
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [room?.id, !!g, compact, overview, p?.position]);
  useEffect(() => {
    if (g && compact)
      document
        .querySelector(".board-section")
        ?.scrollIntoView({ block: "start" });
  }, [room?.id, !!g, compact]);
  useLayoutEffect(() => {
    if (g?.phase !== "finished") return;
    setSelected(null);
    setPanel("");
    setPaymentOpen(false);
    if (compact) setOverview(true);
  }, [g?.phase, compact]);
  const controls =
    g && p ? (
      <div className="action-area">
        {isSpectator ? (
          <>
            <p>
              <span className="spectator-badge">관전</span> {p.name}의 화면 ·
              읽기 전용
            </p>
            <button onClick={() => command({ type: "leave" })}>
              관전 종료
            </button>
          </>
        ) : state.paused ? (
          <p>탐사가 일시 정지되었습니다.</p>
        ) : ["animation", "moving", "reveal"].includes(g.phase) ? (
          <p>{motionText}</p>
        ) : !myTurn ? (
          <p>{turn?.name} 대원의 탐사를 기다리고 있어요.</p>
        ) : (
          <>
            {g.phase === "roll" &&
              btn(p?.tide ? "만조 탈출 주사위" : "주사위 굴리기 →", {
                type: "roll",
              })}
            {decision && (
              <button onClick={() => openTile(p.position)}>
                도착한 땅 · 구매 / 건설 선택
              </button>
            )}
            {paymentDecision && (
              <button onClick={() => setPaymentOpen(true)}>
                정산 화면 열기 · {money(g.payment!.amount)}
              </button>
            )}
            {g.phase === "low" && (
              <>
                <p>간조 · 목적지를 선택하세요</p>
                <p>
                  맵의 원하는 칸을 누르면 이동합니다. (출발지를 지나면 연구비
                  20만)
                </p>
                {btn("이용 포기", { type: "skip" })}
              </>
            )}
            {g.phase === "end" && btn("다음 차례", { type: "end" })}
          </>
        )}
      </div>
    ) : null;
  return (
    <>
      <header className="header">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          aria-label="지구마블 홈"
        >
          <span className="brand-icon">◉</span>
          <span>
            지구마블<small>EARTH MARBLE</small>
          </span>
        </a>
        <div className="header-right">
          <span className="edition">EARTH SCIENCE EXPEDITION / 01</span>
          {me && (
            <button
              className="identity profile-trigger"
              onClick={() => void openProfile(me.id)}
              aria-label="내 프로필과 전적"
            >
              <i className={connected ? "online" : ""} />
              {me.name}
            </button>
          )}
          {SOLO && g && !peerRoom.current && (
            <>
              <button
                className="solo-pause"
                disabled={busy || g.phase === "finished"}
                onClick={() =>
                  command({ type: "solo-pause", paused: !state.paused })
                }
              >
                {state.paused ? "계속하기" : "일시정지"}
              </button>
              <button
                className="solo-reset"
                onClick={() => setPanel("solo-reset")}
              >
                새 탐사
              </button>
            </>
          )}
          {room && (
            <button
              className="icon-button"
              aria-label="채팅"
              onClick={() => setPanel("chat")}
            >
              ☏
            </button>
          )}
          {room &&
            room.host === me?.id &&
            (!room.mode || room.mode === "private") && (
              <button
                className="icon-button"
                aria-label="관전 목록"
                onClick={() => setPanel("observers")}
              >
                ◉<small>{room.spectators?.length || 0}</small>
              </button>
            )}
          <button
            className="icon-button"
            aria-label="설정"
            onClick={() => setPanel("settings")}
          >
            ⚙
          </button>
        </div>
      </header>
      {error && (
        <div className="notice" role="alert">
          {error}
          <button onClick={() => setError("")} aria-label="알림 닫기">
            ×
          </button>
        </div>
      )}
      {loading ? (
        <main className="loading">탐사 본부 연결 중…</main>
      ) : !room ? (
        <main className="lobby">
          <section className="hero">
            <div className="eyebrow">
              <span /> A SMALL PLANET. A GRAND ADVENTURE.
            </div>
            <h1>
              주사위를 굴려,
              <br />
              지구를 탐사하다<span>.</span>
            </h1>
            <p>
              지각 아래에서 먼 우주까지.
              <br />
              연구비를 모으고, 나만의 연구기지를 세우세요.
              <br />
              함께 발견하는 지구과학 보드게임, 지구마블.
            </p>
            <div className="hero-meta">
              <span>
                02—04 <small>탐사 인원</small>
              </span>
              <span>
                30 MIN <small>기본 탐사 시간</small>
              </span>
              <span>
                40 <small>탐사 지역</small>
              </span>
            </div>
            <div className="hero-planet">
              <Globe />
              <span className="coordinate">
                37°33′ N &nbsp; 126°58′ E<br />
                OUR HOME, OUR PLAYGROUND
              </span>
            </div>
          </section>
          <section className="departure">
            <div className="eyebrow">EXPEDITION DESK</div>
            <h2>탐사 준비</h2>
            <p className="subtle">오늘은 어떤 발견이 기다리고 있을까요?</p>
            {!me && identityMode === "external" ? (
              <div className="external-login">
                <h3>사이트 계정으로 탐사하기</h3>
                <p>연결된 사이트의 로그인 상태를 확인해주세요.</p>
                <button
                  className="primary wide"
                  onClick={() => void bootstrapIdentity()}
                >
                  사이트 로그인 다시 확인
                </button>
              </div>
            ) : !me ? (
              <form onSubmit={login}>
                <label htmlFor="nickname">탐사대원 닉네임</label>
                <input
                  id="nickname"
                  name="name"
                  placeholder="닉네임을 입력하세요"
                  maxLength={16}
                  required
                  autoComplete="nickname"
                />
                <button className="primary wide" disabled={busy}>
                  탐사대원 등록 <span>→</span>
                </button>
                <p className="fine">
                  닉네임은 1~16자 · 별도 회원가입 없이 시작
                </p>
              </form>
            ) : state.matching ? (
              <div className="matching">
                <span className="radar">◎</span>
                <h3>
                  {state.matchMode === "normal"
                    ? "일반게임 · 4인"
                    : "빠른게임 · 2인"}{" "}
                  매칭 중
                </h3>
                <p>
                  대기 {state.count}명 ·{" "}
                  {Math.max(
                    0,
                    Math.floor((now - (state.matchStartedAt ?? now)) / 1000),
                  )}
                  초 경과
                </p>
                <p className="fine">선택한 인원이 모이면 바로 시작합니다.</p>
                {state.matchMode === "normal" &&
                  state.count >= 1 &&
                  state.count <= 2 &&
                  !declinedSlow &&
                  now - (state.matchStartedAt ?? now) >= 30000 && (
                    <div
                      className="slow-match-offer"
                      role="alertdialog"
                      aria-label="빠른게임 전환"
                    >
                      <p>
                        현재 4인게임 매칭이 지연되고 있습니다. 빠른게임으로
                        매칭하시겠습니까?
                      </p>
                      <button onClick={() => chooseMatch("quick")}>
                        수락 · 빠른게임으로 변경
                      </button>
                      <button onClick={() => setDeclinedSlow(true)}>
                        거절 · 일반게임 유지
                      </button>
                    </div>
                  )}
                <button onClick={() => command({ type: "cancel" })}>
                  매칭 취소
                </button>
              </div>
            ) : (
              <div className="lobby-actions">
                <button
                  className="primary"
                  disabled={!connected || busy}
                  onClick={() =>
                    SOLO ? openOnline("match") : setPanel("match-select")
                  }
                >
                  <span>
                    ◎ <b>자동 매칭</b>
                    <small>새로운 탐사대원과 함께</small>
                  </span>
                  <span>→</span>
                </button>
                <button
                  onClick={() => setPanel("create")}
                  disabled={!connected}
                >
                  <span>
                    ＋ <b>방 만들기</b>
                    <small>친구 또는 AI와 탐사하기</small>
                  </span>
                  <span>↗</span>
                </button>
                <button
                  onClick={() => (SOLO ? openOnline("join") : setPanel("join"))}
                  disabled={!connected}
                >
                  <span>
                    ⌁ <b>방 참가하기</b>
                    <small>열린 방 목록에서 선택</small>
                  </span>
                  <span>→</span>
                </button>
              </div>
            )}
            <button
              className="text-button help"
              onClick={() => setPanel("help")}
            >
              처음 오셨나요? <b>게임 방법 ↗</b>
            </button>
            <div className="desk-footer">
              <i /> 모든 연구비는 게임 안에서만 사용됩니다.
            </div>
          </section>
          <section className="zones">
            {ZONES.map((z, i) => (
              <div key={z}>
                <span className={`zone-symbol z${i}`}>
                  {["▲", "≈", "☁", "✦"][i]}
                </span>
                <span>
                  <small>SECTOR 0{i + 1}</small>
                  <b>{z}</b>
                </span>
                <p>
                  {
                    [
                      "흔들리는 대지, 새로운 지형의 시작",
                      "푸른 바다에 숨겨진 거대한 흐름",
                      "우리 머리 위, 끊임없이 변하는 하늘",
                      "지구 너머로 펼쳐지는 무한한 발견",
                    ][i]
                  }
                </p>
              </div>
            ))}
          </section>
        </main>
      ) : !g ? (
        <main className="waiting">
          <div className="eyebrow">
            {SOLO && !peerRoom.current
              ? "SINGLE PLAYER LOUNGE"
              : "EXPEDITION LOUNGE"}
          </div>
          <h1>{room.name}</h1>
          <p>
            {SOLO && !peerRoom.current ? (
              "로컬 대기실 · 시작 시 싱글플레이"
            ) : (
              <>
                방장{" "}
                <strong>
                  {room.members.find((m) => m.id === room.host)?.name}
                </strong>
              </>
            )}{" "}
            · {room.minutes}분 탐사 · 최대 {room.max}명
          </p>
          {peerRoom.current && (
            <p className="fine" role="status">
              {room.connection === "connecting"
                ? `방 목록 등록 준비 중입니다.${room.allowAI ? " AI 초대와 게임 시작은 바로 할 수 있습니다." : ""}`
                : room.connection === "offline"
                  ? room.allowAI
                    ? "방 목록에 등록하지 못했습니다. AI만 초대해 플레이할 수 있습니다."
                    : "방 목록에 등록하지 못했습니다. 나갔다가 다시 방을 만들어 주세요."
                  : "친구는 방 목록에서 이 방을 선택해 참가할 수 있습니다. 온라인 방장은 이 창을 열어 두어야 합니다."}
              {room.allowAI && " AI만 초대해 시작하면 싱글플레이로 전환합니다."}
            </p>
          )}
          <div className="crew-list">
            {room.members.map((m, i) => (
              <article key={m.id}>
                <span className="avatar" style={{ background: colors[i] }}>
                  {m.profile ? (
                    <img src={m.profile} alt="" />
                  ) : m.ai ? (
                    "◇"
                  ) : (
                    m.name.slice(0, 1)
                  )}
                </span>
                <h3>
                  <button
                    className="name-profile"
                    onClick={() => void openProfile(m.id)}
                  >
                    {m.name}
                  </button>{" "}
                  {m.id === room.host ? "♛" : ""}
                </h3>
                <p>
                  {m.ai
                    ? `AI · ${{ easy: "쉬움", normal: "보통", hard: "어려움" }[m.ai]}`
                    : m.offlineSince
                      ? "재접속 대기"
                      : "탐사대원"}
                </p>
                <b className={m.ready ? "ready" : ""}>
                  {m.ready ? "준비 완료" : "준비 중"}
                </b>
                {room.host === me?.id && m.id !== room.host && (
                  <button
                    className="kick-member"
                    aria-label={`${m.name} 내보내기`}
                    disabled={busy}
                    onClick={() => command({ type: "kick", member: m.id })}
                  >
                    내보내기
                  </button>
                )}
              </article>
            ))}
            {Array.from({ length: room.max - room.members.length }, (_, i) => (
              <article className="empty-seat" key={i}>
                ＋
                <p>
                  {room.allowAI
                    ? "대원 참가 또는 AI 초대"
                    : "대원을 기다리고 있어요"}
                </p>
              </article>
            ))}
          </div>
          <div className="toolbar">
            <button
              onClick={() =>
                command({
                  type: "ready",
                  ready: !room.members.find((m) => m.id === me?.id)?.ready,
                })
              }
              disabled={busy}
            >
              {room.members.find((m) => m.id === me?.id)?.ready
                ? "준비 취소"
                : "준비 완료"}
            </button>
            {room.host === me?.id && room.allowAI && (
              <>
                <select
                  id="ai-level"
                  aria-label="AI 난이도"
                  defaultValue="normal"
                >
                  <option value="easy">AI 쉬움</option>
                  <option value="normal">AI 보통</option>
                  <option value="hard">AI 어려움</option>
                </select>
                <button
                  disabled={room.members.length >= room.max}
                  onClick={() =>
                    command({
                      type: "ai",
                      difficulty: (
                        document.getElementById("ai-level") as HTMLSelectElement
                      ).value,
                    })
                  }
                >
                  AI 초대
                </button>
              </>
            )}
            {room.host === me?.id && (
              <button
                className="primary"
                disabled={
                  room.members.length < 2 ||
                  !room.members.every((m) => m.ready) ||
                  busy
                }
                onClick={() => command({ type: "start" })}
              >
                탐사 시작 →
              </button>
            )}
            <button
              className="text-button"
              onClick={() => command({ type: "leave" })}
            >
              나가기
            </button>
          </div>
        </main>
      ) : (
        <main className="game-layout">
          <aside className="players-panel">
            <div className="eyebrow">EXPEDITION CREW</div>
            <h2>
              우리 탐사대 <small>{g.players.length}명</small>
            </h2>
            {g.players.map((q, i) => (
              <article
                key={q.id}
                className={`player ${turn?.id === q.id ? "current" : ""} ${q.bankrupt ? "bankrupt" : ""} ${isSpectator && viewId === q.id ? "watching-player" : ""}`}
                onClick={() =>
                  isSpectator
                    ? command({ type: "watch", player: q.id })
                    : void openProfile(q.id)
                }
              >
                <div className="player-heading">
                  <span className="avatar" style={{ background: colors[i] }}>
                    {room.members.find((m) => m.id === q.id)?.profile ? (
                      <img
                        src={room.members.find((m) => m.id === q.id)!.profile}
                        alt=""
                      />
                    ) : q.ai ? (
                      "◇"
                    ) : (
                      q.name.slice(0, 1)
                    )}
                  </span>
                  <b>
                    {q.name}
                    {q.id === me?.id && <small> 나</small>}
                  </b>
                  <span className="turn-marker">
                    {q.bankrupt ? "파산" : turn?.id === q.id ? "TURN" : ""}
                  </span>
                </div>
                {cashChanges
                  .filter((c) => c.id === q.id && now - c.at < 2400)
                  .map((c) => (
                    <span
                      key={c.at}
                      className={`cash-float ${c.amount > 0 ? "gain" : "loss"}`}
                    >
                      {c.amount > 0 ? "+" : ""}
                      {money(c.amount)}
                    </span>
                  ))}
                <strong>
                  {money(q.cash)}
                  <small> 연구비</small>
                </strong>
                <div className="player-stats">
                  <span>{q.laps}회 완주</span>
                  <span>
                    소유지{" "}
                    {
                      Object.values(g.estates).filter((e) => e.owner === q.id)
                        .length
                    }
                  </span>
                  <span>카드 {q.cardCount}</span>
                </div>
                <p
                  className="player-last-action"
                  title={
                    g.lastActions?.[q.id] ??
                    g.log.findLast(
                      (line) =>
                        line.startsWith(q.name + " ·") ||
                        line.startsWith(q.name + " →"),
                    )
                  }
                >
                  {g.lastActions?.[q.id] ??
                    g.log.findLast(
                      (line) =>
                        line.startsWith(q.name + " ·") ||
                        line.startsWith(q.name + " →"),
                    ) ??
                    "탐사 준비 중"}
                </p>
                {q.tide > 0 && <small>만조 · 탈출 시도 {q.tide}회 남음</small>}
                {isSpectator && (
                  <button
                    className="watch-player"
                    aria-label={`${q.name} 화면 관전`}
                    onClick={(e) => {
                      e.stopPropagation();
                      command({ type: "watch", player: q.id });
                    }}
                  >
                    {viewId === q.id ? "관전 중" : "화면 보기"}
                  </button>
                )}
                <button
                  className="player-profile-button"
                  aria-label={`${q.name} 프로필`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void openProfile(q.id);
                  }}
                >
                  프로필
                </button>
              </article>
            ))}
            <div className="fund-panel">
              <span>♧ 자연보호기금</span>
              <strong>{money(g.fund)}</strong>
              <small>환급소에 도착하면 모두 받아요.</small>
            </div>
            <div className="game-meta">
              {SOLO && !peerRoom.current
                ? "싱글플레이 · 내 기기에 자동 저장"
                : `온라인 방 ${room.code}`}{" "}
              · 남은 탐사 {Math.max(0, Math.ceil((g.endsAt - gameNow) / 60000))}
              분
            </div>
            <button className="text-button" onClick={() => setPanel("help")}>
              게임 방법 ↗
            </button>
          </aside>
          <section className="board-section">
            <div className="board-caption">
              <span>
                FIELD MAP <b>지구 탐사 지도</b>
              </span>
              <span>시계 방향 탐사 ↻</span>
            </div>
            <div className="mobile-map-tools">
              <span>
                {overview ? "전체 게임판" : "지도를 밀어 자세히 보기"}
              </span>
              <button
                className="map-zoom"
                onClick={() => setOverview(!overview)}
              >
                {overview ? "크게 보기" : "전체 지도"}
              </button>
              <select
                aria-label="탐사 지역 상세 보기"
                value=""
                onChange={(e) => openTile(Number(e.target.value))}
              >
                <option value="" disabled>
                  지역 상세 보기
                </option>
                {BOARD.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.id}. {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="board-stage" ref={setMapStage}>
              <div
                className={`board-scroll ${compact && overview ? "overview" : ""}`}
                style={
                  compact && overview
                    ? { width: boardPixels, height: boardPixels }
                    : undefined
                }
              >
                <div className="board">
                  {BOARD.map((t) => {
                    let row: number, col: number;
                    if (t.id <= 10) {
                      row = 11;
                      col = 11 - t.id;
                    } else if (t.id <= 20) {
                      row = 21 - t.id;
                      col = 1;
                    } else if (t.id <= 30) {
                      row = 1;
                      col = t.id - 19;
                    } else {
                      row = t.id - 29;
                      col = 11;
                    }
                    const e = g.estates[t.id],
                      owner = g.players.findIndex((q) => q.id === e?.owner);
                    return (
                      <button
                        className={`tile z${t.zone} ${t.kind === "card" ? "card-tile" : t.id === 39 ? "bigbang-tile" : (t.kind !== "property" || !t.costs?.length) && t.id % 10 !== 0 ? "special-tile" : ""} ${t.id % 10 === 0 ? "corner" : ""} ${g.phase === "low" && myTurn && t.id !== 30 ? "travel-target" : ""}`}
                        key={t.id}
                        disabled={g.phase === "low" && myTurn && t.id === 30}
                        data-tile={t.id}
                        style={{ gridRow: row, gridColumn: col }}
                        onClick={() => openTile(t.id)}
                        aria-label={`${t.id}번 ${t.name}`}
                      >
                        <small>{String(t.id).padStart(2, "0")}</small>
                        {owner >= 0 && (
                          <span
                            className="owner-triangle"
                            style={{ background: colors[owner] }}
                          />
                        )}
                        {saleGhosts
                          .filter(
                            (v) => v.tile === t.id && v.building === undefined,
                          )
                          .map((v) => (
                            <span
                              key={v.key}
                              className="owner-triangle sale-owner-ghost"
                              aria-hidden="true"
                              style={{
                                background:
                                  colors[
                                    g.players.findIndex((q) => q.id === v.owner)
                                  ],
                              }}
                            />
                          ))}
                        <span className="tile-symbol">
                          {t.kind === "card"
                            ? "✦"
                            : t.id === 0
                              ? "◉"
                              : t.id === 10
                                ? "≋"
                                : t.id === 20
                                  ? "♧"
                                  : t.id === 30
                                    ? "⌁"
                                    : symbols[t.id % symbols.length]}
                        </span>
                        <b>
                          <span className="tile-full-name">{t.name}</span>
                          <span className="tile-short-name">
                            {
                              [
                                "본부",
                                "지진",
                                "카드",
                                "단층",
                                "화산",
                                "제주",
                                "습곡",
                                "카드",
                                "풍화",
                                "침식",
                                "만조",
                                "해류",
                                "카드",
                                "파랑",
                                "용승",
                                "터널",
                                "난류",
                                "카드",
                                "수온",
                                "엘니",
                                "환급",
                                "구름",
                                "카드",
                                "장마",
                                "안개",
                                "태풍",
                                "번개",
                                "폭설",
                                "제트",
                                "계절",
                                "간조",
                                "위상",
                                "갯벌",
                                "행성",
                                "유성",
                                "카드",
                                "월식",
                                "일식",
                                "기금",
                                "빅뱅",
                              ][t.id]
                            }
                          </span>
                        </b>
                        <span className="tile-price">
                          {t.price
                            ? `${t.price / 10000}만`
                            : t.kind === "card"
                              ? "탐사 카드"
                              : ""}
                        </span>
                        <div className="facilities">
                          {BUILDINGS.map((name, i) => (
                            <React.Fragment key={name}>
                              {e?.buildings[i] ? (
                                <span title={name}>{["⌂", "▣", "♜"][i]}</span>
                              ) : (
                                saleGhosts
                                  .filter(
                                    (v) => v.tile === t.id && v.building === i,
                                  )
                                  .map((v) => (
                                    <span
                                      key={v.key}
                                      className="sale-building-ghost"
                                      aria-hidden="true"
                                    >
                                      {["⌂", "▣", "♜"][i]}
                                    </span>
                                  ))
                              )}
                            </React.Fragment>
                          ))}
                        </div>
                        <div className="tokens">
                          {g.players.map((q, i) =>
                            q.position === t.id && !q.bankrupt ? (
                              <span
                                key={q.id}
                                title={q.name}
                                style={{
                                  background: colors[i],
                                  animationDuration: `${movementInterval(g.motion?.total ?? 6)}ms`,
                                }}
                              >
                                {i + 1}
                              </span>
                            ) : null,
                          )}
                        </div>
                      </button>
                    );
                  })}
                  <div className="board-center">
                    <div className="eyebrow">OUR PLANET, OUR DISCOVERIES</div>
                    <h2>
                      지구마블<span>EARTH MARBLE</span>
                    </h2>
                    <div
                      className="live-activity"
                      role="log"
                      aria-label="모두의 최근 행동"
                    >
                      <strong>{motionText}</strong>
                      {g.log.slice(-3).map((line, i) => (
                        <p key={i}>{line}</p>
                      ))}
                    </div>
                    {g.phase === "finished" ? (
                      <div className="winner">
                        <h3>탐사 완료!</h3>
                        <p>최종 결과를 확인하세요.</p>
                      </div>
                    ) : (
                      <>
                        <span className="turn-label">
                          {myTurn ? "나의" : turn?.name + "의"} 차례
                        </span>
                        <React.Suspense
                          fallback={
                            <div className="dice-wrap" role="status">
                              주사위 준비 중…
                            </div>
                          }
                        >
                          <Dice
                            values={g.dice}
                            rolling={g.phase === "animation" && !state.paused}
                            reduced={reduced}
                          />
                        </React.Suspense>
                        {compact && actionDock
                          ? createPortal(controls, actionDock)
                          : controls}
                        {g.phase !== "animation" && (
                          <div className="timer">
                            <span
                              style={{
                                width: `${Math.min(100, (remaining / 60) * 100)}%`,
                              }}
                            />
                            <small>행동 시간 {remaining}초</small>
                          </div>
                        )}
                      </>
                    )}
                    <div className="deck-status">
                      <div
                        className="deck-back"
                        role="img"
                        aria-label="공용 탐사 카드 덱 뒷면"
                      >
                        <span>◉</span>
                        <small>
                          EARTH
                          <br />
                          MARBLE
                        </small>
                      </div>
                      <span>공용 탐사 카드 {g.drawCount}장</span>
                      <span>버림 {g.discardCount}장</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <div className="mobile-controls">
            {" "}
            <div className="mobile-action-dock" ref={setActionDock} />
            {compact && g.phase !== "finished" && (
              <div className="dock-clock">
                {g.phase === "animation"
                  ? `${isSpectator ? p?.name : "내"} 연구비 ${money(p?.cash ?? 0)} · 주사위 연출 중`
                  : `${isSpectator ? p?.name : "내"} 연구비 ${money(p?.cash ?? 0)} · 남은 행동 시간 ${remaining}초`}
              </div>
            )}
          </div>
          <aside className="personal-panel">
            <div className="eyebrow">MY EXPEDITION</div>
            <h2>{isSpectator ? `${p?.name}의 탐사 기록` : "나의 탐사 기록"}</h2>
            <div className="my-cash">
              {cashChanges
                .filter((c) => c.id === p?.id && now - c.at < 2400)
                .map((c) => (
                  <span
                    key={c.at}
                    className={`cash-float ${c.amount > 0 ? "gain" : "loss"}`}
                  >
                    {c.amount > 0 ? "+" : ""}
                    {money(c.amount)}
                  </span>
                ))}
              <small>사용 가능한 연구비</small>
              <strong>{money(p?.cash || 0)}</strong>
              <span>총자산 {money(p ? total(p) : 0)}</span>
            </div>
            <div className="personal-buttons">
              <button onClick={() => setPanel("properties")}>
                ▧ 내 소유지{" "}
                <span>
                  {
                    Object.values(g.estates).filter((e) => e.owner === viewId)
                      .length
                  }{" "}
                  →
                </span>
              </button>
              <button onClick={() => setPanel("cards")}>
                ✦ 보유 카드{" "}
                <span>
                  {p?.held.length}
                  {p?.freeLow ? " + 효과 1" : ""} →
                </span>
              </button>
              <button
                className="compact-journal-button"
                onClick={() => setPanel("journal")}
              >
                탐사 일지
              </button>
              <button onClick={() => setPanel("assets")}>
                ◈ 자산 상세보기 <span>→</span>
              </button>
            </div>
            <div className="unlock">
              <small>연구시설 해금</small>
              <p>
                {p?.laps || 0}회 완주 ·{" "}
                {p?.laps
                  ? BUILDINGS[Math.min(2, p.laps - 1)]
                  : "첫 완주를 향해"}
              </p>
              {BUILDINGS.map((name, i) => (
                <span
                  key={name}
                  className={(p?.laps || 0) > i ? "unlocked" : ""}
                >
                  {(p?.laps || 0) > i ? "✓" : "○"} {name}
                </span>
              ))}
            </div>
            <div className="journal">
              {g.settlement && (
                <div className="latest-card">
                  <small>{BOARD[g.settlement.tile].name} · 통행료 정산</small>
                  <strong>{money(g.settlement.amount)}</strong>
                  {g.settlement.parts.map((n, i) =>
                    n > 0 ? (
                      <p key={i}>
                        {["기본 토지료", ...BUILDINGS][i]} {money(n)}
                      </p>
                    ) : null,
                  )}
                </div>
              )}
              {g.lastCard && (
                <div className="latest-card">
                  <small>최근 탐사 카드</small>
                  <b>{CARDS[g.lastCard - 1].name}</b>
                  <p>{CARDS[g.lastCard - 1].science}</p>
                  <span>{CARDS[g.lastCard - 1].effect}</span>
                </div>
              )}
              <h3>
                탐사 일지 <small>LIVE</small>
              </h3>
              <div role="log">
                {[...g.log]
                  .reverse()
                  .slice(0, 24)
                  .map((l, i) => (
                    <p key={g.log.length - i}>{l}</p>
                  ))}
              </div>
            </div>
          </aside>
        </main>
      )}
      <footer className="footer">
        <span>EARTH MARBLE © {new Date().getFullYear()}</span>
        <span>지구를 이해하는 가장 즐거운 한 바퀴.</span>
        <span>지권 · 수권 · 기권 · 우주</span>
      </footer>
      {g?.phase === "finished" && (
        <div className="modal-overlay result-overlay">
          <section
            className="payment-dialog result-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="탐사 결과"
          >
            <header className="payment-heading">
              <h2>탐사 완료!</h2>
            </header>
            <div className="payment-summary">
              <strong>
                {g.players
                  .filter((q) => standing(g, q.id)?.win)
                  .map((q) => q.name)
                  .join(", ")}{" "}
                승리
              </strong>
            </div>
            <div className="payment-details">
              {g.players.map((q) => (
                <p key={q.id}>
                  {standing(g, q.id)?.rank}위 · {q.name} ·{" "}
                  {standing(g, q.id)?.win ? "승리" : "패배"} · 최종 자산{" "}
                  {money(total(q))}원
                </p>
              ))}
            </div>
            <div className="payment-actions result-actions">
              {!isSpectator && me && (
                <button onClick={() => void openProfile(me.id)}>
                  전적 보기
                </button>
              )}
              <button onClick={() => setPanel("chat")}>채팅</button>
              <button
                className="primary"
                disabled={busy || !connected}
                onClick={() => command({ type: "leave" })}
              >
                로비로 돌아가기
              </button>
            </div>
          </section>
        </div>
      )}
      {paymentDecision &&
        paymentOpen &&
        !panel &&
        selected === null &&
        g &&
        p && (
          <div className="modal-overlay payment-overlay">
            <section
              className="payment-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="연구비 정산"
            >
              <header className="payment-heading">
                <h2>연구비 정산</h2>
                <button
                  aria-label="정산 화면 닫기"
                  onClick={() => setPaymentOpen(false)}
                >
                  ×
                </button>
              </header>
              <div className="payment-summary">
                <small>
                  {g.settlement
                    ? BOARD[g.settlement.tile].name
                    : "이동·카드 비용"}{" "}
                  ·{" "}
                  {g.payment!.to
                    ? g.players.find((q) => q.id === g.payment!.to)?.name
                    : g.payment!.fund
                      ? "자연보호기금"
                      : "은행"}
                  에게 지급
                </small>
                <strong>{money(g.payment!.amount)}원</strong>
                <span>
                  보유 {money(p.cash)}원 · 부족{" "}
                  {money(Math.max(0, g.payment!.amount - p.cash))}원
                </span>
              </div>
              <div className="payment-details">
                {g.settlement && (
                  <details>
                    <summary>통행료 계산 보기</summary>
                    {g.settlement.parts.map((n, i) =>
                      n > 0 ? (
                        <p key={i}>
                          {["토지", ...BUILDINGS][i]} {money(n)}원
                        </p>
                      ) : null,
                    )}
                  </details>
                )}
                {p.cash < g.payment!.amount && (
                  <p>
                    자동 매각은 싼 건물부터, 이후 싼 땅부터 필요한 만큼
                    판매합니다. 파산 선언도 먼저 자동 매각하며, 납부할 수 있으면
                    생존합니다. 그래도 부족하면 매각금을 포함한 전액을 지급하고
                    파산합니다.
                  </p>
                )}
                <small>남은 행동 시간 {remaining}초</small>
              </div>
              <div className="payment-actions">
                {btn(
                  "연구비 정산",
                  { type: "pay" },
                  p.cash < g.payment!.amount,
                )}
                {g.phase === "toll" &&
                  p.held.includes(25) &&
                  btn("통행료 면제권 사용", { type: "use", card: 25 })}
                {p.cash < g.payment!.amount && (
                  <>
                    {btn(
                      "부족분 자동 매각",
                      { type: "auto-sell" },
                      !Object.values(g.estates).some((e) => e.owner === p.id),
                    )}
                    <button
                      disabled={busy || !!state.paused}
                      onClick={() => setPanel("properties")}
                    >
                      직접 매각할 소유지 선택
                    </button>
                    {btn("파산 선언", { type: "bankrupt" })}
                  </>
                )}
              </div>
            </section>
          </div>
        )}
      {panel &&
        (g?.phase !== "finished" ||
          ["chat", "profile", "observers"].includes(panel)) && (
          <div
            className={`modal-overlay ${["chat", "profile", "observers"].includes(panel) ? "social-modal" : ""}`}
            onClick={() => setPanel("")}
          >
            <section
              className="modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="panel-title"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                className="close"
                onClick={() => setPanel("")}
                aria-label="닫기"
              >
                ×
              </button>
              <div className="eyebrow">EARTH MARBLE / EXPLORER'S GUIDE</div>
              <h2 id="panel-title">
                {
                  {
                    chat: "방 채팅",
                    observers: "관전 목록",
                    profile: "프로필과 전적",
                    "match-select": "매칭 종류 선택",
                    online: "온라인 게임 서버 연결",
                    "solo-reset": "새 탐사 준비",
                    journal: "탐사 일지",
                    create: "새 탐사대 만들기",
                    join: "열린 방 목록",
                    settings: "탐사 환경 설정",
                    help: "함께 지구를 탐사하는 법",
                    properties: "내 소유지",
                    cards: "보유 카드",
                    assets: "자산 상세보기",
                  }[panel]
                }
              </h2>
              {panel === "chat" && room && me && (
                <ChatPanel
                  room={room}
                  meId={me.id}
                  now={now}
                  busy={busy}
                  command={command}
                />
              )}
              {panel === "observers" && room && me && (
                <ObserversPanel
                  room={room}
                  meId={me.id}
                  busy={busy}
                  command={command}
                />
              )}
              {panel === "profile" && profile && (
                <ProfilePanel key={profile.id} profile={profile} />
              )}
              {panel === "match-select" && (
                <div className="match-options">
                  <p>원하는 인원으로 매칭합니다.</p>
                  <button
                    className="primary wide"
                    disabled={busy}
                    onClick={() => chooseMatch("quick")}
                  >
                    빠른게임 (2인)
                  </button>
                  <button
                    className="wide"
                    disabled={busy}
                    onClick={() => chooseMatch("normal")}
                  >
                    일반게임 (4인)
                  </button>
                </div>
              )}
              {panel === "online" && (
                <div className="online-connection">
                  <p>
                    다른 사람과 매칭하거나 방에 참가하려면 실행 중인 게임 서버에
                    접속해야 합니다. 서버에서 매칭·방 생성·참가를 이어서
                    진행합니다.
                  </p>
                  <label>
                    게임 서버 주소
                    <input
                      type="url"
                      placeholder="https://게임서버주소"
                      value={serverURL}
                      onChange={(e) => {
                        setServerURL(e.target.value);
                        writeSetting("earth-server-url", e.target.value);
                      }}
                    />
                  </label>
                  <button
                    className="primary wide"
                    disabled={!serverURL.trim()}
                    onClick={() => openOnline(onlineIntent)}
                  >
                    게임 서버에서 계속하기
                  </button>
                  <p className="fine">
                    AI만 초대하는 방은 이 화면에서 방 만들기로 시작할 수
                    있습니다.
                  </p>
                </div>
              )}
              {panel === "solo-reset" && (
                <>
                  <p>
                    현재 탐사를 종료하고 새로운 탐사를 준비합니다. 이 탐사의
                    저장 기록도 바뀝니다.
                  </p>
                  <button onClick={() => setPanel("")}>돌아가기</button>
                  <button
                    className="primary"
                    onClick={() =>
                      command({ type: "solo-reset" }, () => setPanel(""))
                    }
                  >
                    새 탐사 준비
                  </button>
                </>
              )}
              {panel === "journal" && (
                <div className="help-content">
                  {g?.lastCard && (
                    <article>
                      <h3>{CARDS[g.lastCard - 1].name}</h3>
                      <p>{CARDS[g.lastCard - 1].science}</p>
                      <p>{CARDS[g.lastCard - 1].effect}</p>
                    </article>
                  )}
                  {g?.log
                    .slice()
                    .reverse()
                    .map((text, i) => (
                      <p key={i}>{text}</p>
                    ))}
                </div>
              )}
              {panel === "create" && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    if (SOLO && serverURL.trim()) {
                      openOnline("create");
                      return;
                    }
                    command(
                      {
                        type: SOLO ? "peer-create" : "create",
                        max: Number(f.get("max")),
                        minutes: Number(f.get("minutes")),
                        password: f.get("password"),
                        allowAI: f.get("ai") === "on",
                      },
                      () => setPanel(""),
                    );
                  }}
                >
                  <label>
                    최대 인원
                    <select name="max" defaultValue="4">
                      {[2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                          {n}명
                        </option>
                      ))}
                    </select>
                  </label>
                  {
                    <label>
                      방 비밀번호
                      <input
                        name="password"
                        type="password"
                        maxLength={64}
                        placeholder="비워두면 비밀번호 없이 입장"
                      />
                    </label>
                  }
                  <label>
                    탐사 시간
                    <select name="minutes" defaultValue="30">
                      {[10, 20, 30, 60].map((n) => (
                        <option key={n} value={n}>
                          {n}분
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="checkbox">
                    <input type="checkbox" name="ai" defaultChecked /> AI 대원
                    초대 허용
                  </label>
                  <button className="primary wide" disabled={busy}>
                    탐사대 만들기 →
                  </button>
                </form>
              )}
              {panel === "join" && (
                <div className="room-browser">
                  {joinRoom ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const current = roomList.find(
                          (r) => r.id === joinRoom.id,
                        );
                        if (
                          !current ||
                          (!current.playing && current.count >= current.max)
                        )
                          return;
                        const f = new FormData(e.currentTarget);
                        command(
                          {
                            type: "join",
                            code: current.code,
                            password: f.get("password"),
                            spectate: !!current.playing,
                          },
                          () => setPanel(""),
                        );
                      }}
                    >
                      <h3>{joinRoom.name}</h3>
                      {!roomList.some(
                        (r) =>
                          r.id === joinRoom.id &&
                          (r.playing || r.count < r.max),
                      ) && directoryStatus === "ready" ? (
                        <p role="status">
                          이 방은 닫혔거나 게임이 시작됐거나 정원이 찼습니다.
                          다른 방을 선택하세요.
                        </p>
                      ) : (
                        <p>
                          비밀번호가 있는 방입니다. 비밀번호를 입력하면
                          참가합니다.
                        </p>
                      )}
                      <label>
                        비밀번호
                        <input
                          name="password"
                          type="password"
                          maxLength={64}
                          autoFocus
                        />
                      </label>
                      <button
                        className="primary wide"
                        disabled={
                          busy ||
                          !roomList.some(
                            (r) =>
                              r.id === joinRoom.id &&
                              (r.playing || r.count < r.max),
                          )
                        }
                      >
                        참가하기 →
                      </button>
                      <button
                        type="button"
                        className="wide"
                        onClick={() => setJoinRoom(null)}
                      >
                        다른 방 보기
                      </button>
                    </form>
                  ) : (
                    <>
                      <div className="room-browser-toolbar">
                        <p role="status">
                          {directoryStatus === "ready"
                            ? roomList.length
                              ? `열린 방 ${roomList.length}개 · 자동 갱신 중`
                              : "열린 방이 없습니다. 새 방을 만들어 보세요."
                            : directoryStatus === "offline"
                              ? "방 목록에 연결하지 못했습니다. 새로고침해 주세요."
                              : "방 목록에 연결 중입니다…"}
                        </p>
                        <button type="button" onClick={refreshRooms}>
                          새로고침
                        </button>
                      </div>
                      <div className="room-list" aria-label="열린 방">
                        {roomList.map((r) => (
                          <button
                            type="button"
                            className={`room-list-item ${r.playing ? "playing-room" : ""}`}
                            key={r.id}
                            aria-label={`${r.name} ${r.playing ? "관전" : "참가"}`}
                            disabled={busy || (!r.playing && r.count >= r.max)}
                            onClick={() => chooseRoom(r)}
                          >
                            <span>
                              <b>
                                {r.locked ? "🔒 " : ""}
                                {r.name}
                                {r.playing && " · 게임 중"}
                              </b>
                              <small>
                                {r.mode && r.mode !== "private"
                                  ? r.mode === "quick"
                                    ? "빠른게임"
                                    : "일반게임"
                                  : `방장 ${r.hostName}`}{" "}
                                · {r.minutes}분 ·{" "}
                                {r.allowAI ? "AI 허용" : "사람만"}
                              </small>
                              {r.playing && (
                                <small>
                                  {r.playerNames?.join(", ")} ·{" "}
                                  {Math.max(
                                    0,
                                    Math.floor(
                                      (now - (r.startedAt ?? now)) / 60000,
                                    ),
                                  )}
                                  분 경과
                                </small>
                              )}
                            </span>
                            <span>
                              <strong>
                                {r.count}/{r.max}명
                              </strong>
                              <small>
                                {r.playing
                                  ? "관전하기 →"
                                  : r.count >= r.max
                                    ? "정원 마감"
                                    : r.locked
                                      ? "비밀번호 입력"
                                      : "바로 참가 →"}
                              </small>
                            </span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
              {panel === "settings" && (
                <>
                  {me && (
                    <button onClick={() => void openProfile(me.id)}>
                      내 프로필과 전적
                    </button>
                  )}
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={reduced}
                      onChange={(e) => {
                        setReduced(e.target.checked);
                        writeSetting("earth-reduced", String(e.target.checked));
                      }}
                    />{" "}
                    움직임 줄이기 (주사위·카드 회전)
                  </label>
                  <label className="volume-setting">
                    효과음 음량 · {Math.round(volume * 100)}%
                    <input
                      aria-label="효과음 음량"
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(volume * 100)}
                      onChange={(e) => {
                        const v = +e.target.value / 100;
                        updateVolume(v);
                        setVolume(v);
                      }}
                    />
                  </label>
                  <div className="sound-actions">
                    <button onClick={() => playSound("gain")}>
                      효과음 미리듣기
                    </button>
                    <button onClick={() => playSound("roll")}>
                      주사위 소리
                    </button>
                    <button onClick={() => playSound("step")}>
                      말 이동 소리
                    </button>
                    <button
                      onClick={() => {
                        const v = volume === 0 ? 0.4 : 0;
                        updateVolume(v);
                        setVolume(v);
                      }}
                    >
                      {volume === 0 ? "소리 켜기" : "음소거"}
                    </button>
                  </div>
                  {SOLO && (
                    <label className="server-setting">
                      전용 게임 서버 주소 (선택)
                      <input
                        type="url"
                        placeholder="https://게임서버주소"
                        value={serverURL}
                        onChange={(e) => {
                          setServerURL(e.target.value);
                          writeSetting("earth-server-url", e.target.value);
                        }}
                      />
                      <small>
                        주소를 비워 두면 공개 신호 서버를 통해 방장과 직접
                        연결합니다.
                      </small>
                    </label>
                  )}
                </>
              )}
              {panel === "help" && (
                <div className="help-content">
                  <h3>01 · 탐사대 구성</h3>
                  <p>
                    {SOLO
                      ? "방을 만들고 AI를 초대한 뒤 준비 완료와 탐사 시작을 누르세요. AI만 초대한 방은 싱글플레이로 실행됩니다. 사람과 매칭하거나 친구 방에 참가할 수도 있습니다. 온라인 방장은 창을 열어 두어야 합니다."
                      : "2~4명이 함께 플레이합니다. 자동 매칭은 10초마다 확인하고, 개인 방에서는 AI도 초대할 수 있습니다. 모두 준비 후 방장이 시작합니다."}
                  </p>
                  <h3>02 · 주사위와 연구비</h3>
                  <p>
                    주사위 두 개로 40칸을 시계 방향으로 탐사합니다. 2인은 150만,
                    3~4인은 300만 연구비로 시작합니다. 정상 완주마다 20만을 받고
                    건설 단계가 열립니다.
                  </p>
                  <h3>03 · 나만의 연구기지</h3>
                  <p>
                    도착한 빈 소유지를 구매하세요. 자신의 소유지에 다시 도착하면
                    1·2·3회 완주에 따라 관측소·연구소·종합연구센터를 순서대로
                    하나씩 짓습니다. 통행료는 토지와 모든 시설의 금액을
                    합산합니다.
                  </p>
                  <h3>04 · 바다의 리듬, 탐사의 변수</h3>
                  <p>
                    3회 연속 더블은 만조로 이동합니다. 만조에서는 3차례 탈출을
                    시도하며 더블이나 탈출권으로 벗어납니다. 간조에서는 다음
                    차례 원하는 곳으로 이동할 수 있고 갯벌 소유자에게 20만을
                    지급합니다.
                  </p>
                  <h3>05 · 카드와 승리</h3>
                  <p>
                    탐사 카드 30장이 순환합니다. 관전자는 선택한 대원의 손패를
                    볼 수 있습니다. 참가자는 자신의 보유 카드만 보며 조건에 맞을
                    때 사용합니다. 비용이 부족하면 내 소유지에서 시설과 땅을
                    절반 가격에 매각하세요. 최후 생존자 또는 제한 시간 종료 시
                    자산 순위로 정산합니다. 2·3인전은 1위, 4인전은 1·2위가
                    승리합니다.
                  </p>
                  <p>
                    행동 제한은 60초입니다.{" "}
                    {SOLO
                      ? "탐사는 이 브라우저에 자동 저장됩니다. 탭을 닫거나 숨기면 시간이 멈추고 돌아왔을 때 이어집니다."
                      : "연결이 끊겨도 상태가 유지되며 90초 후에는 자동 행동이 대신 진행합니다."}
                  </p>
                </div>
              )}
              {panel === "cards" && (
                <div>
                  {!p?.held.length && !p?.freeLow && (
                    <p>보유한 카드가 없습니다.</p>
                  )}
                  {p?.held.map((id) => (
                    <article className="held-card" key={id}>
                      <CardArt id={id} />
                      <h3>{CARDS[id - 1].name}</h3>
                      <p className="usage">
                        <b>사용 조건</b> {CARDS[id - 1].usage}
                      </p>
                      <p>{CARDS[id - 1].science}</p>
                      <p>
                        {CARDS[id - 1].effect} · 사용 후 버림 더미로 이동합니다.
                        덱이 소진되면 함께 섞입니다.
                      </p>
                      <button
                        disabled={
                          !myTurn ||
                          busy ||
                          !connected ||
                          remaining === 0 ||
                          !(id === 24
                            ? g?.phase === "roll" && p.tide > 0
                            : g?.phase === "toll")
                        }
                        onClick={() => action({ type: "use", card: id })}
                      >
                        카드 사용
                      </button>
                    </article>
                  ))}
                  {p?.freeLow && (
                    <article className="held-card">
                      <CardArt id={22} />
                      <h3>간조 이용료 면제 효과 · 1회</h3>
                      <p className="usage">{CARDS[21].usage}</p>
                      <p>
                        간조 이동을 선택하면 다음 이용료를 자동으로 면제합니다.
                      </p>
                    </article>
                  )}
                </div>
              )}
              {panel === "properties" && (
                <div className="property-list">
                  {!Object.values(g?.estates || {}).some(
                    (e) => e.owner === viewId,
                  ) && <p>아직 보유한 소유지가 없습니다.</p>}
                  {BOARD.filter((t) => g?.estates[t.id]?.owner === viewId).map(
                    (t) => (
                      <button
                        className="owned-estate"
                        key={t.id}
                        onClick={() => {
                          setPanel("");
                          openTile(t.id);
                        }}
                      >
                        <span
                          className="owner-triangle"
                          aria-label="소유자 색상"
                          style={{
                            background:
                              colors[
                                g!.players.findIndex((q) => q.id === viewId)
                              ],
                          }}
                        />
                        <small>
                          {ZONES[t.zone]} · {t.id}번
                        </small>
                        <b>{t.name}</b>
                        <span>
                          {g?.estates[t.id].buildings
                            .map((b, i) => (b ? BUILDINGS[i] : ""))
                            .filter(Boolean)
                            .join(" + ") || "시설 없음"}
                        </span>
                        <span>현재 통행료 {money(rent(t.id))} →</span>
                      </button>
                    ),
                  )}
                </div>
              )}
              {panel === "assets" && (
                <div className="asset-list">
                  <p>
                    연구비 <b>{money(p?.cash || 0)}</b>
                  </p>
                  <p>
                    총자산 <b>{money(p ? total(p) : 0)}</b>
                  </p>
                  <p>
                    소유지 가치{" "}
                    <b>
                      {money(
                        Object.entries(g?.estates || {}).reduce(
                          (v, [id, e]) =>
                            v + (e.owner === viewId ? BOARD[+id].price! : 0),
                          0,
                        ),
                      )}
                    </b>
                  </p>
                  <p>
                    시설 가치{" "}
                    <b>
                      {money(
                        Object.entries(g?.estates || {}).reduce(
                          (v, [id, e]) =>
                            v +
                            (e.owner === viewId
                              ? e.buildings.reduce(
                                  (n, b, i) =>
                                    n + (b ? BOARD[+id].costs![i] : 0),
                                  0,
                                )
                              : 0),
                          0,
                        ),
                      )}
                    </b>
                  </p>
                  <p>은행 매각은 구매·건설 비용의 50%입니다.</p>
                  <button onClick={() => setPanel("properties")}>
                    소유지에서 매각하기 →
                  </button>
                </div>
              )}
            </section>
          </div>
        )}
      {g?.phase === "reveal" && g.pendingCard && (
        <div
          className="modal-overlay card-reveal-overlay"
          style={drawOrigin}
          key={`${g.deckVersion}-${g.pendingCard}`}
        >
          <div className="draw-source-deck" aria-label="탐사 카드 덱">
            <span>◉</span>
            <b>
              EARTH
              <br />
              MARBLE
            </b>
          </div>
          <section
            className={`drawn-card ${reduced ? "reduced" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label="공개 탐사 카드"
            tabIndex={-1}
          >
            <div className="draw-card-back" aria-hidden="true">
              <span>◉</span>
              <b>
                EARTH
                <br />
                MARBLE
              </b>
            </div>
            <div className="draw-card-front">
              <small>{turn?.name} 대원이 뽑은 카드 · 모두에게 공개</small>
              <CardArt id={g.pendingCard} />
              <h2>{CARDS[g.pendingCard - 1].name}</h2>
              <p>{CARDS[g.pendingCard - 1].effect}</p>
              <p className="subtle">{CARDS[g.pendingCard - 1].science}</p>
              <strong>
                {CARDS[g.pendingCard - 1].cardType === "consumable"
                  ? "공개 후 뽑은 대원의 보유 카드로 이동합니다."
                  : "공개 후 뽑은 대원에게 효과가 적용됩니다."}
              </strong>
            </div>
          </section>
        </div>
      )}
      {selected !== null && g?.phase !== "finished" && (
        <div
          className={`modal-overlay ${decision && selected === p?.position ? "arrival-overlay" : ""}`}
          role={decision && selected === p?.position ? "dialog" : undefined}
          aria-modal={decision && selected === p?.position ? true : undefined}
          aria-label={BOARD[selected].name + " 상세 카드"}
          onClick={() => setSelected(null)}
        >
          {decision && selected === p?.position && (
            <aside
              className="arrival-pass"
              onClick={(e) => e.stopPropagation()}
            >
              {btn(g?.phase === "purchase" ? "구매 포기" : "건설 마침", {
                type: "skip",
              })}
            </aside>
          )}
          <section
            className={`deed ${back ? "flipped" : ""} ${reduced ? "reduced" : ""}`}
            role={decision && selected === p?.position ? undefined : "dialog"}
            aria-modal={decision && selected === p?.position ? undefined : true}
            aria-label={BOARD[selected].name + " 상세 카드"}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="close"
              onClick={() => setSelected(null)}
              aria-label="상세 카드 닫기"
            >
              ×
            </button>
            <div className="deed-scroll">
              <div className={`deed-heading z${BOARD[selected].zone}`}>
                {g?.estates[selected] && (
                  <span
                    className="owner-triangle"
                    style={{
                      background:
                        colors[
                          g.players.findIndex(
                            (p) => p.id === g.estates[selected].owner,
                          )
                        ],
                    }}
                  />
                )}
                <small>
                  NO. {String(selected).padStart(2, "0")} /{" "}
                  {ZONES[BOARD[selected].zone]}
                </small>
                <h2>{BOARD[selected].name}</h2>
              </div>
              <div className="deed-rotor">
                <div className="deed-front" aria-hidden={back} inert={back}>
                  <div className="deed-art">
                    <PropertyArt id={selected} />
                  </div>
                  {BOARD[selected].kind === "refund" && g && (
                    <div
                      className="deed-total fund-total"
                      aria-label="현재 자연보호기금 적립액"
                    >
                      <small>현재 모인 자연보호기금</small>
                      <strong>{money(g.fund)}원</strong>
                      <p>이 칸에 도착하면 적립액 전액을 받습니다.</p>
                    </div>
                  )}
                  {BOARD[selected].price && (
                    <div className="front-prices">
                      <b>땅 구매 {money(BOARD[selected].price!)}원</b>
                      {BOARD[selected].costs?.map((cost, i) => (
                        <span key={i}>
                          {BUILDINGS[i]} · {money(cost)}원
                        </span>
                      ))}
                    </div>
                  )}
                  <small>{BOARD[selected].field} · 지구과학 탐사 노트</small>
                  <p>
                    {BOARD[selected].science ||
                      {
                        start:
                          "지구 탐사의 출발점입니다. 정상 완주마다 연구비 20만을 받고 완주 횟수가 증가합니다.",
                        high: "달과 태양의 기조력은 조석을 일으킵니다. 만조에서는 최대 세 차례 탈출을 시도합니다.",
                        low: "해수면이 낮아지는 간조에는 갯벌이 드러납니다. 다음 차례에 탐사 목적지를 선택할 수 있습니다.",
                        refund:
                          "모인 자연보호기금을 돌려받습니다. 지급 후 적립금은 0이 됩니다.",
                        fund: "우주환경을 위한 연구비 15만을 자연보호기금에 적립합니다.",
                        card: "공용 덱에서 다음 탐사 카드를 뽑습니다. 사용한 즉시 카드는 버림 더미로, 소모품은 개인 보관함으로 이동합니다.",
                      }[BOARD[selected].kind]}
                  </p>
                </div>
                <div className="deed-back" aria-hidden={!back} inert={!back}>
                  {BOARD[selected].price ? (
                    <>
                      <p>
                        소유자{" "}
                        <b>
                          {g?.players.find(
                            (p) => p.id === g.estates[selected]?.owner,
                          )?.name || "은행"}
                        </b>
                      </p>
                      <p>
                        구매 가격 <b>{money(BOARD[selected].price!)}</b>
                      </p>
                      <table>
                        <thead>
                          <tr>
                            <th>시설</th>
                            <th>건설비</th>
                            <th>통행료</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr>
                            <td>기본 토지</td>
                            <td>—</td>
                            <td>{money(BOARD[selected].rents![0])}</td>
                          </tr>
                          {BOARD[selected].costs?.map((cost, i) => (
                            <tr key={i}>
                              <td>
                                {g?.estates[selected]?.buildings[i] ? "✓ " : ""}
                                {BUILDINGS[i]}
                              </td>
                              <td>{money(cost)}</td>
                              <td>+{money(BOARD[selected].rents![i + 1])}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p>
                        현재 건설 상태{" "}
                        <b>
                          {g?.estates[selected]?.buildings
                            .map((v, i) => (v ? BUILDINGS[i] : ""))
                            .filter(Boolean)
                            .join(" + ") || "시설 없음"}
                        </b>
                      </p>
                      <p className="toll-formula" aria-label="통행료 합산 과정">
                        {BOARD[selected]
                          .rents!.filter(
                            (_n, i) =>
                              i === 0 || g?.estates[selected]?.buildings[i - 1],
                          )
                          .map(money)
                          .join(" + ")}{" "}
                        = {money(rent(selected))}
                      </p>
                      <div className="deed-total">
                        <small>현재 누적 통행료</small>
                        <strong>{money(rent(selected))}</strong>
                      </div>
                      {selected === 32 && (
                        <p>간조 이용료 200,000 · 직접 도착 400,000</p>
                      )}
                      {!BOARD[selected].costs?.length && (
                        <p>특수 소유지는 시설을 건설할 수 없습니다.</p>
                      )}
                      {g &&
                        g.estates[selected]?.owner === me?.id &&
                        myTurn &&
                        !["animation", "moving", "reveal"].includes(
                          g.phase,
                        ) && (
                          <div className="sell-actions">
                            {[...g.estates[selected].buildings.keys()]
                              .reverse()
                              .map((i) =>
                                g.estates[selected].buildings[i] ? (
                                  <button
                                    key={i}
                                    disabled={
                                      i !== nextSaleBuilding(g, selected)
                                    }
                                    onClick={() =>
                                      action({
                                        type: "sell",
                                        tile: selected,
                                        building: i,
                                      })
                                    }
                                  >
                                    {" "}
                                    {BUILDINGS[i]} 매각 (
                                    {money(BOARD[selected].costs![i] / 2)})
                                  </button>
                                ) : null,
                              )}
                            <button
                              disabled={g.estates[selected].buildings.some(
                                Boolean,
                              )}
                              onClick={() =>
                                action({ type: "sell", tile: selected })
                              }
                            >
                              토지 매각 ({money(BOARD[selected].price! / 2)})
                            </button>
                          </div>
                        )}
                    </>
                  ) : BOARD[selected].kind === "refund" && g ? (
                    <div
                      className="deed-total fund-total"
                      aria-label="현재 자연보호기금 적립액"
                    >
                      <small>현재 모인 자연보호기금</small>
                      <strong>{money(g.fund)}원</strong>
                      <p>도착 시 전액 환급 · 지급 후 적립액 0원</p>
                    </div>
                  ) : (
                    <p>특수 칸입니다. 앞면에서 효과를 확인하세요.</p>
                  )}
                </div>
              </div>
            </div>
            <button className="flip-button" onClick={() => setBack(!back)}>
              ↻ 카드 돌리기 · {back ? "과학 설명" : "게임 정보"}
            </button>
          </section>
          {decision && selected === p?.position && g && p && (
            <aside
              className="arrival-choices"
              onClick={(e) => e.stopPropagation()}
            >
              {g.phase === "purchase"
                ? btn(
                    "땅 구매",
                    { type: "buy" },
                    p.cash < BOARD[selected].price!,
                  )
                : BUILDINGS.map((name, i) => (
                    <React.Fragment key={name}>
                      {btn(
                        `${name} 건설 · ${money(BOARD[selected].costs![i])}`,
                        { type: "build", building: i },
                        g.estates[selected].buildings[i] ||
                          g.estates[selected].buildings.findIndex((b) => !b) !==
                            i ||
                          p.laps < i + 1 ||
                          p.cash < BOARD[selected].costs![i],
                      )}
                    </React.Fragment>
                  ))}
              {g.phase === "build" && (
                <small>
                  위에서 아래로 순서대로 건설 · {p.laps}회 완주
                  <br />
                  건설 후 다음 시설을 이어서 지을 수 있습니다.
                </small>
              )}
            </aside>
          )}
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
