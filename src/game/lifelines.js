// Lifeline algorithms — pure helpers used by the reducer.
//
// BOMB: find the topmost row with the most tiles and return their ids.
//       The reducer animates the clear and removes them without scoring.
//
// COLLAPSE: repack the per-column stacks to stair-stepped target heights
//           with minimum disruption. Only the top tiles of overflowing
//           columns spill into shorter columns; the bottom of each column
//           is preserved so existing word setups don't get shredded.

import { COLS, ROWS } from './constants.js';

// Build the 2D grid view from per-column stacks (same layout used by
// useGame's memoized grid). row 0 = top, row ROWS-1 = bottom.
function gridFromColumns(columns) {
  const grid = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  for (let c = 0; c < COLS; c++) {
    const stack = columns[c];
    for (let i = 0; i < stack.length; i++) {
      const r = ROWS - 1 - i;
      if (r < 0) continue;
      grid[r][c] = stack[i];
    }
  }
  return grid;
}

// BOMB target — topmost row with the highest tile count. Returns an
// array of tile ids to clear. Empty result means the board is empty,
// in which case the reducer should skip consuming a use.
export function bombTargetIds(columns) {
  const grid = gridFromColumns(columns);
  for (let target = COLS; target >= 1; target--) {
    for (let r = 0; r < ROWS; r++) {
      const tiles = grid[r].filter((t) => t !== null);
      if (tiles.length === target) {
        return tiles.map((t) => t.id);
      }
    }
  }
  return [];
}

// COLLAPSE — pack tiles into a stair-stepped rectangle from the bottom up.
//
// Target column heights for N total tiles (COLS = 5):
//   fullRows  = floor(N / COLS)
//   remainder = N % COLS
//   heights   = [fullRows + 1, ..., fullRows + 1, fullRows, ..., fullRows]
//                  (`remainder` columns from the left get the extra)
//
// We pop excess tiles off the *top* of each over-tall column (left→right),
// then push them onto the *top* of each under-tall column (also left→right).
// Bottom-of-column tiles never move, which keeps any in-progress word
// patterns near the danger line stable.
//
// Returns { columns, changed } so the caller can refuse to consume a
// lifeline use when the board is already in a collapsed shape.
export function computeCollapse(columns) {
  const N = columns.reduce((acc, col) => acc + col.length, 0);
  if (N === 0) return { columns, changed: false };

  const fullRows = Math.floor(N / COLS);
  const remainder = N % COLS;
  const targetHeights = Array.from(
    { length: COLS },
    (_, c) => fullRows + (c < remainder ? 1 : 0),
  );

  const next = columns.map((col) => col.slice());

  // Phase 1: collect spilled tiles from over-tall columns.
  const spilled = [];
  for (let c = 0; c < COLS; c++) {
    while (next[c].length > targetHeights[c]) {
      spilled.push(next[c].pop()); // top of stack
    }
  }

  // Phase 2: distribute spilled tiles into under-tall columns.
  for (let c = 0; c < COLS; c++) {
    while (next[c].length < targetHeights[c] && spilled.length > 0) {
      next[c].push(spilled.shift());
    }
  }

  const changed = next.some(
    (col, c) =>
      col.length !== columns[c].length ||
      col.some((tile, i) => tile.id !== columns[c][i]?.id),
  );
  return { columns: next, changed };
}
