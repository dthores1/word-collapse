// Lifeline buttons.
//
// Two render modes:
//   default   — large vertical sidecar used on the desktop play screen
//               (rendered next to the board)
//   compact   — small horizontal row used in the mobile action bar at
//               the top of the play screen, where space is tight
//
// Each lifeline shows its remaining-uses badge in the top-right corner.
// Disabled state mirrors the corresponding `*Uses` count being zero —
// the reducer also guards against burning a use on an empty board (bomb)
// or an already-compact board (collapse) so a click in those cases is a
// silent no-op even if the button looks enabled.
export function LifelinePanel({
  bombUses,
  collapseUses,
  onBomb,
  onCollapse,
  compact = false,
}) {
  const wrapper = compact ? 'flex gap-2' : 'flex gap-3 self-center flex-col';
  return (
    <div className={wrapper}>
      <LifelineButton
        icon={<BombIcon compact={compact} />}
        label="Bomb"
        sublabel="Clear top row"
        uses={bombUses}
        onClick={onBomb}
        tone="danger"
        compact={compact}
      />
      <LifelineButton
        icon={<CollapseIcon compact={compact} />}
        label="Collapse"
        sublabel="Compact tiles"
        uses={collapseUses}
        onClick={onCollapse}
        tone="primary"
        compact={compact}
      />
    </div>
  );
}

function LifelineButton({ icon, label, sublabel, uses, onClick, tone, compact }) {
  const disabled = uses <= 0;
  // Tailwind only sees fully-spelled class strings, so we branch on tone
  // here rather than building class names dynamically.
  const enabledColor =
    tone === 'danger'
      ? 'bg-paper border-danger-500/30 hover:border-danger-500 hover:shadow-lg active:scale-95 text-danger-500'
      : 'bg-paper border-primary-800/30 hover:border-primary-800 hover:shadow-lg active:scale-95 text-primary-800';
  const badgeColor = disabled
    ? 'bg-ink-300 text-ink-700'
    : tone === 'danger'
      ? 'bg-danger-500 text-paper'
      : 'bg-warn-500 text-paper';
  const sizeClass = compact
    ? 'w-10 h-10 rounded-xl shadow-sm'
    : 'w-16 h-16 rounded-2xl shadow-md';
  const iconWrapClass = compact ? 'w-5 h-5' : 'w-8 h-8';
  const badgeSizeClass = compact
    ? 'min-w-[16px] h-[16px] text-[9px] -top-1 -right-1'
    : 'min-w-[22px] h-[22px] text-[11px] -top-2 -right-2';
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={`${label} — ${sublabel}`}
      aria-label={`${label} (${uses} ${uses === 1 ? 'use' : 'uses'} remaining)`}
      className={[
        'relative border-2 flex items-center justify-center transition',
        sizeClass,
        disabled
          ? 'bg-surface-soft border-border opacity-40 cursor-not-allowed'
          : enabledColor,
      ].join(' ')}
    >
      <div className={`${iconWrapClass} flex items-center justify-center`}>{icon}</div>
      <span
        className={[
          'absolute rounded-full font-bold flex items-center justify-center px-1 border-2 border-paper',
          badgeSizeClass,
          badgeColor,
        ].join(' ')}
      >
        {uses}
      </span>
    </button>
  );
}

function BombIcon({ compact }) {
  const size = compact ? 20 : 32;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="11" cy="14" r="7" />
      <path d="M14 7 l3 -3" />
      <path d="M16 4 l2.5 0.5 -0.5 2.5" />
      <path d="M5 12 l1 -1" />
    </svg>
  );
}

function CollapseIcon({ compact }) {
  const size = compact ? 20 : 32;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7 4 l0 6 M4 7 l3 3 3 -3" />
      <path d="M17 4 l0 6 M14 7 l3 3 3 -3" />
      <rect x="4" y="14" width="16" height="6" rx="1.5" />
    </svg>
  );
}
