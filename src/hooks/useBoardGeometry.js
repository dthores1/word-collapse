import { useLayoutEffect, useState } from 'react';
import {
  BOARD_FRAME_PADDING,
  COLS,
  makeBoardGeometry,
  MAX_TILE_SIZE,
  MIN_TILE_SIZE,
  NARROW_BOARD_FRAME_PADDING,
  NARROW_MAX_TILE_SIZE,
  NARROW_VIEWPORT_BREAKPOINT,
  ROWS,
  TILE_GAP,
  TILE_SIZE,
} from '../game/constants.js';

// Horizontal slack reserved for the lifeline column rendered to the right
// of the board on desktop (`left-full ml-4` plus the column itself).
const LIFELINE_SIDECAR_RESERVE = 96;

/**
 * Computes tile size from the board slot dimensions so the grid fits the
 * available space appropriately.
 *
 * Two regimes:
 *
 *   • DESKTOP (`availW >= NARROW_VIEWPORT_BREAKPOINT`) — tile size is the
 *     smallest of the width-derived and height-derived fits, capped at
 *     `MAX_TILE_SIZE`. The play UI tries hard to stay within one viewport
 *     so nothing scrolls during a round.
 *
 *   • MOBILE / NARROW — tile size is driven by width only, capped at
 *     `NARROW_MAX_TILE_SIZE`. The page is allowed to scroll vertically:
 *     a 10-row board at width-fit tile sizes is taller than most phone
 *     viewports, but the player explicitly preferred big tap targets over
 *     compact-fit. Horizontal lifelines (see `LifelinePanel`) keep the
 *     vertical overhead modest.
 *
 * `containerRef` must wrap the region whose **width** should constrain
 * the board (typically the play-area flex slot inside PlayScreen).
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
      const isNarrow = availW < NARROW_VIEWPORT_BREAKPOINT;
      const framePadding = isNarrow ? NARROW_BOARD_FRAME_PADDING : BOARD_FRAME_PADDING;
      const frame = framePadding * 2;

      if (availW < 32) {
        setGeometry(makeBoardGeometry(MIN_TILE_SIZE, framePadding));
        return;
      }

      const gapRatio = TILE_GAP / TILE_SIZE;
      const colPitch = COLS + (COLS - 1) * gapRatio;
      const rowPitch = ROWS + (ROWS - 1) * gapRatio;

      let tileSize;

      if (isNarrow) {
        // Width-only fit. We deliberately ignore `availH` here — on a
        // phone the 10-row board is almost always taller than the
        // viewport at usable tile sizes, and the page is configured to
        // scroll on mobile (see PlayScreen layout).
        const innerW = availW - frame;
        tileSize = Math.min(innerW / colPitch, NARROW_MAX_TILE_SIZE);
      } else {
        // Desktop: fit-to-viewport. Reserve space for the right-hand
        // lifeline sidecar.
        const innerW = availW - frame - LIFELINE_SIDECAR_RESERVE;
        const innerH = availH - frame;
        const fromW = innerW / colPitch;
        const fromH = innerH / rowPitch;
        tileSize = Math.min(fromW, fromH, MAX_TILE_SIZE);
      }

      tileSize = Math.max(tileSize, MIN_TILE_SIZE);
      tileSize = Math.round(tileSize * 4) / 4;

      setGeometry(makeBoardGeometry(tileSize, framePadding));
    };

    update();

    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  return geometry;
}
