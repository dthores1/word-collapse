// Adjacency + path finding helpers.
//
// The board is modelled as a 2D array `grid[row][col]` where each cell is
// either `null` (empty) or `{ id, letter }`. The drag-and-keyboard input
// systems share these helpers so behaviour stays consistent.

import { COLS, ROWS } from './constants.js';

// 8-direction neighbour test. A tile is adjacent to itself? No — a tile
// can never connect to itself (and a path may not reuse tiles).
export function isAdjacent(a, b) {
  if (!a || !b) return false;
  const dr = Math.abs(a.row - b.row);
  const dc = Math.abs(a.col - b.col);
  return (dr | dc) !== 0 && dr <= 1 && dc <= 1;
}

// Given the current grid and a target uppercase word, return a path
// (array of {row, col, id}) that spells the word using 8-direction
// adjacency with no repeats — or null if no such path exists.
//
// The search prefers paths anchored close to existing partials (we just
// DFS from every matching first cell); for our 5×5 grids the search
// space is small enough that exhaustive backtracking is plenty fast.
export function findPath(grid, word) {
  if (!word) return null;
  const target = word.toUpperCase();
  if (target.length === 0) return null;

  const tileAt = (r, c) =>
    r >= 0 && r < ROWS && c >= 0 && c < COLS ? grid[r][c] : null;

  const visited = new Set();

  function dfs(r, c, idx, path) {
    const tile = tileAt(r, c);
    if (!tile) return null;
    if (tile.letter !== target[idx]) return null;
    if (visited.has(tile.id)) return null;

    visited.add(tile.id);
    path.push({ row: r, col: c, id: tile.id });

    if (idx === target.length - 1) return path.slice();

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const found = dfs(r + dr, c + dc, idx + 1, path);
        if (found) return found;
      }
    }

    visited.delete(tile.id);
    path.pop();
    return null;
  }

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const tile = tileAt(r, c);
      if (tile && tile.letter === target[0]) {
        const result = dfs(r, c, 0, []);
        if (result) return result;
      }
    }
  }
  return null;
}

// Reads the letters along a path and returns the resulting word.
export function pathToWord(path, grid) {
  if (!path) return '';
  let out = '';
  for (const p of path) {
    const tile = grid[p.row]?.[p.col];
    if (!tile) return '';
    out += tile.letter;
  }
  return out;
}
