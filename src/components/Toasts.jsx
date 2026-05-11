// Floating score / combo / chain feedback. Toasts are owned by useGame
// (added in CLEAR_END, expired in TICK), so this is purely presentational:
// each toast fades up and out via CSS, and React unmounts it once the
// reducer prunes its entry.
export function Toasts({ toasts }) {
  if (!toasts || toasts.length === 0) return null;
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="relative">
        {toasts.map((t, idx) => (
          <Toast key={t.id} toast={t} stackIndex={idx} />
        ))}
      </div>
    </div>
  );
}

function Toast({ toast, stackIndex }) {
  const { kind, text } = toast;
  const tone =
    kind === 'combo'
      ? 'bg-warn-500 text-paper'
      : kind === 'huge'
        ? 'bg-danger-500 text-paper'
        : 'bg-primary-800 text-paper';
  return (
    <div
      className={[
        'animate-fly-in absolute -translate-x-1/2 -translate-y-1/2',
        'rounded-2xl px-4 py-2 shadow-2xl font-display font-extrabold text-xl tracking-wide',
        tone,
      ].join(' ')}
      style={{ left: 0, top: stackIndex * 12 }}
    >
      {text}
    </div>
  );
}
