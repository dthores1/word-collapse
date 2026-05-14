// Circular icon button that triggers a game quit. Ported from
// Wordsmith's QuitButton so the two games' headers feel like one
// family: the iconic red-circle + white-square stop glyph rather than
// a flat-filled coloured button.
//
//   - Default state: transparent background; the icon carries the red.
//   - Hover: subtle danger-tinted background ring, icon scales up
//     slightly with a muted brightness pass.
//   - Active: icon scales back down for tactile press feedback.
//   - Tooltip "Quit game" fades in below on hover / focus-visible.
//
// `tabIndex={-1}` + `onMouseDown` preventDefault keeps an active
// keyboard/text-input focus on the desktop word entry instead of
// stealing it when the player clicks Quit.
export function QuitButton({ onClick }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      aria-label="Quit game"
      className={[
        'group relative inline-flex items-center justify-center',
        'w-10 h-10 rounded-full',
        'transition hover:bg-danger-500/10',
      ].join(' ')}
    >
      <StopGlyph className="w-7 h-7 transition-transform duration-150 group-hover:scale-110 group-hover:brightness-90 group-active:scale-95" />
      <Tooltip>Quit game</Tooltip>
    </button>
  );
}

function StopGlyph({ className }) {
  // Red circle + rounded white square — the same iconography
  // Wordsmith uses for its Quit button.
  return (
    <svg
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <circle cx="256" cy="256" r="256" fill="#b91a1c" />
      <rect
        x="151.678"
        y="151.679"
        width="208.643"
        height="208.643"
        rx="10.667"
        fill="#ffffff"
      />
    </svg>
  );
}

function Tooltip({ children }) {
  return (
    <span
      role="tooltip"
      className={[
        'pointer-events-none select-none',
        'absolute top-full left-1/2 -translate-x-1/2 mt-2',
        'px-2 py-1 rounded-md whitespace-nowrap',
        'font-label text-[11px] font-semibold tracking-wide',
        'bg-ink-900 text-paper shadow-md',
        'opacity-0 -translate-y-0.5',
        'group-hover:opacity-100 group-hover:translate-y-0',
        'group-focus-visible:opacity-100 group-focus-visible:translate-y-0',
        'transition duration-150 ease-out z-20',
      ].join(' ')}
    >
      {children}
      <span
        aria-hidden
        className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-ink-900 rotate-45"
      />
    </span>
  );
}
