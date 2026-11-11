// Test-process preload only. The application never reads these variables.
import { readFileSync } from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
const realNow = Date.now;
if (process.env.EARTH_TEST_CLOCK_FILE)
  Date.now = () => {
    try {
      return Number(readFileSync(process.env.EARTH_TEST_CLOCK_FILE, "utf8"));
    } catch {
      return realNow();
    }
  };
if (
  process.env.EARTH_TEST_FIXED_DICE === "true" ||
  process.env.EARTH_TEST_FIXED_ORDER === "true"
) {
  const crypto = createRequire(import.meta.url)("node:crypto"),
    original = crypto.randomInt;
  let n = 0;
  crypto.randomInt = (...args) => {
    if (args.length === 1 && [2, 3, 4].includes(args[0])) return 0;
    if (
      process.env.EARTH_TEST_FIXED_DICE === "true" &&
      args.length === 1 &&
      args[0] === 6
    )
      return n++ % 2;
    return original(...args);
  };
  syncBuiltinESMExports();
}
