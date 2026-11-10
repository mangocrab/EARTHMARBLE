import { createHmac, timingSafeEqual } from "node:crypto";
import type { IdentityAdapter } from "../../identity-adapter";
export function signAccount(
  account: { id: string; name: string; profile?: string },
  key: string,
) {
  const body = Buffer.from(JSON.stringify(account)).toString("base64url");
  return (
    body + "." + createHmac("sha256", key).update(body).digest("base64url")
  );
}
export function createIdentityAdapter(): IdentityAdapter {
  const key = process.env.SITE_TEST_SIGNING_KEY;
  if (!key) throw new Error("This fixture requires its test signing key");
  return {
    async resolve(req) {
      try {
        const cookie = req.headers.cookie
          ?.split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith("site_session="))
          ?.slice(13);
        if (!cookie) return null;
        const [body, signature] = cookie.split(".");
        const actual = Buffer.from(signature || "", "base64url"),
          expected = createHmac("sha256", key).update(body).digest();
        if (
          actual.length !== expected.length ||
          !timingSafeEqual(actual, expected)
        )
          return null;
        const account = JSON.parse(Buffer.from(body, "base64url").toString());
        return typeof account.id === "string" &&
          typeof account.name === "string"
          ? account
          : null;
      } catch {
        return null;
      }
    },
  };
}
