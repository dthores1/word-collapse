import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BOARD_FRAME_PADDING,
  COLS,
  ROWS,
  TILE_SIZE,
} from '../game/constants.js';

// =====================================================================
// Board — renders the 5×5 grid with absolutely-positioned tiles.
//
// Tiles animate via CSS `transition` on `transform`, so when a tile's
// (row, col) changes (gravity, row arrival) it glides to its new spot.
// New tiles enter from below the board (row = ROWS) and animate up to
// their final row.
//
// The whole board is one pointer-capture surface for drag selection —
// the parent passes in callbacks plus the current `selectedIds` set so
// we can tint selected tiles.
// =====================================================================
export function Board({
  geometry,
  grid,
  columns,
  selection,
  selectedIds,
  clearingIds,
  explodingIds,
  danger,
  shakeKey,
  hardShakeKey,
  redFlashKey,
  onSelectionChange,
  onCommit,
}) {
  const {
    tileSize,
    cellStride,
    innerWidth: BOARD_INNER_WIDTH,
    innerHeight: BOARD_INNER_HEIGHT,
  } = geometry;
  const containerRef = useRef(null);
  const draggingRef = useRef(false);
  const movedRef = useRef(false);
  const pendingCommitRef = useRef(false);
  // Refs mirror the `selection` prop so pointer handlers can read the
  // latest path synchronously without waiting for React state to settle.
  const pathRef = useRef(selection);
  const pathIdsRef = useRef(new Set());
  pathRef.current = selection;
  pathIdsRef.current = new Set(selection.map((p) => p.id));
  const gridRef = useRef(grid);
  gridRef.current = grid;

  // ---- shake / flash plumbing ----
  const shakeWrapRef = useRef(null);
  useEffect(() => {
    const el = shakeWrapRef.current;
    if (!el || shakeKey === 0) return;
    el.classList.remove('animate-shake');
    // restart the CSS animation by forcing a reflow
    void el.offsetWidth;
    el.classList.add('animate-shake');
  }, [shakeKey]);

  useEffect(() => {
    const el = shakeWrapRef.current;
    if (!el || hardShakeKey === 0) return;
    el.classList.remove('animate-shake-hard');
    void el.offsetWidth;
    el.classList.add('animate-shake-hard');
  }, [hardShakeKey]);

  // Flatten tiles → list of { id, letter, row, col, isClearing, isExploding }.
  const tiles = useMemo(() => {
    const out = [];
    for (let c = 0; c < COLS; c++) {
      const stack = columns[c];
      for (let i = 0; i < stack.length; i++) {
        const tile = stack[i];
        const row = ROWS - 1 - i;
        out.push({
          id: tile.id,
          letter: tile.letter,
          row,
          col: c,
          clearing: clearingIds?.has(tile.id) ?? false,
          exploding: explodingIds?.has(tile.id) ?? false,
        });
      }
    }
    return out;
  }, [columns, clearingIds, explodingIds]);

  // ---- pointer-driven drag selection ----
  const pickTile = (clientX, clientY) => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0) return null;
    const col = Math.floor(x / cellStride);
    const row = Math.floor(y / cellStride);
    if (row < 0 || row >= ROWS || col < 0 || col >= COLS) return null;
    const xInCell = x - col * cellStride;
    const yInCell = y - row * cellStride;
    if (xInCell > tileSize || yInCell > tileSize) return null;
    const tile = gridRef.current[row]?.[col];
    if (!tile) return null;
    return { row, col, id: tile.id };
  };

  // Updates both the synchronously-readable refs and notifies the parent
  // (which owns the canonical `selection` state).
  const updatePath = (next) => {
    pathRef.current = next;
    pathIdsRef.current = new Set(next.map((p) => p.id));
    onSelectionChange?.(next);
  };

  // Pointer model — supports both DRAG and TAP-BUILD seamlessly:
  //
  //   * pointerdown chooses how the press affects the current path:
  //       - empty path                     → start with [tile]
  //       - tile is the last selected tile → arm a commit on pointerup
  //       - tile is somewhere else in path → backtrack to that tile
  //       - tile is 8-adjacent to last     → extend
  //       - otherwise                      → start over with [tile]
  //   * pointermove only mutates the path once the pointer has moved
  //     onto a *different* tile (so a tap that wiggles a few pixels
  //     stays a tap).
  //   * pointerup commits if there was real drag motion AND the path is
  //     long enough; otherwise — if the press was a re-tap of the last
  //     tile — commits the existing path (Enter-equivalent). Otherwise
  //     the path stays put for the next tap.
  const handlePointerDown = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const tile = pickTile(e.clientX, e.clientY);
    if (!tile) return;
    e.preventDefault();
    draggingRef.current = true;
    movedRef.current = false;
    pendingCommitRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);

    const path = pathRef.current;
    if (path.length === 0) {
      updatePath([tile]);
      return;
    }
    const last = path[path.length - 1];
    if (tile.id === last.id) {
      // Re-tap of the last selected tile — pending commit on pointerup.
      pendingCommitRef.current = true;
      return;
    }
    const idx = path.findIndex((p) => p.id === tile.id);
    if (idx >= 0) {
      // Tapping a non-last tile already in the path — truncate to it.
      updatePath(path.slice(0, idx + 1));
      return;
    }
    const dr = Math.abs(last.row - tile.row);
    const dc = Math.abs(last.col - tile.col);
    if (dr <= 1 && dc <= 1) {
      updatePath([...path, tile]);
      return;
    }
    // Not adjacent and not in path — start fresh.
    updatePath([tile]);
  };

  const handlePointerMove = (e) => {
    if (!draggingRef.current) return;
    const tile = pickTile(e.clientX, e.clientY);
    if (!tile) return;
    const path = pathRef.current;
    if (path.length === 0) {
      movedRef.current = true;
      updatePath([tile]);
      return;
    }
    const last = path[path.length - 1];
    if (last.id === tile.id) return; // still on the pressed tile — ignore
    movedRef.current = true;          // we've left the original cell — drag mode
    pendingCommitRef.current = false; // a drag overrides the "tapped last" intent
    // Backtrack: dragging back over the second-to-last tile pops the last.
    if (path.length >= 2 && path[path.length - 2].id === tile.id) {
      updatePath(path.slice(0, -1));
      return;
    }
    if (pathIdsRef.current.has(tile.id)) return; // can't reuse a tile
    const dr = Math.abs(last.row - tile.row);
    const dc = Math.abs(last.col - tile.col);
    if (dr > 1 || dc > 1) return; // not 8-adjacent
    updatePath([...path, tile]);
  };

  const handlePointerUp = (e) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }

    const wasDrag = movedRef.current;
    const path = pathRef.current;

    if (wasDrag) {
      // Drag commits unconditionally; PlayScreen handles too-short paths.
      onCommit?.();
      return;
    }
    // Tap (no movement). If the user tapped the last selected tile, treat
    // it as a commit; otherwise leave the selection in place so they can
    // keep building it with more taps.
    if (pendingCommitRef.current) {
      onCommit?.();
    }
  };

  const handlePointerCancel = (e) => {
    draggingRef.current = false;
    movedRef.current = false;
    pendingCommitRef.current = false;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    // Don't wipe the path — a cancelled gesture (e.g. the OS interrupting)
    // shouldn't punish the player. They can keep building.
  };

  // ---- selection-line geometry ----
  const linePoints = useMemo(() => {
    if (!selectedIds || selectedIds.size === 0) return [];
    const idToPos = new Map();
    for (const t of tiles) {
      if (selectedIds.has(t.id)) idToPos.set(t.id, t);
    }
    return Array.from(idToPos.values())
      .sort((a, b) => orderInPath(a.id, b.id, selectedIds))
      .map((t) => ({
        x: t.col * cellStride + tileSize / 2,
        y: t.row * cellStride + tileSize / 2,
      }));
  }, [tiles, selectedIds, cellStride, tileSize]);

  return (
    <div
      ref={shakeWrapRef}
      className={[
        'relative rounded-3xl bg-paper border border-border shadow-xl mx-auto',
        'transition-shadow',
        danger ? 'shadow-danger-300/50 ring-2 ring-danger-300/60 animate-danger-pulse' : '',
      ].join(' ')}
      style={{
        padding: BOARD_FRAME_PADDING,
        width: 'fit-content',
      }}
    >
      {/* `touch-action` is intentionally NOT set on the container — touches
          on empty cells (placeholders) should fall through to the page so
          the user can scroll on mobile. We instead set `touch-action: none`
          on populated tiles below, which is enough to prevent the browser
          scrolling during a real drag-select that begins on a tile. */}
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        style={{
          position: 'relative',
          width: BOARD_INNER_WIDTH,
          height: BOARD_INNER_HEIGHT,
          userSelect: 'none',
        }}
      >
        {/* Empty-cell placeholders so the grid reads as 5×5 even when sparse */}
        {Array.from({ length: ROWS * COLS }).map((_, i) => {
          const r = Math.floor(i / COLS);
          const c = i % COLS;
          const corner = Math.round(16 * (tileSize / TILE_SIZE));
          return (
            <div
              key={`cell-${i}`}
              style={{
                position: 'absolute',
                width: tileSize,
                height: tileSize,
                transform: `translate(${c * cellStride}px, ${r * cellStride}px)`,
                borderRadius: corner,
                background: 'transparent',
                border: '1px dashed rgba(15, 23, 42, 0.05)',
                boxSizing: 'border-box',
              }}
            />
          );
        })}

        {/* Connecting line under the tiles */}
        {linePoints.length >= 2 && (
          <svg
            width={BOARD_INNER_WIDTH}
            height={BOARD_INNER_HEIGHT}
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
          >
            <polyline
              points={linePoints.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="rgba(30, 58, 138, 0.55)"
              strokeWidth={Math.max(4, Math.round(8 * (tileSize / TILE_SIZE)))}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}

        {/* Tiles */}
        {tiles.map((t, idx) => (
          <Tile
            key={t.id}
            geometry={geometry}
            letter={t.letter}
            row={t.row}
            col={t.col}
            selected={selectedIds?.has(t.id)}
            clearing={t.clearing}
            exploding={t.exploding}
            explodeDelay={t.exploding ? idx * 18 : 0}
          />
        ))}
      </div>

      {/* Red-flash overlay for game-over moment */}
      <RedFlash redFlashKey={redFlashKey} />
    </div>
  );
}

function Tile({ geometry, letter, row, col, selected, clearing, exploding, explodeDelay = 0 }) {
  const { tileSize, cellStride } = geometry;
  // First mount: render below the board, then transition into final spot.
  const [mounted, setMounted] = useState(false);
  useLayoutEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const renderRow = mounted ? row : ROWS;
  const x = col * cellStride;
  const y = renderRow * cellStride;
  const fontSize = Math.round(28 * (tileSize / TILE_SIZE));

  return (
    <div
      className={[
        'absolute flex items-center justify-center font-display font-extrabold select-none',
        'rounded-2xl border',
        exploding ? 'animate-tile-explode' : clearing ? 'animate-tile-clear' : '',
        selected
          ? 'bg-primary-800 text-paper border-primary-900 shadow-lg shadow-primary-800/40 scale-[1.05]'
          : exploding
            ? 'bg-danger-500 text-paper border-danger-600 shadow-lg shadow-danger-500/60'
            : 'bg-paper text-primary-800 border-border shadow-md',
      ].join(' ')}
      style={{
        width: tileSize,
        height: tileSize,
        fontSize,
        transform: `translate(${x}px, ${y}px)`,
        transition:
          'transform 200ms cubic-bezier(0.25, 0.8, 0.25, 1), background-color 120ms, color 120ms, box-shadow 120ms, scale 120ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 180ms ease-out',
        opacity: mounted ? 1 : 0,
        willChange: 'transform',
        animationDelay: explodeDelay ? `${explodeDelay}ms` : undefined,
        // Block browser scrolling/zoom *when the touch starts on a tile*.
        // Touches on empty cells fall back to `touch-action: auto`, so the
        // page can scroll on mobile when the finger lands on empty grid
        // space. See the container comment in `Board` for the full story.
        touchAction: 'none',
      }}
    >
      {letter}
    </div>
  );
}

function RedFlash({ redFlashKey }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || redFlashKey === 0) return;
    el.classList.remove('animate-red-flash');
    void el.offsetWidth;
    el.classList.add('animate-red-flash');
  }, [redFlashKey]);
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-0 rounded-3xl bg-danger-500"
      style={{ opacity: 0 }}
      aria-hidden
    />
  );
}

// Helper: keep selection-line points in path order. We rely on a stable
// id-order map passed down by the parent (selectedIds is an ordered Map
// internally — see PlayScreen). Falls back to insertion order otherwise.
function orderInPath(idA, idB, selectedIds) {
  // selectedIds is a Set or Map preserving insertion order.
  const arr = Array.from(selectedIds);
  return arr.indexOf(idA) - arr.indexOf(idB);
}
