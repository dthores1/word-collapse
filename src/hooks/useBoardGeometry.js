import { useLayoutEffect, useState } from 'react';
import {
  BOARD_FRAME_PADDING,
  COLS,
  makeBoardGeometry,
  MAX_TILE_SIZE,
  MIN_TILE_SIZE,
  ROWS,
  TILE_GAP,
  TILE_SIZE,
} from '../game/constants.js';

// Horizontal slack for the lifeline column (`left-full ml-4`) beside the board.
const LIFELINE_SIDECAR_RESERVE = 96;
// Narrow layout stacks lifelines under the board — reserve vertical space so the
// grid still fits without forcing page scroll.
const STACKED_LIFELINE_ALLOWANCE = 168;
const NARROW_BREAKPOINT = 640;

/**
 * Computes tile scale from the board slot size so the grid fits without page scroll.
 * Uses `100dvh`-friendly flex layout in PlayScreen — `containerRef` must wrap the
 * region that should constrain the board (typically `flex-1 min-h-0`).
 *
 * @param {React.RefObject<HTMLElement | null>} containerRef
 */
export function useBoardGeometry(containerRef) {
  const [geometry, setGeometry] = useState(() => makeBoardGeometry(MAX_TILE_SIZE));

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const update = () => {
      const rect = el.getBoundingClientRect();
      const availW = rect.width;
      const availH = rect.height;
      const frame = BOARD_FRAME_PADDING * 2;

      if (availW < 32 || availH < 32) {
        setGeometry(makeBoardGeometry(MIN_TILE_SIZE));
        return;
      }

      const isNarrow = availW < NARROW_BREAKPOINT;
      const lifelineReserveX = isNarrow ? 0 : LIFELINE_SIDECAR_RESERVE;
      const lifelineReserveY = isNarrow ? STACKED_LIFELINE_ALLOWANCE : 0;

      const innerW = availW - frame - lifelineReserveX;
      const innerH = availH - frame - lifelineReserveY;

      const gapRatio = TILE_GAP / TILE_SIZE;
      const rowPitch = ROWS + (ROWS - 1) * gapRatio;
      const colPitch = COLS + (COLS - 1) * gapRatio;

      const fromW = innerW / colPitch;
      const fromH = innerH / rowPitch;
      let tileSize = Math.min(fromW, fromH, MAX_TILE_SIZE);
      tileSize = Math.max(tileSize, MIN_TILE_SIZE);
      tileSize = Math.round(tileSize * 4) / 4;

      setGeometry(makeBoardGeometry(tileSize));
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  return geometry;
}
