import { DIFFICULTY } from '../game/constants.js';

const ORDER = ['chill', 'standard', 'frenzy'];

export function TitleScreen({
  difficulty,
  onSelectDifficulty,
  onStart,
  highScore,
  highScoreLoading,
  dictionaryLoading,
}) {
  return (
    <div className="min-h-screen w-full flex items-center justify-center px-4 py-8 sm:py-12">
      <div className="max-w-xl w-full space-y-8">
        <header className="text-center space-y-3">
          <h1 className="font-display font-extrabold text-5xl sm:text-7xl tracking-tight leading-none">
            <span className="text-primary-800">Word</span>
            <span className="text-danger-500">Collapse</span>
          </h1>
          <p className="text-ink-700 text-base sm:text-lg max-w-md mx-auto">
            Stack words. Survive the flood. Letters keep rising — clear them
            before they overflow.
          </p>
        </header>

        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {ORDER.map((d) => {
            const cfg = DIFFICULTY[d];
            const selected = difficulty === d;
            return (
              <button
                key={d}
                type="button"
                onClick={() => onSelectDifficulty(d)}
                className={[
                  'rounded-2xl px-3 py-5 transition-all text-center',
                  selected
                    ? 'bg-primary-50 ring-2 ring-primary-800 shadow-[0_12px_30px_-15px_rgba(30,58,138,0.45)] -translate-y-0.5'
                    : 'bg-paper border border-border shadow-md hover:shadow-lg hover:-translate-y-0.5',
                ].join(' ')}
                aria-pressed={selected}
              >
                <div className="font-display font-extrabold text-xl sm:text-2xl text-ink-900">
                  {cfg.label}
                </div>
                <div className="font-label text-[11px] sm:text-xs text-ink-500 tracking-widest mt-1">
                  {cfg.blurb}
                </div>
              </button>
            );
          })}
        </div>

        <div className="rounded-2xl bg-paper border border-border shadow-md px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <TrophyIcon />
            <span className="font-label text-xs sm:text-sm tracking-widest uppercase text-ink-500">
              High Score
            </span>
          </div>
          <div className="text-right">
            {highScore ? (
              <>
                <div className="font-display text-2xl sm:text-3xl font-extrabold text-primary-800">
                  {highScore.score}
                </div>
                <div className="text-xs text-ink-500">by {highScore.name}</div>
              </>
            ) : highScoreLoading ? (
              <div className="font-label text-sm text-ink-400">Loading…</div>
            ) : (
              <div className="font-label text-sm text-ink-400">No score yet</div>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onStart}
          disabled={dictionaryLoading}
          className="w-full rounded-full bg-primary-800 hover:bg-primary-900 active:bg-primary-950 disabled:opacity-50 disabled:cursor-not-allowed text-paper font-display font-bold text-xl sm:text-2xl py-5 shadow-xl shadow-primary-800/30 transition"
        >
          {dictionaryLoading ? 'Loading dictionary…' : 'Play'}
        </button>

        <ul className="text-center text-sm text-ink-500 space-y-1.5">
          <li>· Drag across adjacent tiles (8 directions) to form words</li>
          <li>
            · Or type and press{' '}
            <kbd className="rounded bg-surface-soft border border-border px-1.5 py-0.5 text-xs text-ink-900 font-mono">
              Enter
            </kbd>{' '}
            to submit
          </li>
          <li>· Longer words and combos score more</li>
        </ul>
      </div>
    </div>
  );
}

function TrophyIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-warn-500"
    >
      <path d="M8 21h8" />
      <path d="M12 17v4" />
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
      <path d="M17 4h3v3a3 3 0 0 1-3 3" />
      <path d="M7 4H4v3a3 3 0 0 0 3 3" />
    </svg>
  );
}
