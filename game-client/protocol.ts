import type { GameView } from "../game-core";
export type Member = {
  id: string;
  name: string;
  ready: boolean;
  profile?: string;
  ai?: string;
  offlineSince?: number;
};
export type Room = {
  id: string;
  version: number;
  code: string;
  name: string;
  host: string;
  max: number;
  allowAI: boolean;
  minutes: number;
  members: Member[];
  connection?: "connecting" | "ready" | "offline";
  game?: GameView;
};
export type State = {
  room: Room | null;
  matching: boolean;
  count: number;
  matchAt: number;
  paused?: boolean;
  clockNow?: number;
};
export type Snapshot = State & { serverNow: number };
