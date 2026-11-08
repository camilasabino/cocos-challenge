/**
 * Escapes the characters that are special in LIKE/ILIKE patterns (`\`, `%`, `_`)
 * so user input is matched literally. PostgreSQL's default escape character is
 * the backslash, and it must be escaped first.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
