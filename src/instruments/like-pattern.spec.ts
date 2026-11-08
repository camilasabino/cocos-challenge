import { escapeLikePattern } from './like-pattern';

describe('escapeLikePattern', () => {
  it.each([
    ['plain text', 'alfa', 'alfa'],
    ['percent', '100%', '100\\%'],
    ['underscore', 'a_b', 'a\\_b'],
    ['backslash', 'a\\b', 'a\\\\b'],
    ['all together, backslash first', '\\%_', '\\\\\\%\\_'],
    ['repeated specials', '%%__', '\\%\\%\\_\\_'],
    ['empty string', '', ''],
  ])('escapes %s', (_label, input, expected) => {
    expect(escapeLikePattern(input)).toBe(expected);
  });
});
