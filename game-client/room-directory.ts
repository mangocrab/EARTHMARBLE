import type Peer from "peerjs";
import type { DataConnection } from "peerjs";
import { openPeer, connect } from "./peer-transport";
import type { RoomListing } from "./protocol";
const DIRECTORY = "earthmarble-public-rooms-v2";
const LEASE = 18000;
export type DirectoryStatus = "connecting" | "ready" | "offline";
function validRoom(value: any): value is RoomListing {
  return (
    !!value &&
    typeof value.id === "string" &&
    value.id.length <= 80 &&
    typeof value.code === "string" &&
    /^[A-F0-9]{6}$/.test(value.code) &&
    typeof value.name === "string" &&
    value.name.length > 0 &&
    value.name.length <= 64 &&
    typeof value.hostName === "string" &&
    value.hostName.length > 0 &&
    value.hostName.length <= 16 &&
    [2, 3, 4].includes(value.max) &&
    Number.isInteger(value.count) &&
    value.count >= 1 &&
    value.count <= value.max &&
    [10, 20, 30, 60].includes(value.minutes) &&
    typeof value.allowAI === "boolean" &&
    typeof value.locked === "boolean"
  );
}
function publicListing(room: RoomListing): RoomListing {
  const {
    id,
    code,
    name,
    hostName,
    count,
    max,
    allowAI,
    minutes,
    locked,
    playing,
    playerNames,
    startedAt,
    mode,
  } = room;
  return {
    id,
    code,
    name,
    hostName,
    count,
    max,
    allowAI,
    minutes,
    locked,
    playing: !!playing,
    playerNames: Array.isArray(playerNames)
      ? playerNames
          .filter((n) => typeof n === "string" && n.length <= 16)
          .slice(0, 4)
      : [],
    startedAt:
      typeof startedAt === "number" && Number.isFinite(startedAt)
        ? startedAt
        : undefined,
    mode: mode === "quick" || mode === "normal" ? mode : "private",
  };
}
/** A live, elected directory for Pages. Hosts register through their actual game
 * peer, so one connection can only publish its own room. No password is sent.
 * When the coordinator leaves, waiting hosts and browsers elect a replacement. */
export class RoomDirectory {
  private peer?: Peer;
  private leader?: Peer;
  private upstream?: DataConnection;
  private clients = new Map<DataConnection, number>();
  private entries = new Map<string, { room: RoomListing; at: number }>();
  private room?: RoomListing;
  private rooms: RoomListing[] = [];
  private status: DirectoryStatus = "connecting";
  private fingerprint = "";
  private dead = false;
  private connecting = false;
  private lastReply = Date.now();
  private abort = new AbortController();
  private retryTimer?: ReturnType<typeof setTimeout>;
  private heartbeat: ReturnType<typeof setInterval>;
  constructor(
    private listener: (rooms: RoomListing[], status: DirectoryStatus) => void,
    private external?: Peer,
  ) {
    this.peer = external;
    this.heartbeat = setInterval(() => this.tick(), 3000);
    void this.start();
  }
  private emit(rooms = this.rooms, status = this.status) {
    const fingerprint = JSON.stringify([status, rooms]);
    if (this.dead || fingerprint === this.fingerprint) return;
    this.rooms = rooms;
    this.status = status;
    this.fingerprint = fingerprint;
    this.listener(rooms, status);
  }
  private async start() {
    if (this.dead || this.connecting) return;
    this.connecting = true;
    if (this.status !== "offline") this.emit([], "connecting");
    let failed = false;
    try {
      if (!this.peer || this.peer.destroyed) {
        if (this.external) throw new Error("방 연결이 닫혔습니다.");
        this.peer = await openPeer(
          `earthmarble-browser-${crypto.randomUUID()}`,
          this.abort.signal,
        );
        this.peer.on("error", () => {});
        this.peer.on("disconnected", () => {
          if (!this.dead && !this.peer!.destroyed) this.peer!.reconnect();
        });
      }
      try {
        const leader = await openPeer(DIRECTORY, this.abort.signal);
        if (this.dead) {
          leader.destroy();
          return;
        }
        this.leader = leader;
        leader.on("error", (error) => {
          // One failed visitor connection must not close everyone else's directory.
          if (!this.dead && error.type === "unavailable-id") leader.destroy();
        });
        leader.on("disconnected", () => {
          if (!this.dead && !leader.destroyed) leader.reconnect();
        });
        leader.on("close", () => {
          if (this.dead || this.leader !== leader) return;
          this.leader = undefined;
          for (const c of this.clients.keys()) c.close();
          this.clients.clear();
          this.entries.clear();
          this.retry();
        });
        leader.on("connection", (c) => this.accept(c));
        this.updateOwn();
        this.push();
      } catch (e) {
        if (this.dead) return;
        if ((e as { type?: string }).type !== "unavailable-id") throw e;
        const c = await connect(this.peer, DIRECTORY, this.abort.signal);
        if (this.dead) {
          c.close();
          return;
        }
        this.upstream = c;
        this.lastReply = Date.now();
        c.on("data", (data: any) => {
          if (
            this.dead ||
            this.upstream !== c ||
            data?.type !== "list" ||
            !Array.isArray(data.rooms)
          )
            return;
          if (data.rooms.length > 500 || !data.rooms.every(validRoom)) return;
          this.lastReply = Date.now();
          this.emit(data.rooms.map(publicListing), "ready");
        });
        c.on("error", () => c.close());
        c.on("close", () => {
          if (this.dead || this.upstream !== c) return;
          this.upstream = undefined;
          this.retry();
        });
        this.announce();
      }
    } catch {
      if (!this.dead) {
        this.emit([], "offline");
        failed = true;
      }
    } finally {
      this.connecting = false;
      if (failed) this.retry();
    }
  }
  private retry() {
    if (this.dead || this.retryTimer) return;
    if (this.status !== "offline") this.emit([], "connecting");
    this.retryTimer = setTimeout(
      () => {
        this.retryTimer = undefined;
        void this.start();
      },
      500 + Math.random() * 800,
    );
  }
  setRoom(room?: RoomListing) {
    const changed = JSON.stringify(this.room) !== JSON.stringify(room);
    this.room = room;
    if (!changed || this.dead) return;
    if (this.leader) {
      this.updateOwn();
      this.push();
    } else this.announce();
  }
  private announce() {
    if (this.upstream?.open)
      this.upstream.send({ type: "announce", room: this.room });
  }
  refresh() {
    if (this.dead) return;
    if (this.leader) this.push();
    else if (this.upstream?.open) this.announce();
    else {
      clearTimeout(this.retryTimer);
      this.retryTimer = undefined;
      void this.start();
    }
  }
  private updateOwn() {
    if (!this.peer) return;
    if (this.room && this.peer.id === `earthmarble-room-${this.room.code}`)
      this.entries.set(this.peer.id, { room: this.room, at: Date.now() });
    else this.entries.delete(this.peer.id);
  }
  private accept(c: DataConnection) {
    this.clients.set(c, Date.now());
    c.on("error", () => c.close());
    c.on("open", () => {
      if (!this.dead) c.send({ type: "list", rooms: this.current() });
    });
    c.on("data", (data: any) => {
      if (this.dead || !this.clients.has(c)) return;
      this.clients.set(c, Date.now());
      if (data?.type !== "announce") return;
      if (data.room == null) this.entries.delete(c.peer);
      else if (
        validRoom(data.room) &&
        c.peer === `earthmarble-room-${data.room.code}`
      )
        this.entries.set(c.peer, {
          room: publicListing(data.room),
          at: Date.now(),
        });
      this.push();
      if (c.open) c.send({ type: "list", rooms: this.current() });
    });
    c.on("close", () => {
      this.clients.delete(c);
      // A replaced connection must not remove the newer registration.
      if (![...this.clients.keys()].some((other) => other.peer === c.peer))
        this.entries.delete(c.peer);
      if (!this.dead) this.push();
    });
  }
  private current() {
    return [...this.entries.values()]
      .map((e) => e.room)
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name, "ko") || a.code.localeCompare(b.code),
      );
  }
  private push() {
    const rooms = this.current();
    const changed =
      JSON.stringify(rooms) !== JSON.stringify(this.rooms) ||
      this.status !== "ready";
    this.emit(rooms, "ready");
    if (changed)
      for (const c of this.clients.keys())
        if (c.open) c.send({ type: "list", rooms });
  }
  private tick() {
    if (this.dead) return;
    if (this.leader) {
      this.updateOwn();
      const now = Date.now();
      for (const [c, at] of this.clients) if (now - at > LEASE) c.close();
      for (const [id, entry] of this.entries)
        if (now - entry.at > LEASE) this.entries.delete(id);
      this.push();
    } else if (this.upstream?.open) {
      if (Date.now() - this.lastReply > LEASE) this.upstream.close();
      else this.announce();
    }
  }
  close() {
    if (this.dead) return;
    this.dead = true;
    this.abort.abort();
    clearInterval(this.heartbeat);
    clearTimeout(this.retryTimer);
    this.upstream?.close();
    this.leader?.destroy();
    for (const c of this.clients.keys()) c.close();
    this.clients.clear();
    this.entries.clear();
    if (!this.external) this.peer?.destroy();
  }
}
