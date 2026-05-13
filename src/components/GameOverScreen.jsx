import { useMemo, useState } from 'react';
import { useNarrowViewport } from '../hooks/useNarrowViewport.js';

const DIFFICULTY_LABELS = {
  chill: 'Chill',
  standard: 'Standard',
  frenzy: 'Frenzy',
};

// =====================================================================
// GameOverScreen
//
// Information hierarchy (top → bottom):
//   1. Outcome      — GAME OVER + score
//   2. Stats        — three tiles: Words / Best Word / Rank
//   3. Meaning      — small "★ NEW PERSONAL BEST" callout when relevant
//   4. Save flow    — name input + Save (only when the score qualifies
//                     for the top 10 and hasn't been submitted yet)
//   5. Next action  — Play Again (primary), Main Menu (secondary)
//   6. Deeper info  — Leaderboard + Words Found, collapsible. Closed by
//                     default on mobile to keep the replay CTA above
//                     the fold; open by default on desktop where the
//                     real estate is there.
//
// The third stat tile is **rank**, not "NEW". Quantitative, consistent
// with the other two tiles, and emotionally consequential ("#4 ALL TIME"
// gives the run identity). The "NEW PERSONAL BEST" cue is moved to a
// small inline badge so it doesn't consume a full tile.
// =====================================================================

export function GameOverScreen({
  difficulty,
  score,
  wordsCount,
  bestWord,
  foundWords,
  highScore,
  isHighScore,
  onPlayAgain,
  onMainMenu,
  onSubmit,
  leaderboard,
  lastName,
}) {
  const [name, setName] = useState(lastName || '');
  const [saved, setSaved] = useState(false);
  const narrow = useNarrowViewport();

  const qualifies = leaderboard.qualifies(score);
  const showNamePrompt =
    qualifies && !saved && !leaderboard.submittedEntry;

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaved(true);
    const result = await onSubmit(trimmed);
    if (!result) setSaved(false);
  };

  // Player's rank on the live leaderboard. Prefers the just-submitted
  // entry's position; pre-submit (or didn't qualify) falls back to
  // counting how many existing entries beat them. `null` means we can't
  // place them (loading, error, or below the 10th-place cutoff).
  const rank = useMemo(
    () =>
      computeRank({
        score,
        entries: leaderboard.entries,
        submittedEntry: leaderboard.submittedEntry,
        loading: leaderboard.loading,
        error: leaderboard.error,
      }),
    [
      score,
      leaderboard.entries,
      leaderboard.submittedEntry,
      leaderboard.loading,
      leaderboard.error,
    ],
  );

  const rankDisplay = rank != null && rank <= 10 ? `#${rank}` : '—';
  const rankLabel = rank != null && rank <= 10 ? 'Rank' : 'Top 10';

  return (
    <div className="min-h-screen w-full flex items-start sm:items-center justify-center px-3 py-4 sm:px-4 sm:py-8">
      <div className="max-w-2xl w-full bg-paper border border-border rounded-3xl p-4 sm:p-12 shadow-2xl space-y-4 sm:space-y-7">
        {/* 1. Outcome */}
        <div className="text-center space-y-2">
          <div className="font-label text-xs tracking-widest uppercase text-ink-500">
            Game Over
          </div>
          <div className="font-display font-extrabold text-5xl sm:text-7xl tracking-tight leading-none">
            {score} <span className="text-ink-400 text-3xl sm:text-5xl">pts</span>
          </div>
        </div>

        {/* 2. Stats */}
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          <SummaryCard value={wordsCount} label="Words" />
          <SummaryCard value={bestWord || '—'} label="Best Word" />
          <SummaryCard value={rankDisplay} label={rankLabel} highlight={rank === 1} />
        </div>

        {/* 3. Meaning — small celebratory callout, not a tile */}
        {isHighScore && (
          <div className="flex justify-center">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-secondary-50 border border-secondary-500/40 px-3 py-1 text-xs font-label tracking-widest uppercase text-primary-800">
              <StarIcon /> New Personal Best
            </div>
          </div>
        )}

        {/* 4. Save flow */}
        {showNamePrompt && (
          <div className="space-y-2">
            <div className="text-center text-sm font-semibold text-ink-900">
              You made the top 10! Save your name:
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                placeholder="Your name"
                maxLength={20}
                disabled={leaderboard.submitting}
                className="w-full sm:flex-1 min-w-0 px-4 py-2.5 rounded-2xl border-2 border-secondary-500 text-base outline-none focus:ring-2 focus:ring-secondary-500/40 disabled:opacity-60"
                autoFocus={!narrow}
              />
              <button
                type="button"
                onClick={handleSave}
                disabled={leaderboard.submitting || !name.trim()}
                className="w-full sm:w-auto px-6 py-2.5 bg-primary-800 hover:bg-primary-900 active:bg-primary-950 text-paper font-semibold rounded-2xl transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {leaderboard.submitting ? 'Saving…' : 'Save'}
              </button>
            </div>
            {leaderboard.submitError && (
              <div className="text-center text-xs text-danger-600">
                Couldn't save your score. Check your connection and try again.
              </div>
            )}
          </div>
        )}

        {/* 5. Next action — Play Again first, immediate and unmissable */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
          <button
            type="button"
            onClick={onPlayAgain}
            className="flex-1 bg-primary-800 hover:bg-primary-900 active:bg-primary-950 text-paper font-display font-bold text-lg sm:text-xl py-3.5 sm:py-4 rounded-full shadow-lg shadow-primary-800/30 transition"
          >
            Play again
          </button>
          <button
            type="button"
            onClick={onMainMenu}
            className="flex-1 bg-paper text-primary-800 font-display font-bold text-base sm:text-xl py-3 sm:py-4 rounded-full border-2 border-border hover:border-primary-800 transition"
          >
            Main Menu
          </button>
        </div>

        {/* 6. Deeper info — collapsible on mobile, open on desktop */}
        <CollapsibleSection
          label={`Top 10 — ${DIFFICULTY_LABELS[difficulty] || difficulty}`}
          defaultOpen={!narrow}
        >
          <Leaderboard
            leaderboard={leaderboard}
            playerScore={score}
          />
        </CollapsibleSection>

        {foundWords.length > 0 && (
          <CollapsibleSection
            label="Words Found"
            count={foundWords.length}
            defaultOpen={!narrow}
          >
            <div className="flex flex-wrap gap-1.5 sm:gap-2 pt-1">
              {foundWords.map((w, idx) => (
                <div
                  key={idx}
                  className="bg-surface-soft border border-border rounded-full pl-3 pr-1 py-0.5 flex items-center gap-1.5"
                >
                  <span className="font-semibold text-ink-900 text-sm">{w.word}</span>
                  <span className="bg-primary-800 text-paper text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                    +{w.points}
                  </span>
                </div>
              ))}
            </div>
          </CollapsibleSection>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------
// Leaderboard list (rendered inside the collapsible section)
// ---------------------------------------------------------------------

function Leaderboard({ leaderboard, playerScore }) {
  const { entries, loading, error, submittedEntry } = leaderboard;

  if (loading) {
    return (
      <div className="px-1 py-2 text-center text-sm text-ink-500">
        Loading scores…
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-1 py-2 text-center text-sm text-danger-600">
        Couldn't reach the leaderboard.
      </div>
    );
  }
  if (entries.length === 0) {
    return (
      <div className="px-1 py-2 text-center text-sm text-ink-500">
        No scores yet — be the first!
      </div>
    );
  }
  return (
    <ol className="divide-y divide-border rounded-xl bg-surface-soft border border-border overflow-hidden mt-1">
      {entries.map((entry, idx) => {
        const isMe = isSubmittedEntry(entry, submittedEntry, playerScore);
        return (
          <li
            key={`${idx}-${entry.player_name}-${entry.score}`}
            className={[
              'flex items-center gap-3 px-3 py-2 text-sm',
              isMe ? 'bg-secondary-50 font-semibold text-primary-800' : 'text-ink-900',
            ].join(' ')}
          >
            <span className="font-label tabular-nums text-ink-500 w-5 text-right">
              {idx + 1}
            </span>
            <span className="flex-1 truncate">{entry.player_name || 'Anonymous'}</span>
            {entry.best_word && (
              <span className="hidden sm:inline text-xs text-ink-500 font-mono">
                {entry.best_word}
              </span>
            )}
            <span className="font-display font-bold tabular-nums">
              {entry.score}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

// Heuristic match — the API doesn't return a stable id, so we rely on
// score + name pair from the just-submitted entry to highlight the row.
function isSubmittedEntry(entry, submitted, playerScore) {
  if (!submitted) return false;
  return (
    entry.score === submitted.score &&
    entry.player_name === submitted.player_name &&
    entry.score === playerScore
  );
}

// ---------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------

function CollapsibleSection({ label, count, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-border bg-paper overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-surface-soft active:bg-surface-soft transition"
        aria-expanded={open}
      >
        <span className="font-label text-[11px] tracking-widest uppercase text-ink-500">
          {label}
          {count != null && <span className="text-ink-400"> · {count}</span>}
        </span>
        <span
          className={[
            'text-ink-500 transition-transform duration-150',
            open ? 'rotate-180' : '',
          ].join(' ')}
          aria-hidden
        >
          <ChevronIcon />
        </span>
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
      <polygon points="12 2 15 9 22 9.5 17 14.5 18.5 22 12 18 5.5 22 7 14.5 2 9.5 9 9" />
    </svg>
  );
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function SummaryCard({ value, label, highlight }) {
  // Long words (e.g. "HOLLYWOOD") need a smaller font tier to fit the
  // mobile tile (~76 px inner width at 3-col layout). Tiers are picked
  // so the widest character cell × char count stays inside the tile.
  const length = typeof value === 'string' ? value.length : 0;
  const valueSizeClass =
    length >= 9
      ? 'text-xs sm:text-base'
      : length >= 7
        ? 'text-sm sm:text-lg'
        : length >= 5
          ? 'text-base sm:text-xl'
          : 'text-xl sm:text-3xl';
  return (
    <div
      className={[
        'rounded-xl p-3 sm:p-4 text-center border min-w-0',
        highlight
          ? 'bg-secondary-50 border-secondary-500'
          : 'bg-surface-soft border-border',
      ].join(' ')}
    >
      <div
        className={[
          'font-display font-extrabold leading-tight truncate',
          valueSizeClass,
          highlight ? 'text-primary-800' : 'text-ink-900',
        ].join(' ')}
        title={typeof value === 'string' ? value : undefined}
      >
        {value}
      </div>
      <div className="font-label text-[9px] sm:text-[10px] tracking-widest uppercase text-ink-500 mt-1">
        {label}
      </div>
    </div>
  );
}

// `entries` is the live top-10 leaderboard for this difficulty, sorted
// score-desc. Returns `null` when the leaderboard hasn't resolved; > 10
// when the player is below the cutoff. The caller treats both as "—".
function computeRank({ score, entries, submittedEntry, loading, error }) {
  if (loading || error) return null;
  if (!entries) return null;
  // Post-submit: look up the player's actual position.
  if (submittedEntry) {
    const idx = entries.findIndex(
      (e) =>
        e.score === submittedEntry.score &&
        e.player_name === submittedEntry.player_name,
    );
    if (idx >= 0) return idx + 1;
  }
  // Pre-submit / didn't submit: count entries strictly ahead. If the
  // 10-entry board is full and the player's below them all, this gives
  // 11 — the caller treats > 10 as "outside top 10".
  const ahead = entries.filter((e) => e.score > score).length;
  if (ahead >= entries.length && entries.length >= 10) return 11;
  return ahead + 1;
}
