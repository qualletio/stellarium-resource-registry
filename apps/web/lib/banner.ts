// A 5-row block font for the home page banner. `#` is a filled cell.
const GLYPHS: Record<string, string[]> = {
  A: ['.###.', '#...#', '#####', '#...#', '#...#'],
  E: ['#####', '#....', '####.', '#....', '#####'],
  G: ['.####', '#....', '#..##', '#...#', '.####'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  L: ['#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#'],
  R: ['####.', '#...#', '####.', '#..#.', '#...#'],
  S: ['.####', '#....', '.###.', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '.###.'],
  Y: ['#...#', '.#.#.', '..#..', '..#..', '..#..'],
};

/** The filled cells of `word` in the block font, as rows of booleans. Letters are one column apart. */
export function blockCells(word: string): boolean[][] {
  const glyphs = [...word.toUpperCase()].map((char) => GLYPHS[char] ?? ['.', '.', '.', '.', '.']);
  return glyphs[0].map((_, row) => [...glyphs.map((glyph) => glyph[row]).join('.')].map((cell) => cell === '#'));
}
