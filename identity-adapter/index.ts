import { randomBytes, createHash } from "node:crypto";
import type { Request } from "express";
export interface CommunityProfile {
  profile?: string;
  banner?: string;
  frame?: string;
  title?: string;
  url?: string;
}
export function communityProfile(value: CommunityProfile): CommunityProfile {
  const safe = (url: unknown) =>
    typeof url === "string" &&
    (/^https:\/\//.test(url) || /^\/(?!\/)/.test(url))
      ? url
      : undefined;
  return {
    profile: safe(value.profile),
    banner: safe(value.banner),
    frame: safe(value.frame),
    url: safe(value.url),
    title:
      typeof value.title === "string"
        ? value.title.trim().slice(0, 40) || undefined
        : undefined,
  };
}
export interface Identity extends CommunityProfile {
  id: string;
  name: string;
}
/** Host integration: verify its signed session server-side and return a stable subject.
 * Never accept user IDs or profile claims directly from browser input. */
export interface IdentityAdapter {
  resolve(request: Pick<Request, "headers">): Promise<Identity | null>;
  /** Optional site profile provider. Game records remain keyed by the stable id. */
  profile?(id: string): Promise<(CommunityProfile & { name?: string }) | null>;
  /** Catalog available to this authenticated account, including owned community stickers. */
  emojis?(identity: Identity): Promise<import("../game-social").Emoji[]>;
}
export function newToken() {
  return randomBytes(32).toString("base64url");
}
export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
export function sessionToken(cookie = "") {
  return (
    cookie
      .split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("earth_session="))
      ?.slice(14) || ""
  );
}
export function nickname(value: unknown) {
  if (
    typeof value !== "string" ||
    value.trim().length < 1 ||
    value.trim().length > 16
  )
    throw new Error("닉네임은 1~16자로 입력하세요.");
  return value.trim();
}
