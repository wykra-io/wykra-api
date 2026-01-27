export type JsonTextShape = 'object' | 'array';

function extractFirstJsonSlice(
  text: string,
  shape: JsonTextShape,
): string | null {
  if (typeof text !== 'string' || text.length === 0) {
    return null;
  }

  const regex = shape === 'array' ? /\[[\s\S]*\]/ : /\{[\s\S]*\}/;
  const match = text.match(regex);
  return match ? match[0] : null;
}

/**
 * Best-effort JSON parsing from LLM/text responses.
 *
 * Many LLMs return JSON wrapped in extra prose or markdown; this helper:
 * - extracts the first JSON object/array slice (by regex)
 * - JSON.parse()'s it
 * - returns null on failure (no throw)
 */
export function safeJsonParseFromText<T>(
  text: string,
  shape: JsonTextShape,
): T | null {
  try {
    const extracted = extractFirstJsonSlice(text, shape);
    const jsonString = extracted ?? text;
    return JSON.parse(jsonString) as T;
  } catch {
    return null;
  }
}
