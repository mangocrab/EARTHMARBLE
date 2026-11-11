import Peer, { type DataConnection, type PeerOptions } from "peerjs";
function options(): PeerOptions {
  // PeerJS 1.5 ships retired TURN hostnames. Use reachable public STUN for
  // direct connections; a relay can be injected for controlled deployments/tests.
  const config: RTCConfiguration = {
    iceServers: [
      {
        urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"],
      },
    ],
  };
  if (import.meta.env.VITE_TURN_URL)
    config.iceServers = [
      {
        urls: import.meta.env.VITE_TURN_URL,
        username: "earth",
        credential: "earth-test",
      },
    ];
  const url = import.meta.env.VITE_SIGNAL_URL;
  if (!url) return { debug: 0, config };
  const u = new URL(url);
  return {
    host: u.hostname,
    port: +u.port || (u.protocol === "https:" ? 443 : 80),
    secure: u.protocol === "https:",
    path: u.pathname,
    debug: 0,
    config,
  };
}
export function openPeer(id: string, signal?: AbortSignal): Promise<Peer> {
  if (signal?.aborted) return Promise.reject(new Error("연결이 취소됐습니다."));
  return new Promise((resolve, reject) => {
    const peer = new Peer(id, options());
    const timeout = setTimeout(
      () =>
        failed(
          new Error(
            "온라인 연결을 준비하지 못했습니다. 잠시 후 다시 시도하세요.",
          ),
        ),
      12000,
    );
    const cancelled = () => failed(new Error("연결이 취소됐습니다."));
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancelled);
      peer.off("error", failed);
    };
    const failed = (e: Error) => {
      cleanup();
      peer.destroy();
      reject(e);
    };
    signal?.addEventListener("abort", cancelled, { once: true });
    peer.once("error", failed);
    peer.once("open", () => {
      cleanup();
      resolve(peer);
    });
  });
}
export function connect(
  peer: Peer,
  id: string,
  signal?: AbortSignal,
): Promise<DataConnection> {
  if (signal?.aborted) return Promise.reject(new Error("연결이 취소됐습니다."));
  return new Promise((resolve, reject) => {
    const c = peer.connect(id, { reliable: true, serialization: "binary" });
    let settled = false;
    const timer = setTimeout(
      () =>
        fail(
          new Error(
            "방에 연결할 수 없습니다. 목록을 새로고침하고 다시 선택하세요.",
          ),
        ),
      15000,
    );
    const cancel = () => fail(new Error("연결이 취소됐습니다."));
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      c.off("open", opened);
      c.off("close", closed);
      c.off("error", fail);
    };
    const fail = (e: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      c.close();
      reject(e);
    };
    const closed = () => fail(new Error("연결이 닫혔습니다."));
    const opened = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(c);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    c.once("open", opened);
    c.once("error", fail);
    c.once("close", closed);
  });
}
