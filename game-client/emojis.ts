import { quickEmoji, type Emoji } from "../game-social";

// Only bundled originals follow the Vite base; site-provided URLs keep their origin.
export function emojiSource(emoji: Emoji): string | undefined {
  const builtin = quickEmoji(emoji.id);
  return builtin && emoji.url === builtin.url
    ? `${import.meta.env.BASE_URL}${builtin.url!.slice(1)}`
    : emoji.url;
}
