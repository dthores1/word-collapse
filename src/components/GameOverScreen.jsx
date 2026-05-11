import { useState } from 'react';

const DIFFICULTY_LABELS = {
  chill: 'Chill',
  standard: 'Standard',
  frenzy: 'Frenzy',
};

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

  const qualifies = leaderboard.qualifies(score);
  const showNamePrompt =
    qualifies && !saved && !leaderboard.submittedEntry;

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaved(true);
    const result = await onSubmit(trimmed);
    // If the API submit failed, allow the player to retry.
    if (!result) setSaved(false);
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4 py-8">
      <div className="max-w-2xl w-full bg-paper border border-border rounded-3xl p-8 sm:p-12 shadow-2xl space-y-7">
        <div className="text-center space-y-3">
          <div className="font-label text-xs tracking-widest uppercase text-ink-500">
            Game Over
          </div>
          <div className="font-display font-extrabold text-6xl sm:text-7xl tracking-tight">
            {score} <span className="text-ink-400 text-4xl sm:text-5xl">pts</span>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <SummaryCard value={wordsCount} label="Words" />
          <SummaryCard value={bestWord || '—'} label="Best Word" />
          <SummaryCard
            value={
              isHighScore
                ? 'NEW'
                : highScore
                  ? highScore.score
                  : '—'
            }
            label={isHighScore ? 'New High!' : `High${highScore ? `: ${highScore.score}` : ''}`}
            highlight={isHighScore}
          />
        </div>

        {showNamePrompt && (
          <div className="space-y-3">
            <div className="text-center font-semibold text-ink-900">
              You made the top 10! Add your name:
            </div>
            <div className="flex gap-3">
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                placeholder="Your name"
                maxLength={20}
                disabled={leaderboard.submitting}
                className="flex-1 px-5 py-3 rounded-2xl border-2 border-secondary-500 text-lg outline-none focus:ring-2 focus:ring-secondary-500/40 disabled:opacity-60"
                autoFocus
              />
              <button
                type="button"
                onClick={handleSave}
                disabled={leaderboard.submitting || !name.trim()}
                className="px-7 py-3 bg-primary-800 hover:bg-primary-900 active:bg-primary-950 text-paper font-semibold rounded-2xl transition disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {leaderboard.submitting ? 'Saving…' : 'Save'}
              </button>
            </div>
            {leaderboard.submitError && (
              <div className="text-center text-sm text-danger-600">
                Couldn't save your score. Check your connection and try again.
              </div>
            )}
          </div>
        )}

        <Leaderboard
          difficulty={difficulty}
          leaderboard={leaderboard}
          playerScore={score}
        />

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={onPlayAgain}
            className="flex-1 bg-primary-800 hover:bg-primary-900 active:bg-primary-950 text-paper font-display font-bold text-lg sm:text-xl py-4 rounded-full shadow-lg shadow-primary-800/30 transition"
          >
            Play again
          </button>
          <button
            type="button"
            onClick={onMainMenu}
            className="flex-1 bg-paper text-primary-800 font-display font-bold text-lg sm:text-xl py-4 rounded-full border-2 border-border hover:border-primary-800 transition"
          >
            Main Menu
          </button>
        </div>

        {foundWords.length > 0 && (
          <div className="space-y-3">
            <div className="font-label text-[11px] tracking-widest uppercase text-ink-500">
              Words Found
            </div>
            <div className="flex flex-wrap gap-2">
              {foundWords.map((w, idx) => (
                <div
                  key={idx}
                  className="bg-surface-soft border border-border rounded-full pl-3 pr-1 py-1 flex items-center gap-2"
                >
                  <span className="font-semibold text-ink-900">{w.word}</span>
                  <span className="bg-primary-800 text-paper text-xs font-bold px-2 py-0.5 rounded-full">
                    +{w.points}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Leaderboard({ difficulty, leaderboard, playerScore }) {
  const { entries, loading, error, submittedEntry } = leaderboard;
  const label = DIFFICULTY_LABELS[difficulty] || difficulty;

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="font-label text-[11px] tracking-widest uppercase text-ink-500">
          Top 10 — {label}
        </div>
        {!loading && !error && (
          <div className="font-label text-[11px] tracking-widest uppercase text-ink-400">
            Live
          </div>
        )}
      </div>

      <div className="rounded-2xl bg-surface-soft border border-border overflow-hidden">
        {loading && (
          <div className="px-4 py-6 text-center text-sm text-ink-500">
            Loading scores…
          </div>
        )}
        {!loading && error && (
          <div className="px-4 py-6 text-center text-sm text-danger-600">
            Couldn't reach the leaderboard.
          </div>
        )}
        {!loading && !error && entries.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-ink-500">
            No scores yet — be the first!
          </div>
        )}
        {!loading && !error && entries.length > 0 && (
          <ol className="divide-y divide-border">
            {entries.map((entry, idx) => {
              const isMe = isSubmittedEntry(entry, submittedEntry, playerScore);
              return (
                <li
                  key={`${idx}-${entry.player_name}-${entry.score}`}
                  className={[
                    'flex items-center gap-3 px-4 py-2.5 text-sm',
                    isMe ? 'bg-secondary-50 font-semibold text-primary-800' : 'text-ink-900',
                  ].join(' ')}
                >
                  <span className="font-label tabular-nums text-ink-500 w-6 text-right">
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
        )}
      </div>
    </div>
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

function SummaryCard({ value, label, highlight }) {
  return (
    <div
      className={[
        'rounded-2xl p-5 text-center border',
        highlight
          ? 'bg-secondary-50 border-secondary-500'
          : 'bg-surface-soft border-border',
      ].join(' ')}
    >
      <div
        className={[
          'font-display font-extrabold leading-tight',
          typeof value === 'string' && value.length > 4 ? 'text-xl' : 'text-2xl sm:text-3xl',
          highlight ? 'text-primary-800' : 'text-ink-900',
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
