import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import {
  ANIM,
  COLS,
  COMBO_WINDOW_MS,
  DIFFICULTY,
  INITIAL_ROWS,
  LIFELINE_INITIAL_USES,
  LIFELINE_MAX,
  LIFELINE_REGEN_EVERY_WORDS,
  MIN_WORD_LENGTH,
  ROWS,
} from '../game/constants.js';
import { rollPlayableRow } from '../game/letters.js';
import { bombTargetIds, computeCollapse } from '../game/lifelines.js';
import { awardPoints } from '../game/scoring.js';

// =====================================================================
// State shape (kept flat so the reducer is easy to follow)
// =====================================================================
//
//  phase        : 'idle' | 'playing' | 'gameover'
//  difficulty   : 'chill' | 'standard' | 'frenzy'
//  columns      : Tile[][] — 5 columns, each a stack of tiles bottom→top.
//                 columns[c][0] sits at the bottom row (row=ROWS-1).
//                 columns[c][i] sits at row = ROWS - 1 - i.
//  nextRow      : string[5] — letters that will arrive next.
//  rowProgress  : 0..1 — how full the next-row timer is.
//  rowInterval  : ms — current cadence; shrinks as the player clears words
//                 and additionally with board fullness.
//  score, combo, wordsCount, foundWords, bestWord — gameplay stats.
//  comboExpiresAt: epoch ms — when combo lapses.
//  clearingIds  : Set<id> — tiles currently mid clear-animation (rendered
//                 with the .animate-tile-clear class so they shrink/fade
//                 before we actually remove them from the board).
//  toasts       : floating UI bits (e.g. "+120", "COMBO x3"). Each entry
//                 has { id, text, kind, expiresAt }.
//  shakeKey     : incremented to retrigger the board shake animation.
//  hardShakeKey : incremented to play the heavier game-over shake.
//  redFlashKey  : incremented to play the game-over red-flash overlay.
//  startedAt    : epoch ms — used for the elapsed timer.
//  elapsedMs    : ms since start.
// =====================================================================

let _id = 1;
const nextTileId = () => _id++;

const initialState = {
  phase: 'idle',
  difficulty: 'standard',
  columns: emptyColumns(),
  nextRow: [],
  rowProgress: 0,
  rowInterval: DIFFICULTY.standard.seconds * 1000,
  score: 0,
  combo: 0,
  wordsCount: 0,
  foundWords: [],
  bestWord: '',
  comboExpiresAt: 0,
  clearingIds: new Set(),
  toasts: [],
  shakeKey: 0,
  hardShakeKey: 0,
  redFlashKey: 0,
  startedAt: 0,
  elapsedMs: 0,
  // Dictionary lives on state so generation helpers can use it from
  // inside the reducer (which has no access to outer-scope refs).
  dictionary: null,
  commonDict: null,
  // Lifeline counts (reset on START_GAME, regenerate +1 every
  // LIFELINE_REGEN_EVERY_WORDS successful clears, capped at LIFELINE_MAX).
  bombUses: LIFELINE_INITIAL_USES,
  collapseUses: LIFELINE_INITIAL_USES,
  // Tile ids currently animating with the bomb explosion class. Distinct
  // from `clearingIds` so we can play a heavier flash effect.
  explodingIds: new Set(),
};

function emptyColumns() {
  return Array.from({ length: COLS }, () => []);
}

function makeTile(letter) {
  return { id: nextTileId(), letter };
}

// Pumps the next row in by prepending one tile to each column. Returns
// `{ columns, overflow }`. A column is in overflow when adding a tile
// would push its top tile past row 0 — i.e. existing length >= ROWS.
function applyArrival(columns, letters) {
  const overflow = columns.some((col) => col.length >= ROWS);
  if (overflow) return { columns, overflow: true };
  const next = columns.map((col, c) => [makeTile(letters[c]), ...col]);
  return { columns: next, overflow: false };
}

function removeTilesByIds(columns, ids) {
  const remove = ids instanceof Set ? ids : new Set(ids);
  return columns.map((col) => col.filter((t) => !remove.has(t.id)));
}

// Pressure multiplier — fuller boards pump rows in faster. Counted as a
// scaling factor on the "effective" interval used by the progress bar.
function pressureFactor(columns) {
  const filled = columns.reduce((acc, col) => acc + col.length, 0);
  const max = ROWS * COLS;
  const t = filled / max; // 0..1
  // Up to 25% faster at 100% full.
  return 1 - 0.25 * t;
}

function reducer(state, action) {
  switch (action.type) {
    case 'START_GAME': {
      const difficulty = action.difficulty || state.difficulty;
      const cfg = DIFFICULTY[difficulty];
      // Seed the board with INITIAL_ROWS rows already in place so the
      // player has real context to plan from. We pump rows in sequentially
      // through the playability scorer so each seed row meets the same
      // playable-graph bar that runtime arrivals do.
      let columns = emptyColumns();
      for (let i = 0; i < INITIAL_ROWS; i++) {
        const letters = rollPlayableRow(cfg, columns, state.commonDict || state.dictionary);
        columns = columns.map((col, c) => [makeTile(letters[c]), ...col]);
      }
      return {
        ...initialState,
        dictionary: state.dictionary,
        phase: 'playing',
        difficulty,
        columns,
        nextRow: rollPlayableRow(cfg, columns, state.commonDict || state.dictionary),
        rowInterval: cfg.seconds * 1000,
        rowProgress: 0,
        startedAt: action.now,
        elapsedMs: 0,
        bombUses: LIFELINE_INITIAL_USES,
        collapseUses: LIFELINE_INITIAL_USES,
      };
    }

    case 'SET_DIFFICULTY': {
      if (state.phase !== 'idle') return state;
      return { ...state, difficulty: action.difficulty };
    }

    case 'SET_DICTIONARY': {
      return { ...state, dictionary: action.dictionary };
    }

    case 'SET_COMMON': {
      return { ...state, commonDict: action.commonDict };
    }

    case 'STOP_GAME': {
      if (state.phase !== 'playing') return state;
      return { ...state, phase: 'gameover' };
    }

    case 'RESET': {
      // Return to the title screen, preserving the player's currently
      // selected difficulty so it stays sticky between rounds.
      return { ...initialState, difficulty: state.difficulty };
    }

    case 'TICK': {
      if (state.phase !== 'playing') return state;
      const dt = action.dt;
      const now = action.now;

      const effective = state.rowInterval * pressureFactor(state.columns);
      let rowProgress = state.rowProgress + dt / effective;
      let combo = state.combo;
      if (state.comboExpiresAt && now >= state.comboExpiresAt) {
        combo = 0;
      }
      const toasts = state.toasts.filter((t) => now < t.expiresAt);

      // Don't auto-arrive while a clear animation is mid-flight; tile-clear
      // and row-arrival overlapping looks chaotic. Clearing windows are
      // short (~150ms), so deferring by a frame is invisible.
      if (rowProgress >= 1 && state.clearingIds.size === 0) {
        return arriveRow(
          { ...state, combo, toasts },
          now,
        );
      }
      return {
        ...state,
        rowProgress: Math.min(rowProgress, 1),
        elapsedMs: state.elapsedMs + dt,
        combo,
        toasts,
      };
    }

    case 'CLEAR_START': {
      const set = new Set(action.ids);
      return { ...state, clearingIds: set };
    }

    case 'CLEAR_END': {
      const cfg = DIFFICULTY[state.difficulty];
      const word = action.word;
      const comboNext = state.combo + 1;
      const points = awardPoints({
        word,
        comboCount: comboNext,
        chainStep: 1,
      });
      const columns = removeTilesByIds(state.columns, action.ids);
      const newRowInterval = Math.max(
        cfg.pressureFloor * 1000,
        state.rowInterval * cfg.acceleratePerWord,
      );

      const wordsNext = state.wordsCount + 1;
      const regen =
        wordsNext > 0 && wordsNext % LIFELINE_REGEN_EVERY_WORDS === 0 ? 1 : 0;
      const bombUsesNext = Math.min(LIFELINE_MAX, state.bombUses + regen);
      const collapseUsesNext = Math.min(LIFELINE_MAX, state.collapseUses + regen);

      const toasts = [
        ...state.toasts,
        {
          id: `t${action.now}-w`,
          text: `+${points}`,
          kind: 'points',
          expiresAt: action.now + 1100,
        },
      ];
      if (comboNext >= 2) {
        toasts.push({
          id: `t${action.now}-c`,
          text: `COMBO x${comboNext}`,
          kind: 'combo',
          expiresAt: action.now + 1100,
        });
      }
      if (action.ids.length >= 6) {
        toasts.push({
          id: `t${action.now}-h`,
          text: 'HUGE CLEAR',
          kind: 'huge',
          expiresAt: action.now + 1300,
        });
      }
      if (regen > 0) {
        toasts.push({
          id: `t${action.now}-l`,
          text: 'LIFELINE +1',
          kind: 'combo',
          expiresAt: action.now + 1300,
        });
      }

      return {
        ...state,
        columns,
        clearingIds: new Set(),
        score: state.score + points,
        combo: comboNext,
        comboExpiresAt: action.now + COMBO_WINDOW_MS,
        wordsCount: wordsNext,
        bestWord:
          word.length > state.bestWord.length ? word : state.bestWord,
        foundWords: [...state.foundWords, { word, points }],
        rowInterval: newRowInterval,
        bombUses: bombUsesNext,
        collapseUses: collapseUsesNext,
        toasts,
      };
    }

    case 'BOMB_START': {
      // Pure marker action — record exploding ids and decrement use.
      // The hook schedules BOMB_END after the explosion animation.
      if (state.bombUses <= 0) return state;
      const ids = bombTargetIds(state.columns);
      if (ids.length === 0) return state; // empty board, refund the use
      return {
        ...state,
        explodingIds: new Set(ids),
        bombUses: state.bombUses - 1,
      };
    }

    case 'BOMB_END': {
      // Remove exploded tiles. No score, no combo, no rowInterval change.
      const columns = removeTilesByIds(state.columns, action.ids);
      return {
        ...state,
        columns,
        explodingIds: new Set(),
        // A bomb counts as a "clear event" — increment shake for impact.
        shakeKey: state.shakeKey + 1,
      };
    }

    case 'COLLAPSE': {
      if (state.collapseUses <= 0) return state;
      const { columns, changed } = computeCollapse(state.columns);
      if (!changed) return state; // already compact — don't waste a use
      return {
        ...state,
        columns,
        collapseUses: state.collapseUses - 1,
      };
    }

    case 'INVALID': {
      return { ...state, shakeKey: state.shakeKey + 1 };
    }

    case 'ARRIVE_ROW': {
      return arriveRow(state, action.now);
    }

    default:
      return state;
  }
}

function arriveRow(state, now) {
  const { columns, overflow } = applyArrival(state.columns, state.nextRow);
  const cfg = DIFFICULTY[state.difficulty];

  if (overflow) {
    return {
      ...state,
      phase: 'gameover',
      rowProgress: 1,
      hardShakeKey: state.hardShakeKey + 1,
      redFlashKey: state.redFlashKey + 1,
    };
  }

  const filled = columns.reduce((acc, col) => acc + col.length, 0);
  const isDanger = columns.some((col) => col.length >= ROWS - 1);
  const shakeKey = isDanger || filled >= ROWS * COLS - 4
    ? state.shakeKey + 1
    : state.shakeKey;

  return {
    ...state,
    columns,
    nextRow: rollPlayableRow(cfg, columns, state.commonDict || state.dictionary),
    rowProgress: 0,
    shakeKey,
  };
}

// =====================================================================
// useGame hook
// =====================================================================
//
// Two dictionaries flow in:
//   `dictionary` — full ENABLE; used by reducer for word acceptance when
//                  the player submits.
//   `commonDict` — curated ~12k common-words subset; used by the
//                  playability scorer in rollPlayableRow so generated
//                  rows match what a typical player can spot. Falls back
//                  to `dictionary` upstream if the common file fails to
//                  load.
export function useGame(dictionary, commonDict) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Stash both dictionaries into reducer state once they've loaded so
  // reducer helpers (rollPlayableRow) can use them.
  useEffect(() => {
    if (dictionary) dispatch({ type: 'SET_DICTIONARY', dictionary });
  }, [dictionary]);
  useEffect(() => {
    if (commonDict) dispatch({ type: 'SET_COMMON', commonDict });
  }, [commonDict]);

  // Drive the row-arrival timer + clock with a single rAF loop so all
  // time-derived state advances in lockstep.
  const lastTickRef = useRef(0);
  useEffect(() => {
    if (state.phase !== 'playing') return undefined;
    let raf;
    lastTickRef.current = performance.now();
    const step = (now) => {
      const dt = now - lastTickRef.current;
      lastTickRef.current = now;
      dispatch({ type: 'TICK', dt, now: Date.now() });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [state.phase]);

  // Derived 2D grid view used by drag selection + path finding.
  const grid = useMemo(() => {
    const out = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    for (let c = 0; c < COLS; c++) {
      const stack = state.columns[c];
      for (let i = 0; i < stack.length; i++) {
        const r = ROWS - 1 - i;
        if (r < 0) continue;
        out[r][c] = stack[i];
      }
    }
    return out;
  }, [state.columns]);

  // Convenient lookups.
  const totalTiles = useMemo(
    () => state.columns.reduce((acc, col) => acc + col.length, 0),
    [state.columns],
  );
  const danger = useMemo(
    () => state.columns.some((col) => col.length >= ROWS - 1),
    [state.columns],
  );

  // Remaining ms until the next row arrives, accounting for the fullness
  // pressure factor (board fills → cadence shrinks). Mirrors the
  // calculation the reducer uses inside TICK so the on-screen countdown
  // matches the actual arrival.
  const nextRowRemainingMs = useMemo(() => {
    if (state.phase !== 'playing') return state.rowInterval;
    const filled = totalTiles;
    const max = ROWS * COLS;
    const pressureF = 1 - 0.25 * (filled / max);
    const effective = state.rowInterval * pressureF;
    return Math.max(0, effective * (1 - state.rowProgress));
  }, [state.phase, state.rowInterval, state.rowProgress, totalTiles]);

  // ---------------- actions ----------------

  const start = useCallback(
    (difficulty) =>
      dispatch({ type: 'START_GAME', difficulty, now: Date.now() }),
    [],
  );

  const stop = useCallback(() => dispatch({ type: 'STOP_GAME' }), []);

  const reset = useCallback(() => dispatch({ type: 'RESET' }), []);

  const setDifficulty = useCallback(
    (difficulty) => dispatch({ type: 'SET_DIFFICULTY', difficulty }),
    [],
  );

  // ---- lifelines ----

  // BOMB: dispatch BOMB_START to mark exploding tiles + decrement uses,
  // then schedule BOMB_END after the explosion animation finishes so the
  // tiles actually get removed and gravity collapses what's left.
  const useBomb = useCallback(() => {
    if (state.bombUses <= 0) return false;
    const ids = bombTargetIds(state.columns);
    if (ids.length === 0) return false;
    dispatch({ type: 'BOMB_START' });
    setTimeout(() => {
      dispatch({ type: 'BOMB_END', ids });
    }, ANIM.tileExplode);
    return true;
  }, [state.bombUses, state.columns]);

  // COLLAPSE: synchronous repack — tiles glide to new positions via the
  // existing CSS transform transition. The reducer guards against
  // already-compact boards so we don't burn a use for no visible change.
  const useCollapse = useCallback(() => {
    if (state.collapseUses <= 0) return false;
    dispatch({ type: 'COLLAPSE' });
    return true;
  }, [state.collapseUses]);

  // Submits a path that already maps to letters. Returns true if accepted.
  // Validation: minimum length, dictionary membership.
  const submitPath = useCallback(
    (path, word) => {
      if (!dictionary || !path || path.length < MIN_WORD_LENGTH) {
        dispatch({ type: 'INVALID' });
        return false;
      }
      const lower = word.toLowerCase();
      if (!dictionary.has(lower)) {
        dispatch({ type: 'INVALID' });
        return false;
      }
      const ids = path.map((p) => p.id);
      dispatch({ type: 'CLEAR_START', ids });
      // Wait for the tile-clear animation to play before actually removing
      // tiles + collapsing columns. Using a slightly longer delay than the
      // raw animation so the squish/fade is fully visible.
      setTimeout(() => {
        dispatch({
          type: 'CLEAR_END',
          ids,
          word,
          now: Date.now(),
        });
      }, ANIM.tileClear);
      return true;
    },
    [dictionary],
  );

  return {
    // state
    phase: state.phase,
    difficulty: state.difficulty,
    columns: state.columns,
    grid,
    nextRow: state.nextRow,
    rowProgress: state.rowProgress,
    rowInterval: state.rowInterval,
    score: state.score,
    combo: state.combo,
    wordsCount: state.wordsCount,
    foundWords: state.foundWords,
    bestWord: state.bestWord,
    clearingIds: state.clearingIds,
    explodingIds: state.explodingIds,
    bombUses: state.bombUses,
    collapseUses: state.collapseUses,
    toasts: state.toasts,
    shakeKey: state.shakeKey,
    hardShakeKey: state.hardShakeKey,
    redFlashKey: state.redFlashKey,
    elapsedMs: state.elapsedMs,
    nextRowRemainingMs,
    totalTiles,
    danger,
    // actions
    start,
    stop,
    reset,
    setDifficulty,
    submitPath,
    useBomb,
    useCollapse,
  };
}
