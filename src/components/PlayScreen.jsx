import { useEffect, useMemo, useRef, useState } from 'react';
import { Board } from './Board.jsx';
import { LifelinePanel } from './LifelinePanel.jsx';
import { Toasts } from './Toasts.jsx';
import { DIFFICULTY, MIN_WORD_LENGTH, ROWS } from '../game/constants.js';
import { useBoardGeometry } from '../hooks/useBoardGeometry.js';
import { findPath, pathToWord } from '../game/path.js';
import { wordBasePoints } from '../game/scoring.js';

// Mobile viewport. The board is logically ROWS tall; on mobile we
// render a bottom-anchored window that starts at MIN rows (when
// columns are short) and **grows upward** to fit taller columns
// plus BUFFER rows of planning space above the topmost tile. Row 9
// (where new arrivals enter) is therefore always visible — the
// bug-free invariant we get for free by anchoring the bottom rather
// than sliding.
//
//   viewportRows = clamp(maxColHeight + BUFFER, MIN, ROWS)
//   viewportTop  = ROWS - viewportRows
//
// Worked examples (MIN=5, BUFFER=2):
//   maxHeight 0–3 → viewport 5 rows  (rows 5–9, game-start compact)
//   maxHeight 4   → viewport 6 rows  (rows 4–9)
//   maxHeight 5   → viewport 7 rows  (rows 3–9)
//   maxHeight 6   → viewport 8 rows  (rows 2–9)
//   maxHeight 7   → viewport 9 rows  (rows 1–9)
//   maxHeight 8+  → viewport 10 rows (rows 0–9, full board)
//
// The card grows downward in the page flow as `viewportRows` climbs,
// pushing the next-row preview lower. Acceptable: by the time the
// growth happens the player is in late-game pressure mode and the
// board is the only thing they're looking at.
const MOBILE_VIEWPORT_MIN_ROWS = 5;
const MOBILE_VIEWPORT_BUFFER = 2;
const NARROW_BREAKPOINT_PX = 640;

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

  // Viewport parameters for the Board. Logically the board is still
  // ROWS tall (overflow check, gravity, path finding all use the full
  // grid) — these props only control which slice of it is rendered.
  //
  //   Desktop:  viewportRows=ROWS, viewportTop=0  — show everything.
  //   Mobile:   bottom-anchored, grows upward — see comment block
  //             at the top of this file for the worked examples.
  const narrow = useNarrowViewport();
  const { viewportRows, viewportTop } = useMemo(() => {
    if (!narrow) return { viewportRows: ROWS, viewportTop: 0 };
    const maxHeight = game.columns.reduce(
      (acc, col) => Math.max(acc, col.length),
      0,
    );
    const rows = Math.min(
      ROWS,
      Math.max(MOBILE_VIEWPORT_MIN_ROWS, maxHeight + MOBILE_VIEWPORT_BUFFER),
    );
    return { viewportRows: rows, viewportTop: ROWS - rows };
  }, [narrow, game.columns]);

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

  // Grid mutated externally (clear / arrival) → any in-progress selection
  // is now stale (tiles may have moved or vanished). Reset.
  useEffect(() => {
    setSelection([]);
  }, [game.grid]);

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
    <div className="min-h-[100dvh] w-full px-2 py-2 sm:px-6 sm:py-6 sm:flex sm:flex-col">
      {/* Page-level layout: on mobile we allow natural document flow so the
          board can grow into a larger width-driven size and the page can
          scroll vertically when needed. On desktop the flex-column with
          flex-1 children keeps everything fit-to-viewport. */}
      <div className="max-w-3xl mx-auto w-full flex flex-col gap-1.5 sm:flex-1 sm:min-h-0 sm:gap-5">
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
          <button
            type="button"
            onClick={game.stop}
            className="justify-self-end w-9 h-9 shrink-0 rounded-full bg-danger-500 hover:bg-danger-600 active:bg-danger-700 flex items-center justify-center shadow-md shadow-danger-500/40 transition"
            aria-label="Stop game"
            title="Stop game"
          >
            <StopIcon />
          </button>
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
            <button
              type="button"
              onClick={game.stop}
              className="w-11 h-11 shrink-0 rounded-full bg-danger-500 hover:bg-danger-600 active:bg-danger-700 flex items-center justify-center shadow-lg shadow-danger-500/40 transition"
              aria-label="Stop game"
              title="Stop game"
            >
              <StopIcon />
            </button>
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

        {/* Board area. On desktop the lifelines float as a vertical
            sidecar to the right of the board; on mobile the lifelines
            live in the top action bar so the board takes the full
            horizontal slot here. */}
        <div
          ref={boardAreaRef}
          className="flex min-w-0 items-center justify-center py-1 sm:min-h-[200px] sm:flex-1"
        >
          <div className="relative sm:inline-block">
            <div className="relative inline-block">
              <Board
                geometry={boardGeometry}
                grid={game.grid}
                columns={game.columns}
                viewportRows={viewportRows}
                topRow={viewportTop}
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
              <Toasts toasts={game.toasts} />
            </div>
            {/* Desktop sidecar lifelines only — mobile renders them in
                a dedicated control row below the board (see below). */}
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
          <div className="h-2 rounded-full bg-ink-300/60 overflow-hidden">
            <div
              className={[
                'h-full',
                game.danger
                  ? 'bg-gradient-to-r from-danger-500 to-danger-600'
                  : 'bg-gradient-to-r from-warn-500 to-danger-500',
              ].join(' ')}
              style={{
                width: `${Math.min(100, game.rowProgress * 100)}%`,
                transition: 'width 80ms linear',
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
    </div>
  );
}

// Tracks whether the viewport is in the "narrow" (mobile) regime —
// kept in sync with a `matchMedia` listener so a rotation or window
// resize re-renders the play screen and switches the board between
// the desktop full-board layout and the mobile sliding viewport.
function useNarrowViewport() {
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.innerWidth < NARROW_BREAKPOINT_PX;
  });
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const mq = window.matchMedia(`(max-width: ${NARROW_BREAKPOINT_PX - 1}px)`);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  return narrow;
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

function StopIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-paper">
      <circle cx="12" cy="12" r="9" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  );
}

function formatTime(ms) {
  const total = Math.floor(ms / 1000);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}
