import type {
  Stats,
  RoomMode,
  MatchMode,
  Spectator,
  ChatMessage,
  Emoji,
  GameResult,
} from "../game-social";
import type { GameView } from "../game-core";
export type Member = {
  id: string;
  name: string;
  ready: boolean;
  profile?: string;
  ai?: string;
  offlineSince?: number;
  stats?: Stats;
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
  mode?: RoomMode;
  spectators?: Spectator[];
  chat?: ChatMessage[];
  emojis?: Emoji[];
  startedAt?: number;
  isSpectator?: boolean;
  watching?: string;
  result?: GameResult;
};
export type State = {
  room: Room | null;
  matching: boolean;
  count: number;
  matchAt: number;
  matchMode?: MatchMode;
  matchStartedAt?: number;
  paused?: boolean;
  clockNow?: number;
};
export type Snapshot = State & { serverNow: number };

/** Public waiting-room metadata only: never include passwords or game state. */
export type RoomListing = {
  id: string;
  code: string;
  name: string;
  hostName: string;
  count: number;
  max: number;
  allowAI: boolean;
  minutes: number;
  locked: boolean;
  playing?: boolean;
  playerNames?: string[];
  startedAt?: number;
  mode?: RoomMode;
};
