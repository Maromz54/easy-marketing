/**
 * Spintax parser — resolves `{option1|option2|option3}` tokens into a single
 * random variant.  Supports unlimited nesting:
 *
 *   "{Hello|Hi} {world|{beautiful|amazing} earth}" →
 *     "Hi beautiful earth"  (one possible output)
 *
 * Empty alternatives are valid:  "{Great |} apartment" can produce
 * "Great apartment" or "apartment" (with leading space trimmed by the caller
 * if desired — we intentionally preserve whitespace so the user stays in
 * control of spacing).
 */
export function resolveSpintax(text: string): string {
  // Process from the inside out: find the innermost `{…}` that contains no
  // nested braces, resolve it, then repeat until no braces remain.
  let result = text;
  const MAX_PASSES = 64; // safety limit against malformed input
  for (let i = 0; i < MAX_PASSES; i++) {
    // Match the innermost `{…}` (no nested braces inside)
    const match = result.match(/\{([^{}]+)\}/);
    if (!match) break;

    const alternatives = match[1].split("|");
    const pick = alternatives[Math.floor(Math.random() * alternatives.length)];
    result = result.slice(0, match.index!) + pick + result.slice(match.index! + match[0].length);
  }
  return result;
}

/**
 * Returns true when `text` contains at least one spintax token (`{…|…}`).
 * Useful for UI hints — skip the "spintax detected" badge when there's nothing
 * to spin.
 */
export function hasSpintax(text: string): boolean {
  return /\{[^{}]*\|[^{}]*\}/.test(text);
}
