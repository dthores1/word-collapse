// Letter generation. Two responsibilities:
//
//   1. STRATIFIED ROW CONSTRUCTION (`rollRow`)
//      Builds each row by slot purpose (vowels → anchor → optional rare
//      → fill) and shuffles. Guarantees by construction:
//        - all 5 letters distinct
//        - 2 or 3 vowels per row (chosen up front, biased by difficulty)
//        - ≤ 1 rare letter (J/Q/X/Z)
//        - ≥ 1 R/S/T/L/N anchor
//      The fill is biased toward digraph-friendly consonants (D/H/C/M/P/G)
//      so rows naturally form glue patterns like TH, SH, CH, ST, TR, CR,
//      PR, GR, etc.
//
//   2. PLAYABILITY SCORING (`rollPlayableRow`)
//      Generates `QUALITY_ATTEMPTS` candidate rows. For each candidate it
//      simulates arrival on the current columns, enumerates every
//      distinct 3–5 letter ENABLE word on the resulting grid, scores the
//      candidate by word count weighted by length plus bonuses for
//      involving the new row and the topmost occupied (danger) row, and
//      returns the first candidate that meets the per-difficulty
//      threshold. If none pass, the best-scored candidate wins.
//
// Why scoring beats the old "any word exists" check: a row can be
// English-looking but produce a *dead adjacency graph* — words exist
// elsewhere on the board but the new tiles don't connect to anything
// useful, leaving the player stranded as the danger row creeps up. The
// scorer explicitly rewards rows that integrate with what's already
// there.

import { COLS, QUALITY_ATTEMPTS, ROWS } from './constants.js';

// ---------------------------------------------------------------------
// Letter pools
// ---------------------------------------------------------------------
const VOWELS = 'AAAEEEIIIOOUU'; // weighted-by-frequency vowel pool

// Three-tier consonant taxonomy:
//   COMMON_HIGH — guaranteed in every row; the "wheel-of-fortune" anchors
//                 R/S/T/L/N produce so much glue they earn an automatic
//                 reservation.
//   COMMON_MID  — digraph-friendly fill: D/H/C/M/P/G form TH, SH, CH, CR,
//                 CL, PR, PL, GR, MP, ND, etc.
//   COMMON_OTHER— long-tail consonants that rarely contribute glue.
const COMMON_HIGH = 'RSTLN';
const COMMON_MID = 'DHCMPG';
const COMMON_OTHER = 'BFKVWY';
const RARE = 'JQXZ';

const VOWEL_SET = new Set('AEIOU');

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function pickFrom(pool) {
  return pool[Math.floor(Math.random() * pool.length)];
}

// Bias: 35% HIGH, 40% MID, 25% OTHER. Concentrates fill into letters that
// actually form digraphs with vowels and with each other.
function pickFillLetter() {
  const r = Math.random();
  if (r < 0.35) return pickFrom(COMMON_HIGH);
  if (r < 0.75) return pickFrom(COMMON_MID);
  return pickFrom(COMMON_OTHER);
}

function pickDistinct(pool, n, exclude = new Set()) {
  const out = [];
  const used = new Set(exclude);
  let safety = 0;
  while (out.length < n && safety < 200) {
    safety++;
    const letter = pickFrom(pool);
    if (!used.has(letter)) {
      used.add(letter);
      out.push(letter);
    }
  }
  if (out.length < n) {
    for (const l of new Set(pool.split(''))) {
      if (out.length >= n) break;
      if (!used.has(l)) {
        used.add(l);
        out.push(l);
      }
    }
  }
  return out;
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Enumerate every length-`count` subset of [0..len-1] in which no two
// chosen indices are consecutive. Used to place vowels into row slots
// such that the row never has two horizontally-adjacent vowels.
//
// len=5 results:
//   count=2 → 6 sets: {0,2},{0,3},{0,4},{1,3},{1,4},{2,4}
//   count=3 → 1 set:  {0,2,4}  (only VCVCV avoids adjacency)
function nonAdjacentPositionSets(len, count) {
  const out = [];
  function backtrack(start, picked) {
    if (picked.length === count) {
      out.push(picked.slice());
      return;
    }
    for (let i = start; i < len; i++) {
      picked.push(i);
      backtrack(i + 2, picked);
      picked.pop();
    }
  }
  backtrack(0, []);
  return out;
}

// Drop vowels into `len` slots at one of the non-adjacent position
// sets (chosen uniformly at random), fill the remaining slots with
// consonants. Eliminates horizontal vowel adjacency within a row by
// construction. Cross-row vowel adjacency (vertical / diagonal) is
// handled separately by the scoreBoard penalty in rollPlayableRow.
function placeAvoidingAdjacentVowels(vowels, consonants, len) {
  shuffleInPlace(vowels);
  shuffleInPlace(consonants);
  const sets = nonAdjacentPositionSets(len, vowels.length);
  if (sets.length === 0) {
    // No valid placement (e.g. 4 vowels in 5 slots — can't happen with
    // current 2-or-3-vowel constraint, but stay safe).
    return shuffleInPlace([...vowels, ...consonants]);
  }
  const positions = sets[Math.floor(Math.random() * sets.length)];
  const result = new Array(len);
  positions.forEach((pos, i) => {
    result[pos] = vowels[i];
  });
  let cIdx = 0;
  for (let i = 0; i < len; i++) {
    if (result[i] === undefined) result[i] = consonants[cIdx++];
  }
  return result;
}

// ---------------------------------------------------------------------
// Stratified row generation
// ---------------------------------------------------------------------
export function rollRow(difficulty) {
  const len = COLS;
  const vowelCount = Math.random() < difficulty.vowelBias ? 3 : 2;
  const includeRare = Math.random() < difficulty.rareLetterChance;

  const used = new Set();
  const vowels = [];
  const consonants = [];

  // Vowels (distinct, weighted)
  for (const v of pickDistinct(VOWELS, vowelCount)) {
    vowels.push(v);
    used.add(v);
  }

  // Anchor — guaranteed R/S/T/L/N (lives in the consonant pool, gets
  // placed alongside the rest of the consonants below).
  let anchor = pickFrom(COMMON_HIGH);
  while (used.has(anchor)) anchor = pickFrom(COMMON_HIGH);
  consonants.push(anchor);
  used.add(anchor);

  // Optional single rare letter
  if (includeRare && vowels.length + consonants.length < len) {
    const rare = pickFrom(RARE);
    consonants.push(rare);
    used.add(rare);
  }

  // Fill remaining cells with distinct, digraph-biased consonants.
  while (vowels.length + consonants.length < len) {
    let letter = pickFillLetter();
    let safety = 0;
    while (used.has(letter) && safety < 30) {
      letter = pickFillLetter();
      safety++;
    }
    if (used.has(letter)) {
      const fallback = (COMMON_HIGH + COMMON_MID + COMMON_OTHER)
        .split('')
        .find((c) => !used.has(c));
      if (!fallback) break;
      letter = fallback;
    }
    consonants.push(letter);
    used.add(letter);
  }

  // Place vowels at non-adjacent slot positions so the new row never
  // contributes a horizontally-adjacent vowel pair. (For 3-vowel rows
  // only {0,2,4} qualifies — the resulting column asymmetry is
  // counter-balanced by the scoreBoard vowel-adjacency penalty, which
  // steers rollPlayableRow toward 2-vowel candidates when a 3-vowel
  // row would stack on top of an existing vowel column.)
  return placeAvoidingAdjacentVowels(vowels, consonants, len);
}

// =====================================================================
// Playability scoring
// =====================================================================

const PROBE_MIN_LEN = 3;
const PROBE_MAX_LEN = 5;
const WORD_CAP = 200; // safety bound on enumerator

// Per-length point values used to score candidate boards.
const LENGTH_POINTS = { 3: 10, 4: 20, 5: 35 };
const NEW_ROW_BONUS = 5;
const HIGHEST_ROW_BONUS = 5;
// Each 8-adjacent vowel-vowel pair on the simulated grid costs the
// candidate this many points. Calibrated to act as a tie-breaker
// between similar-word-count candidates without dominating the
// playability signal — at typical board densities (~30 pairs random,
// ~10 pairs constructive-placement) the per-candidate delta is on
// the order of 100 points, comparable to a single length-5 word.
const VOWEL_ADJACENCY_PENALTY = 5;

// Build the 2D grid view that *would* exist if `letters` arrived as the
// next row on top of `columns`. New tiles get negative ids so the scorer
// can detect "this word uses a new-row tile".
function simulateArrival(columns, letters) {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (let c = 0; c < COLS; c++) {
    const stack = columns[c];
    const newStack =
      stack.length >= ROWS
        ? stack
        : [{ id: -(c + 1), letter: letters[c] }, ...stack];
    for (let i = 0; i < newStack.length; i++) {
      const r = ROWS - 1 - i;
      if (r < 0) continue;
      grid[r][c] = newStack[i];
    }
  }
  return grid;
}

// New-row tile ids on the simulated grid. Always at row ROWS-1 (bottom)
// and always have negative ids per `simulateArrival`.
function newRowIds(grid) {
  const ids = new Set();
  for (let c = 0; c < COLS; c++) {
    const tile = grid[ROWS - 1][c];
    if (tile && tile.id < 0) ids.add(tile.id);
  }
  return ids;
}

// Count distinct 8-adjacent vowel-vowel pairs on the grid. Visits each
// pair once by only looking at the right / down-left / down / down-right
// neighbors of each cell.
function countVowelAdjacencies(grid) {
  let count = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const tile = grid[r][c];
      if (!tile || !VOWEL_SET.has(tile.letter)) continue;
      // Right neighbor
      if (c + 1 < COLS) {
        const right = grid[r][c + 1];
        if (right && VOWEL_SET.has(right.letter)) count++;
      }
      // Next row: bottom-left, bottom, bottom-right
      if (r + 1 < ROWS) {
        for (let dc = -1; dc <= 1; dc++) {
          const nc = c + dc;
          if (nc < 0 || nc >= COLS) continue;
          const nb = grid[r + 1][nc];
          if (nb && VOWEL_SET.has(nb.letter)) count++;
        }
      }
    }
  }
  return count;
}

// Tile ids in the topmost occupied row — i.e. the row closest to overflow.
// Returns an empty set if the board is empty after arrival (shouldn't
// happen in practice but we guard anyway).
function highestOccupiedRowIds(grid) {
  for (let r = 0; r < ROWS; r++) {
    const ids = new Set();
    for (let c = 0; c < COLS; c++) {
      const tile = grid[r][c];
      if (tile) ids.add(tile.id);
    }
    if (ids.size > 0) return ids;
  }
  return new Set();
}

// DFS enumerate every distinct 3–5 letter ENABLE word on the grid.
// Returns Map<word, ids[]> where ids is the path that first realised it.
// Uses a single shared `visited` set + `path` stack for performance.
function enumerateWords(grid, dictionary) {
  const found = new Map();
  const visited = new Set();
  const idStack = [];

  function dfs(r, c, word) {
    if (found.size >= WORD_CAP) return;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return;
    const tile = grid[r][c];
    if (!tile || visited.has(tile.id)) return;

    visited.add(tile.id);
    idStack.push(tile.id);
    const next = word + tile.letter;

    if (next.length >= PROBE_MIN_LEN) {
      const lower = next.toLowerCase();
      if (dictionary.has(lower) && !found.has(lower)) {
        found.set(lower, idStack.slice());
      }
    }

    if (next.length < PROBE_MAX_LEN) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          dfs(r + dr, c + dc, next);
        }
      }
    }

    visited.delete(tile.id);
    idStack.pop();
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      dfs(r, c, '');
      if (found.size >= WORD_CAP) return found;
    }
  }
  return found;
}

// Scores a simulated post-arrival grid. Returns the raw score plus the
// counts the threshold check needs.
//
// `longWords` counts only words of length ≥ 4. The threshold check uses
// this metric (not `totalWords`) because ENABLE is permissive with
// obscure 3-letter entries that wouldn't translate to "a human can spot
// this fast" — restricting the bar to length 4+ correlates much better
// with player-perceived playability.
export function scoreBoard(grid, dictionary) {
  const words = enumerateWords(grid, dictionary);
  const newIds = newRowIds(grid);
  const highIds = highestOccupiedRowIds(grid);

  let score = 0;
  let totalWords = 0;
  let longWords = 0;
  let usingNewRow = 0;
  let usingHighest = 0;

  for (const [word, idPath] of words) {
    totalWords++;
    if (word.length >= 4) longWords++;
    score += LENGTH_POINTS[word.length] ?? 10;

    let usesNew = false;
    let usesHigh = false;
    for (const id of idPath) {
      if (newIds.has(id)) usesNew = true;
      if (highIds.has(id)) usesHigh = true;
    }
    if (usesNew) {
      usingNewRow++;
      score += NEW_ROW_BONUS;
    }
    if (usesHigh) {
      usingHighest++;
      score += HIGHEST_ROW_BONUS;
    }
  }

  // Penalty for vowel clusters. Steers candidate selection in
  // rollPlayableRow toward arrivals that don't stack vowels on top of
  // existing vowel columns. Small enough to act as a tie-breaker; the
  // playability thresholds (longWords, newRow uses, highest-row uses)
  // are still the primary signal.
  const vowelAdjacencies = countVowelAdjacencies(grid);
  score -= vowelAdjacencies * VOWEL_ADJACENCY_PENALTY;

  return { score, totalWords, longWords, usingNewRow, usingHighest };
}

// Relaxed threshold for the game-start seed row. The board has only the
// 5 fresh tiles, so demanding multiple long words is unrealistic — and
// also unnecessary, since the player has the full first row-interval to
// orient before any pressure.
const SEED_QUALITY = { minLongWords: 0, minNewRowUses: 0, minHighestUses: 0 };

export function rollPlayableRow(difficulty, columns, dictionary) {
  if (!dictionary) return rollRow(difficulty);

  const totalTiles = columns.reduce((acc, col) => acc + col.length, 0);
  const targets = totalTiles === 0 ? SEED_QUALITY : difficulty.quality;

  let best = null;
  for (let i = 0; i < QUALITY_ATTEMPTS; i++) {
    const row = rollRow(difficulty);
    const grid = simulateArrival(columns, row);
    const result = scoreBoard(grid, dictionary);

    if (
      result.longWords >= targets.minLongWords &&
      result.usingNewRow >= targets.minNewRowUses &&
      result.usingHighest >= targets.minHighestUses
    ) {
      return row;
    }

    if (!best || result.score > best.score) {
      best = { row, score: result.score };
    }
  }

  // No candidate hit the bar — return the highest-scoring fallback so
  // even pathological RNG sequences don't strand the player.
  return best?.row ?? rollRow(difficulty);
}

// ---------------------------------------------------------------------
// Test/debug surface — exported so the sanity-check script can call them
// without re-implementing the simulation harness.
// ---------------------------------------------------------------------
export const __test__ = {
  enumerateWords,
  scoreBoard,
  simulateArrival,
  newRowIds,
  highestOccupiedRowIds,
};
