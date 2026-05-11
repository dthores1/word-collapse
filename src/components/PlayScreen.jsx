import { useEffect, useMemo, useRef, useState } from 'react';
import { Board } from './Board.jsx';
import { LifelinePanel } from './LifelinePanel.jsx';
import { Toasts } from './Toasts.jsx';
import { DIFFICULTY, MIN_WORD_LENGTH } from '../game/constants.js';
import { useBoardGeometry } from '../hooks/useBoardGeometry.js';
import { findPath, pathToWord } from '../game/path.js';

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
  useEffect(() => {
    if (game.phase === 'playing') inputRef.current?.focus();
  }, [game.phase]);

  // Global auto-focus: any letter keypress while the input is unfocused
  // pulls focus to it AND injects the letter (since the keystroke that
  // started focus doesn't reliably reach a newly-focused element). We use
  // a ref-stash so the listener never re-attaches mid-game.
  const liveRef = useRef({
    typed,
    selectionLen: selection.length,
  });
  liveRef.current = { typed, selectionLen: selection.length };

  useEffect(() => {
    if (game.phase !== 'playing') return undefined;
    const handler = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.activeElement === inputRef.current) return;
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
    // handleTypedChange is stable enough for this; we still re-bind on
    // phase changes so the listener is gone on idle/gameover screens.
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

  const handleTypedChange = (raw) => {
    // Typing always wins — drop any in-flight tile selection so the input
    // becomes the source of truth.
    if (selection.length > 0) setSelection([]);
    setTyped(raw.toUpperCase().replace(/[^A-Z]/g, ''));
  };

  const cfg = DIFFICULTY[game.difficulty];

  return (
    <div className="min-h-[100dvh] w-full flex flex-col px-4 py-4 sm:px-6 sm:py-6">
      <div className="max-w-3xl mx-auto w-full flex flex-col flex-1 min-h-0 gap-4 sm:gap-5">
        {/* Header — clock, difficulty, score, words, stop */}
        <div className="flex shrink-0 items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Pill>
              <ClockIcon />
              <span className="font-mono text-lg sm:text-xl font-semibold tabular-nums">
                {formatTime(game.elapsedMs)}
              </span>
            </Pill>
            <div className="rounded-xl bg-paper border border-border px-3 py-2 shadow-sm">
              <div className="font-label text-[10px] tracking-widest uppercase text-ink-500">
                Difficulty
              </div>
              <div className="font-semibold capitalize text-ink-900 leading-tight">
                {cfg.label}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 sm:gap-6">
            <Stat value={game.score} label="Score" tone="primary" big />
            <Stat value={game.wordsCount} label="Words" />
            <button
              type="button"
              onClick={game.stop}
              className="w-11 h-11 rounded-full bg-danger-500 hover:bg-danger-600 active:bg-danger-700 flex items-center justify-center shadow-lg shadow-danger-500/40 transition"
              aria-label="Stop game"
              title="Stop game"
            >
              <StopIcon />
            </button>
          </div>
        </div>

        {/* Input + Board + Next-row stack — board grows into remaining viewport height. */}
        <div className="flex shrink-0 flex-col items-center gap-4 sm:gap-5">
          {/* Word input + submit button */}
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

        {/* Board with lifelines floated off the right edge — fills leftover vertical space */}
        <div
          ref={boardAreaRef}
          className="flex min-h-[200px] min-w-0 flex-1 items-center justify-center py-1"
        >
          <div className="relative flex flex-col items-center gap-4 sm:inline-block sm:gap-0">
            <div className="relative inline-block">
              <Board
                geometry={boardGeometry}
                grid={game.grid}
                columns={game.columns}
                selection={selection}
                selectedIds={selectedIds}
                clearingIds={game.clearingIds}
                explodingIds={game.explodingIds}
                danger={game.danger}
                shakeKey={game.shakeKey}
                hardShakeKey={game.hardShakeKey}
                redFlashKey={game.redFlashKey}
                onSelectionChange={setSelection}
                onCommit={commitSelection}
              />
              <Toasts toasts={game.toasts} />
            </div>
            <div className="flex w-full justify-center sm:absolute sm:top-1/2 sm:left-full sm:ml-4 sm:w-auto sm:-translate-y-1/2">
              <LifelinePanel
                bombUses={game.bombUses}
                collapseUses={game.collapseUses}
                onBomb={game.useBomb}
                onCollapse={game.useCollapse}
              />
            </div>
          </div>
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
            <div
              className="grid grid-flow-col gap-1.5 opacity-60"
              style={{ gridAutoColumns: `${boardGeometry.tileSize}px` }}
            >
              {game.nextRow.map((letter, idx) => (
                <div
                  key={idx}
                  className="rounded-xl bg-surface-soft border border-border flex items-center justify-center font-display font-extrabold text-ink-500"
                  style={{
                    width: boardGeometry.tileSize,
                    height: Math.round(boardGeometry.tileSize * 0.7),
                    fontSize: Math.min(18, Math.round(14 + boardGeometry.tileSize * 0.09)),
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
          big ? 'text-4xl sm:text-5xl' : 'text-2xl sm:text-3xl',
          tone === 'primary' ? 'text-primary-800' : 'text-ink-900',
        ].join(' ')}
      >
        {value}
      </div>
      <div className="font-label text-[10px] tracking-widest uppercase text-ink-500 mt-1">
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
// Sized for mobile touch (36×36 inside a 32×32 padded input card) and
// reachable via Tab + Enter for keyboard users.
function SubmitButton({ enabled, valid, onClick }) {
  const colorClass = !enabled
    ? 'bg-surface-soft text-ink-300 cursor-not-allowed'
    : valid
      ? 'bg-good text-paper hover:brightness-110 active:scale-95 shadow-md shadow-good/30'
      : 'bg-primary-800 text-paper hover:bg-primary-900 active:scale-95 shadow-md shadow-primary-800/30';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!enabled}
      aria-label="Submit word"
      title="Submit word (Enter)"
      tabIndex={0}
      className={[
        'shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition',
        colorClass,
      ].join(' ')}
    >
      <CheckIcon />
    </button>
  );
}

function CheckIcon() {
  return (
    <svg
      width="18"
      height="18"
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
