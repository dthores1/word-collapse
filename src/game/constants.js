// Board geometry. The board is rendered as a fixed-size grid where each
// tile is absolutely positioned by (row, col) so we can animate movement
// through CSS transitions on `transform`.
//
// At ROWS=10 the board is tall enough that the player has real breathing
// room before overflow becomes a concern, but still fits in a typical
// laptop viewport at TILE_SIZE=46.
export const COLS = 5;
export const ROWS = 10;

// Pixel dimensions for the board at the design scale (also the upper cap
// when fitting to the viewport). Runtime layout uses `makeBoardGeometry()`.
export const TILE_SIZE = 46; // px
export const TILE_GAP = 6;   // px
export const CELL_STRIDE = TILE_SIZE + TILE_GAP;
export const BOARD_INNER_WIDTH  = COLS * TILE_SIZE + (COLS - 1) * TILE_GAP;
export const BOARD_INNER_HEIGHT = ROWS * TILE_SIZE + (ROWS - 1) * TILE_GAP;

/** Padding inside the board chrome in `Board.jsx` (pixels, each side). */
export const BOARD_FRAME_PADDING = 28;

// Responsive board: shrink tile size on short/narrow viewports so the play
// UI tends to stay within the window without scrolling.
export const MIN_TILE_SIZE = 34;
export const MAX_TILE_SIZE = TILE_SIZE;

/**
 * @typedef {{ tileSize: number, tileGap: number, cellStride: number, innerWidth: number, innerHeight: number }} BoardGeometry
 */
/** @param {number} tileSize */
export function makeBoardGeometry(tileSize) {
  const gap = tileSize * (TILE_GAP / TILE_SIZE);
  const cellStride = tileSize + gap;
  return {
    tileSize,
    tileGap: gap,
    cellStride,
    innerWidth: COLS * tileSize + (COLS - 1) * gap,
    innerHeight: ROWS * tileSize + (ROWS - 1) * gap,
  };
}

// How many rows are pre-seeded onto the board at game start. The player
// gets a few rows of context to plan from before the first arrival, which
// also makes the playability scorer's "highest occupied row" check
// meaningful from turn 0.
export const INITIAL_ROWS = 3;

// Minimum length to count as a "word".
export const MIN_WORD_LENGTH = 3;

// How long the combo window stays open after the most recent clear. Each
// clear resets the timer; if it lapses without another clear, combo resets.
export const COMBO_WINDOW_MS = 4000;

// Lifelines — initial uses each round, max cap, and how many words must
// be cleared between regen ticks. Each regen tick awards +1 to each
// lifeline (capped at LIFELINE_MAX).
export const LIFELINE_INITIAL_USES = 2;
export const LIFELINE_MAX = 3;
export const LIFELINE_REGEN_EVERY_WORDS = 8;

// Difficulty tuning. `seconds` is the *initial* row interval — it
// accelerates over time and additionally scales with board fullness.
//
//   acceleratePerWord:  multiplier shaved off cadence each time a word clears
//   pressureFloor:      hardest the cadence is allowed to get (seconds)
//   vowelBias:          probability of generating a vowel for each new tile
//   rareLetterChance:   chance of swapping a rolled consonant for a rare one
// `quality` is the post-arrival board playability bar. The candidate
// scorer rejects rows that don't meet ALL of these; if no candidate
// passes after `QUALITY_ATTEMPTS`, the best-scored row wins.
//
//   minLongWords   — distinct 4–5 letter ENABLE words on the resulting
//                    grid. We check length ≥ 4 (not 3) because ENABLE
//                    is generous with obscure 3-letter entries that
//                    don't translate to "a human can spot this fast".
//   minNewRowUses  — # of words (any length 3+) that include at least
//                    one tile from the just-arrived row
//   minHighestUses — # of words (any length 3+) that include at least
//                    one tile from the topmost occupied row (danger row)
export const DIFFICULTY = {
  chill: {
    label: 'Chill',
    blurb: '15s PER ROW',
    seconds: 15.0,
    pressureFloor: 10.0,
    acceleratePerWord: 0.985,
    vowelBias: 0.46,
    rareLetterChance: 0.02,
    quality: { minLongWords: 4, minNewRowUses: 2, minHighestUses: 1 },
  },
  standard: {
    label: 'Standard',
    blurb: '10s PER ROW',
    seconds: 10.0,
    pressureFloor: 6.0,
    acceleratePerWord: 0.975,
    vowelBias: 0.40,
    rareLetterChance: 0.05,
    quality: { minLongWords: 2, minNewRowUses: 1, minHighestUses: 1 },
  },
  frenzy: {
    label: 'Frenzy',
    blurb: '7s PER ROW',
    seconds: 7.0,
    pressureFloor: 4.0,
    acceleratePerWord: 0.96,
    vowelBias: 0.34,
    rareLetterChance: 0.10,
    quality: { minLongWords: 1, minNewRowUses: 0, minHighestUses: 0 },
  },
};

// Number of candidate rows to draw per arrival before we give up and
// return the best-scored one. Each candidate enumerates all 3–5 letter
// words on a simulated post-arrival grid; with the 200-word cap the
// total work per arrival is bounded at well under 100ms.
export const QUALITY_ATTEMPTS = 20;

// Animation timings, exposed so JS-driven removals (e.g. waiting for a
// clear animation to finish before applying gravity) can reference the
// same numbers as the CSS keyframes.
export const ANIM = {
  tileClear:   150,
  tileExplode: 280, // bomb-triggered clears use a longer/punchier flash
  tileMove:    200, // gravity / row-shift transition duration
  rowImpact:   220,
  shake:       180,
};
