import { randomBytes, createHash } from "node:crypto";
import type { Request } from "express";
export interface Identity {
  id: string;
  name: string;
  profile?: string;
}
/** Host integration: verify its signed session server-side and return a stable subject.
 * Never accept user IDs or profile claims directly from browser input. */
export interface IdentityAdapter {
  resolve(request: Pick<Request, "headers">): Promise<Identity | null>;
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
