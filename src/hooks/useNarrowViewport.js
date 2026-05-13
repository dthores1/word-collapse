import { useEffect, useState } from 'react';

// Tailwind's `sm` breakpoint is 640 px; everything below is the
// "narrow" / mobile regime. Components that need to branch layout on
// the same boundary (PlayScreen's sliding viewport, GameOverScreen's
// collapsible sections) share this hook so they stay in lockstep.
export const NARROW_BREAKPOINT_PX = 640;

export function useNarrowViewport() {
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
