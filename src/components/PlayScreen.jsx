import { useEffect, useMemo, useRef, useState } from 'react';
import { Board } from './Board.jsx';
import { LifelinePanel } from './LifelinePanel.jsx';
import { QuitButton } from './QuitButton.jsx';
import { Toasts } from './Toasts.jsx';
import { DIFFICULTY, MIN_WORD_LENGTH, ROWS } from '../game/constants.js';
import { useBoardGeometry } from '../hooks/useBoardGeometry.js';
import { useNarrowViewport } from '../hooks/useNarrowViewport.js';
import { findPath, isAdjacent, pathToWord } from '../game/path.js';
import { wordBasePoints } from '../game/scoring.js';

// Page layout note. The PlayScreen is **pinned to the viewport** on all
// sizes — `h-[100dvh] overflow-hidden` on the outer wrapper — so there
// is no full-page scrolling during gameplay. The Board always renders
// the full ROWS-tall grid; the middle row of the flex column is
// `overflow-y-auto`, so when the board is taller than the available
// space (mobile) only a slice is visible and the player scrolls within
// that slice. On desktop the board fits naturally and `overflow-y:auto`
// is a no-op.

// PlayScreen owns the *input* state for the round. There are two coexisting
// input modes that share a single `selection` path:
//
//   • Tile selection (drag OR tap) — the Board mutates `selection` via
//     callbacks. A drag commits on pointer-up; tap-mode commits on a re-tap
//     of the last selected tile, or on Enter.
//   • Keyboard typing — when the user types into the input field, we run
//     findPath against the grid and highlight the matching tiles. Enter
//     submits the typed word.
//
// Switching modes is automatic: any keystroke clears an in-flight tile
// selection ("typing wins"); any tap on a tile clears the typed string.
export function PlayScreen({ game, dictionary }) {
  const [typed, setTyped] = useState('');
  const [selection, setSelection] = useState([]);
  // One-shot session hint — first time the player builds a 3+ letter
  // selection without dragging, surface a tiny "tap last letter or use
  // ✓ to submit" affordance so the gesture is discoverable. Hidden once
  // the player commits any word, OR after the input clears.
  const [showSubmitHint, setShowSubmitHint] = useState(false);
  const submitHintShownRef = useRef(false);
  const inputRef = useRef(null);
  const boardAreaRef = useRef(null);
  const boardGeometry = useBoardGeometry(boardAreaRef);

  // Live path-find for the typed string (only when no tile selection is
  // active — selection takes visual priority).
  const typedPath = useMemo(() => {
    if (!typed || selection.length > 0) return [];
    return findPath(game.grid, typed) || [];
  }, [typed, game.grid, selection.length]);

  // Highlighted tile ids — preserves path order via Set insertion order.
  const selectedIds = useMemo(() => {
    const set = new Set();
    const path = selection.length > 0 ? selection : typedPath;
    for (const p of path) set.add(p.id);
    return set;
  }, [selection, typedPath]);

  // Input field shows the active word: selection letters when a tile path
  // is being built, otherwise the typed string.
  const currentInput = useMemo(() => {
    if (selection.length > 0) return pathToWord(selection, game.grid);
    return typed;
  }, [selection, typed, game.grid]);

  // Submit-button readiness:
  //   canSubmit  — clicking will at least *attempt* (length ≥ 3 AND a
  //                connected path exists for typed mode; selection mode
  //                is always realisable since the path was built that way).
  //   isValid    — the word is also in ENABLE, so the attempt will succeed
  //                and the button shows the "good" accent color.
  const canSubmit = useMemo(() => {
    if (currentInput.length < MIN_WORD_LENGTH) return false;
    if (selection.length > 0) return true;
    return typedPath.length === typed.length && typedPath.length > 0;
  }, [currentInput.length, selection.length, typedPath.length, typed.length]);

  const isValidWord = useMemo(() => {
    if (!canSubmit || !dictionary) return false;
    return dictionary.has(currentInput.toLowerCase());
  }, [canSubmit, dictionary, currentInput]);

  const narrow = useNarrowViewport();

  // Scrollable container that wraps the Board. On mobile the board is
  // taller than this region, so the user scrolls within it; on desktop
  // it fits and overflow-y:auto is a no-op.
  const boardScrollRef = useRef(null);
  const prevTotalTilesRef = useRef(0);

  // Game-start scroll-to-bottom. `useBoardGeometry` settles its
  // ResizeObserver asynchronously — the very first render uses the
  // default desktop tile size and the bottom-anchor scroll computed
  // from that is wrong by the time the observer updates to mobile
  // tile size. Scroll immediately + once more after a short delay so
  // the post-settle layout also lands at the bottom. Both scrolls
  // are `auto` (instant) because the player hasn't engaged yet.
  useEffect(() => {
    if (game.phase !== 'playing') return undefined;
    const el = boardScrollRef.current;
    if (!el) return undefined;
    el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
    const t = setTimeout(() => {
      el.scrollTo({ top: el.scrollHeight, behavior: 'auto' });
    }, 200);
    return () => clearTimeout(t);
  }, [game.phase]);

  // Row arrival mid-game — smoothly scroll to keep the new row visible.
  useEffect(() => {
    const el = boardScrollRef.current;
    if (!el) return;
    if (game.totalTiles > prevTotalTilesRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    }
    prevTotalTilesRef.current = game.totalTiles;
  }, [game.totalTiles]);

  // Out-of-view affordances. Track whether the board scroll container
  // has content above or below its visible region so we can render
  // small chevron chips as a "more letters this way" hint. Re-attach
  // the scroll listener whenever the board geometry changes
  // (scrollHeight changes with it).
  const [scrollMore, setScrollMore] = useState({ up: false, down: false });
  useEffect(() => {
    const el = boardScrollRef.current;
    if (!el) return undefined;
    const update = () => {
      setScrollMore({
        up: el.scrollTop > 4,
        down: el.scrollTop + el.clientHeight < el.scrollHeight - 4,
      });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [boardGeometry.tileSize]);

  // Live preview of the points this commit would award. Skips combo /
  // chain multipliers because they fire on the resulting clear, not on
  // the path itself — what the player sees here is the *base* word
  // value, which is what makes word-length tradeoffs legible. Only
  // shown when the word is in ENABLE so it doesn't lie about invalid
  // submissions.
  const potentialBase = useMemo(
    () => (isValidWord ? wordBasePoints(currentInput) : 0),
    [isValidWord, currentInput],
  );

  // First-time submit-hint trigger. Fire once per session when the player
  // first builds a 3-letter selection (drag landed in tap-mode, or pure
  // taps). Hidden once they actually commit a word.
  useEffect(() => {
    if (submitHintShownRef.current) return;
    if (selection.length >= MIN_WORD_LENGTH) {
      submitHintShownRef.current = true;
      setShowSubmitHint(true);
    }
  }, [selection.length]);

  // Grid mutated externally (clear, gravity, row arrival). Try to
  // *remap* the in-progress selection to the tiles' new positions
  // rather than blowing it away. We look each selected id up in the
  // current grid and:
  //   - if any id is missing (tile cleared by a word commit, bomb,
  //     etc.) → drop the whole selection;
  //   - else if any consecutive pair in the remapped path is no
  //     longer 8-adjacent (gravity rearranged columns under us) →
  //     drop the selection (the path isn't realisable anymore);
  //   - else → keep the selection with updated (row, col).
  //
  // For a pure row arrival every existing tile shifts up by exactly
  // one row, so adjacency is preserved and the player keeps their
  // in-progress tap-build.
  useEffect(() => {
    setSelection((prev) => {
      if (prev.length === 0) return prev;
      const remapped = [];
      for (const t of prev) {
        const pos = findTilePos(game.columns, t.id);
        if (!pos) return [];
        remapped.push({ id: t.id, row: pos.row, col: pos.col });
      }
      for (let i = 0; i < remapped.length - 1; i++) {
        if (!isAdjacent(remapped[i], remapped[i + 1])) return [];
      }
      // Skip the state update if nothing actually changed (the common
      // case when grid.useMemo recomputes without column mutation).
      const same =
        remapped.length === prev.length &&
        remapped.every(
          (t, i) => t.row === prev[i].row && t.col === prev[i].col,
        );
      return same ? prev : remapped;
    });
  }, [game.columns]);

  // Bouncing out of the play phase clears everything.
  useEffect(() => {
    if (game.phase !== 'playing') {
      setTyped('');
      setSelection([]);
    }
  }, [game.phase]);

  // Keep the keyboard input focused so typing-only play needs no clicks.
  // Skipped on narrow viewports — the input is hidden there (mobile uses
  // pure tap/drag), and focusing it would pop the on-screen keyboard and
  // chew up half the screen for nothing.
  useEffect(() => {
    if (game.phase !== 'playing') return;
    if (typeof window !== 'undefined' && window.innerWidth < 640) return;
    inputRef.current?.focus();
  }, [game.phase]);

  // Window-level keydown listener — runs only during `phase === 'playing'`
  // and only when the input isn't focused (desktop's <input> has its own
  // onKeyDown for Enter/Escape; we'd double-fire if both ran).
  //
  // Handles four cases:
  //   • letter keys → focus the input + inject the letter (browsers
  //     drop the keystroke that initiates focus, so we re-emit it)
  //   • Enter      → submit current selection/typed
  //   • Backspace  → pop last tile (or last typed char if no selection)
  //   • Escape     → clear everything
  //
  // Enter/Backspace fall through to the focused element when there's
  // nothing to submit/pop, so a focused button (e.g. lifeline) can still
  // be activated via the keyboard.
  //
  // Refs stash the latest values + the latest handleEnter so the listener
  // never re-attaches mid-game and never reads stale state.
  const liveRef = useRef({ typed, selectionLen: selection.length });
  liveRef.current = { typed, selectionLen: selection.length };
  const handleEnterRef = useRef(() => {});

  useEffect(() => {
    if (game.phase !== 'playing') return undefined;
    const handler = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.activeElement === inputRef.current) return;

      if (e.key === 'Enter') {
        const { selectionLen, typed: prevTyped } = liveRef.current;
        if (selectionLen === 0 && prevTyped.length === 0) return;
        e.preventDefault();
        handleEnterRef.current?.();
        return;
      }
      if (e.key === 'Backspace') {
        const { selectionLen, typed: prevTyped } = liveRef.current;
        if (selectionLen === 0 && prevTyped.length === 0) return;
        e.preventDefault();
        if (selectionLen > 0) {
          setSelection((prev) => prev.slice(0, -1));
        } else {
          setTyped(prevTyped.slice(0, -1));
        }
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSelection([]);
        setTyped('');
        return;
      }

      if (e.key.length !== 1 || !/^[a-zA-Z]$/.test(e.key)) return;
      e.preventDefault();
      const { typed: prevTyped, selectionLen } = liveRef.current;
      const base = selectionLen > 0 ? '' : prevTyped;
      const ch = e.key.toUpperCase();
      // setSelection inside handleTypedChange drops any tile selection.
      handleTypedChange(base + ch);
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // handleTypedChange / handleEnter are accessed via refs so they're
    // always current; we only rebind the listener on phase changes so
    // it's gone on idle/gameover screens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.phase]);

  // ---- commit handlers ----

  const commitSelection = () => {
    if (selection.length < MIN_WORD_LENGTH) {
      // Too-short selection — fail the submit so the board shakes, and
      // clear so the player can start over.
      if (selection.length > 0) game.submitPath(null, '');
      setSelection([]);
      return;
    }
    const word = pathToWord(selection, game.grid);
    game.submitPath(selection, word);
    setSelection([]);
    setTyped('');
    setShowSubmitHint(false);
  };

  const commitTyped = () => {
    if (typedPath.length === 0 || typedPath.length !== typed.length) {
      // No realisable path or typed string had non-letter chars filtered.
      game.submitPath(null, typed);
      return;
    }
    const word = pathToWord(typedPath, game.grid);
    if (game.submitPath(typedPath, word)) {
      setTyped('');
      setShowSubmitHint(false);
    }
  };

  const handleEnter = () => {
    if (selection.length > 0) commitSelection();
    else commitTyped();
  };
  // Stash the latest handleEnter so the once-attached window keydown
  // listener always calls the current version (rather than the closure
  // from the first render).
  handleEnterRef.current = handleEnter;

  const handleTypedChange = (raw) => {
    // Typing always wins — drop any in-flight tile selection so the input
    // becomes the source of truth.
    if (selection.length > 0) setSelection([]);
    setTyped(raw.toUpperCase().replace(/[^A-Z]/g, ''));
  };

  const cfg = DIFFICULTY[game.difficulty];

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden flex flex-col px-2 py-2 sm:px-6 sm:py-6">
      {/* Pinned-to-viewport play surface. The outer wrapper is exactly
          one viewport tall and clips overflow, so the page never
          scrolls — only the middle board-scroll container does. */}
      <div className="max-w-3xl mx-auto w-full flex flex-col flex-1 min-h-0 gap-1.5 sm:gap-5">
        {/* ============================================================
            MOBILE — three-column HUD: timer · score · stop.
            Grid layout so the score sits at the geometric *center*
            of the screen rather than between two flex siblings of
            unequal width. Lifelines + ✓ live in the control strip
            below the board.
            ============================================================ */}
        <div className="grid sm:hidden shrink-0 grid-cols-3 items-center px-1">
          <div className="justify-self-start">
            <Pill>
              <ClockIcon />
              <span className="font-mono text-base font-semibold tabular-nums">
                {formatTime(game.elapsedMs)}
              </span>
            </Pill>
          </div>
          <div className="justify-self-center font-display font-extrabold text-2xl text-primary-800 leading-none tabular-nums">
            {game.score}
          </div>
          <div className="justify-self-end">
            <QuitButton onClick={game.stop} />
          </div>
        </div>

        {/* Mobile-only floating word display — sits between HUD and board.
            Fades opacity in/out so it doesn't reserve visual weight when
            there's no selection. Shows the live base score when the word
            is in ENABLE (combo / chain multipliers fire on the resulting
            clear, not the path itself, so the base is what gives the
            player a length-tradeoff signal). */}
        <div
          className="sm:hidden h-6 flex items-center justify-center gap-2 pointer-events-none transition-opacity duration-150"
          style={{ opacity: currentInput ? 1 : 0 }}
          aria-hidden={!currentInput}
        >
          <span className="font-display font-extrabold text-lg tracking-[0.2em] text-primary-800 leading-none">
            {currentInput || ' '}
          </span>
          {potentialBase > 0 && (
            <span className="font-display font-extrabold text-sm text-good leading-none">
              +{potentialBase}
            </span>
          )}
        </div>

        {/* ============================================================
            DESKTOP — original two-group header.
            ============================================================ */}
        <div className="hidden sm:flex shrink-0 items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Pill>
              <ClockIcon />
              <span className="font-mono text-xl font-semibold tabular-nums">
                {formatTime(game.elapsedMs)}
              </span>
            </Pill>
            <div className="rounded-xl bg-paper border border-border px-3 py-2 shadow-sm">
              <div className="font-label text-[10px] tracking-widest uppercase text-ink-500">
                Difficulty
              </div>
              <div className="text-base font-semibold capitalize text-ink-900 leading-tight">
                {cfg.label}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <Stat value={game.score} label="Score" tone="primary" big />
            <Stat value={game.wordsCount} label="Words" />
            <QuitButton onClick={game.stop} />
          </div>
        </div>

        {/* Input + Board + Next-row stack — board grows into remaining viewport height. */}
        {/* Word input + submit button — DESKTOP ONLY.
            Mobile has no input or word card; the ✓ lives as a FAB on
            the board's bottom-right corner (see below). Focusing an
            <input> on a phone summons the OS keyboard, which eats half
            the screen for nothing when input is via tap/drag. */}
        <div className="hidden sm:flex shrink-0 flex-col items-center gap-4 sm:gap-5">
          <div className="w-full max-w-sm flex flex-col items-center gap-1">
            <div className="rounded-2xl bg-paper border border-border shadow-md pl-4 pr-2 py-2 w-full flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={currentInput}
                onChange={(e) => handleTypedChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleEnter();
                  } else if (e.key === 'Escape') {
                    setTyped('');
                    setSelection([]);
                  }
                }}
                placeholder="Create words"
                className="flex-1 min-w-0 text-xl sm:text-2xl font-semibold text-center tracking-[0.18em] outline-none placeholder:text-ink-400"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="characters"
                spellCheck="false"
                inputMode="text"
              />
              <SubmitButton
                enabled={canSubmit}
                valid={isValidWord}
                onClick={handleEnter}
              />
            </div>
            {/* One-shot affordance for tap-mode players who haven't yet
                discovered Enter / re-tap-last / the new ✓ button. */}
            <div
              className="text-[11px] text-ink-500 font-label tracking-wide h-4 transition-opacity"
              style={{ opacity: showSubmitHint ? 1 : 0 }}
              aria-hidden={!showSubmitHint}
            >
              Tap <span className="font-semibold text-primary-800">✓</span> or the last letter again to submit
            </div>
          </div>
        </div>

        {/* Board area. `relative flex-1` parent so we can overlay
            chevron chips above/below the scroll container — they hint
            at out-of-view rows without consuming layout space. */}
        <div className="relative flex-1 min-h-0 sm:min-h-[200px]">
          {/* Scroll container. `overflow-y-auto` scrolls when content
              (the full 10-row board) is taller than the region — i.e.
              mobile. Desktop content fits and this is a no-op.
              `overscroll-contain` keeps the page from bouncing /
              triggering pull-to-refresh outside this region. */}
          <div
            ref={(node) => {
              boardAreaRef.current = node;
              boardScrollRef.current = node;
            }}
            className="absolute inset-0 overflow-y-auto overscroll-contain flex items-start sm:items-center justify-center py-1"
          >
            <div className="relative inline-block">
              <Board
                geometry={boardGeometry}
                grid={game.grid}
                columns={game.columns}
                selection={selection}
                selectedIds={selectedIds}
                clearingIds={game.clearingIds}
                explodingIds={game.explodingIds}
                scramblingIds={game.scramblingIds}
                danger={game.danger}
                shakeKey={game.shakeKey}
                hardShakeKey={game.hardShakeKey}
                redFlashKey={game.redFlashKey}
                onSelectionChange={setSelection}
                onCommit={commitSelection}
              />
              {/* Desktop sidecar lifelines only — mobile renders them
                  in a dedicated control row below the board. */}
              <div className="hidden sm:absolute sm:top-1/2 sm:left-full sm:ml-4 sm:flex sm:-translate-y-1/2">
                <LifelinePanel
                  bombUses={game.bombUses}
                  collapseUses={game.collapseUses}
                  scrambleUses={game.scrambleUses}
                  onBomb={game.useBomb}
                  onCollapse={game.useCollapse}
                  onScramble={game.useScramble}
                />
              </div>
            </div>
          </div>

          {/* "More letters this way" affordances. Pointer-events: none
              so they don't intercept touches. Fade in/out via opacity
              so there's no layout shift. */}
          <ScrollAffordance position="top" visible={scrollMore.up} />
          <ScrollAffordance position="bottom" visible={scrollMore.down} />
        </div>

        {/* Mobile-only control strip — lifelines on the left, ✓ on the
            right. Lives BETWEEN the board and the progress bar so the
            board stays a pure interaction surface (no controls adjacent
            to live tiles → no accidental taps during drag-select).
            All three buttons are 56×56 so the touch targets read as
            gameplay abilities, not utility chrome. */}
        <div className="flex sm:hidden shrink-0 items-center justify-between gap-3 px-1">
          <LifelinePanel
            compact
            bombUses={game.bombUses}
            collapseUses={game.collapseUses}
            scrambleUses={game.scrambleUses}
            onBomb={game.useBomb}
            onCollapse={game.useCollapse}
            onScramble={game.useScramble}
          />
          <SubmitButton
            large
            enabled={canSubmit}
            valid={isValidWord}
            onClick={handleEnter}
          />
        </div>

        <div className="flex shrink-0 flex-col items-center gap-4 sm:gap-5">
          {/* Next-row preview + arrival progress + countdown */}
          <div className="w-full max-w-sm space-y-2">
          {/* Next-row countdown bar. **Depletes** from full → empty
              as rowProgress climbs, so it reads as a clear countdown
              alongside the "8s" text. We use a `scaleX` transform
              instead of animating `width` because the bar receives a
              new target every rAF tick — width transitions thrash
              layout and get starved on busy browsers (the bar can
              visually freeze even when the inline style is updating
              in the DOM), whereas scaleX runs on the compositor
              thread and stays smooth. Single color (warn → danger
              when the board is near overflow) keeps the visual story
              simple. */}
          <div className="h-2 rounded-full bg-ink-300/60 overflow-hidden">
            <div
              className={[
                'h-full w-full origin-left',
                game.danger ? 'bg-danger-500' : 'bg-warn-500',
              ].join(' ')}
              style={{
                transform: `scaleX(${Math.max(0, 1 - Math.min(1, game.rowProgress))})`,
                transition: 'transform 80ms linear',
                willChange: 'transform',
              }}
            />
          </div>
          <div className="flex justify-center" aria-hidden>
            {/* Mobile preview is intentionally smaller (40×30) with a
                lower opacity so it reads as "incoming, low-priority info"
                rather than competing with the real board tiles. Desktop
                keeps the board-tile-sized preview. */}
            <div
              className={[
                'grid grid-flow-col gap-1.5',
                narrow ? 'opacity-50' : 'opacity-60',
              ].join(' ')}
              style={{
                gridAutoColumns: `${narrow ? 40 : boardGeometry.tileSize}px`,
              }}
            >
              {game.nextRow.map((letter, idx) => (
                <div
                  key={idx}
                  className="rounded-lg bg-surface-soft border border-border flex items-center justify-center font-display font-extrabold text-ink-500"
                  style={{
                    width: narrow ? 40 : boardGeometry.tileSize,
                    height: narrow ? 30 : Math.round(boardGeometry.tileSize * 0.7),
                    fontSize: narrow
                      ? 14
                      : Math.min(18, Math.round(14 + boardGeometry.tileSize * 0.09)),
                  }}
                >
                  {letter}
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center gap-2 font-label text-[11px] tracking-widest uppercase text-ink-500">
            <span>Next Row</span>
            <span aria-hidden className="text-ink-400">·</span>
            <span
              className={[
                'font-mono normal-case tracking-normal tabular-nums',
                game.danger ? 'text-danger-600 font-semibold' : '',
              ].join(' ')}
            >
              {formatCountdown(game.nextRowRemainingMs)}
            </span>
          </div>
          </div>
        </div>
      </div>

      {/* Toasts overlay — sits OUTSIDE the board scroll region so it
          stays anchored to the viewport even as the player scrolls.
          Centered over the play surface. */}
      <Toasts toasts={game.toasts} />
    </div>
  );
}

// Chevron chip rendered at the top or bottom of the board scroll
// region when there are tiles out of view in that direction. Lives
// outside the scroll container (in its relative parent) so it stays
// anchored to the viewport edge even as the player scrolls.
function ScrollAffordance({ position, visible }) {
  return (
    <div
      className={[
        'pointer-events-none absolute left-0 right-0 flex justify-center transition-opacity duration-150 z-10',
        position === 'top' ? 'top-1' : 'bottom-1',
        visible ? 'opacity-100' : 'opacity-0',
      ].join(' ')}
      aria-hidden
    >
      <div className="bg-paper/90 border border-border rounded-full px-1.5 py-1 shadow-sm text-ink-500">
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {position === 'top' ? (
            <polyline points="6 15 12 9 18 15" />
          ) : (
            <polyline points="6 9 12 15 18 9" />
          )}
        </svg>
      </div>
    </div>
  );
}

// Locate a tile's current (row, col) in the per-column stacks by its
// stable id, or null if the tile no longer exists on the board. Used
// by PlayScreen to remap an in-progress tap selection through row
// arrivals and gravity. Indices in `columns[c]` are bottom-up, so the
// derived row is `ROWS - 1 - i`.
function findTilePos(columns, id) {
  for (let c = 0; c < columns.length; c++) {
    const stack = columns[c];
    for (let i = 0; i < stack.length; i++) {
      if (stack[i].id === id) {
        return { row: ROWS - 1 - i, col: c };
      }
    }
  }
  return null;
}

// Countdown for the "Next Row" label. Shows whole seconds when ≥ 3, one
// decimal when < 3 so the final stretch reads as urgent without flicker.
function formatCountdown(ms) {
  const s = ms / 1000;
  if (s < 3) return `${Math.max(0, s).toFixed(1)}s`;
  return `${Math.ceil(s)}s`;
}

// ----- small layout helpers -----

function Pill({ children }) {
  return (
    <div className="flex items-center gap-2 bg-paper border border-border rounded-xl px-3 py-2 shadow-sm">
      {children}
    </div>
  );
}

function Stat({ value, label, tone = 'default', big = false }) {
  return (
    <div className="text-right">
      <div
        className={[
          'font-display font-extrabold leading-none',
          big ? 'text-3xl sm:text-5xl' : 'text-xl sm:text-3xl',
          tone === 'primary' ? 'text-primary-800' : 'text-ink-900',
        ].join(' ')}
      >
        {value}
      </div>
      <div className="font-label text-[9px] sm:text-[10px] tracking-widest uppercase text-ink-500 mt-1">
        {label}
      </div>
    </div>
  );
}

// Submit-word button. Three visual states keyed off (enabled, valid):
//
//   (false, _)    — disabled grey: input too short, or typed string has
//                   no realisable path on the board.
//   (true, false) — primary navy: clickable, but the word isn't in
//                   ENABLE so the attempt will shake on submit.
//   (true, true)  — success green: clickable, word is in ENABLE, will
//                   actually score.
//
// Sized for mobile touch (36×36 inside the desktop input card; 56×56
// FAB variant on mobile, anchored to the board corner) and reachable
// via Tab + Enter for keyboard users.
function SubmitButton({ enabled, valid, onClick, large = false }) {
  const colorClass = !enabled
    ? 'bg-surface-soft text-ink-400 cursor-not-allowed border border-border'
    : valid
      ? 'bg-good text-paper hover:brightness-110 active:scale-95 shadow-lg shadow-good/40'
      : 'bg-primary-800 text-paper hover:bg-primary-900 active:scale-95 shadow-lg shadow-primary-800/40';
  const sizing = large
    ? 'w-14 h-14 rounded-2xl'
    : 'w-9 h-9 rounded-xl';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      aria-label="Submit word"
      title="Submit word (Enter)"
      tabIndex={0}
      className={[
        'shrink-0 flex items-center justify-center transition',
        sizing,
        colorClass,
      ].join(' ')}
    >
      <CheckIcon size={large ? 28 : 18} />
    </button>
  );
}

function CheckIcon({ size = 18 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="5 12 10 17 19 7" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink-500">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
