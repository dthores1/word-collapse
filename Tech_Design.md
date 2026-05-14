# WordCollapse — Tech Design

A living document describing exactly what is built, how it works, and why.
Update this file after every meaningful change.

---

## 1. Stack & top-level layout

| Concern | Choice |
| --- | --- |
| Bundler / dev server | Vite 8 |
| UI framework | React 19 (no third-party state lib) |
| Styling | Tailwind v4 (CSS-first config via `@theme`) — no `tailwind.config.js` |
| Animations | Hand-written CSS keyframes + `transition: transform` on tiles. **No framer-motion.** |
| Word list | ENABLE dictionary, copied from Wordsmith (`public/enable-word-list.txt`) |
| Persistence | `localStorage` for per-difficulty personal bests + last-used name; remote leaderboard via `wordcollapse-api.fly.dev` (Fly + SQLite) |
| Module type | Native ESM (`"type": "module"`) |

Repository root is the React app — there is no `app/` subfolder. Files of note:

```
word-collapse/
  index.html                  Vite entry (loads /src/main.jsx, Google fonts)
  package.json                Scripts: dev, build, preview
  vite.config.js              Plugins: @vitejs/plugin-react, @tailwindcss/vite
  Tech_Design.md              You are here
  public/
    enable-word-list.txt      ~172k ENABLE words — used for word ACCEPTANCE
    common-words.txt          ~12.7k curated 3–7 letter common words —
                              used by the playability scorer ONLY (so the
                              metric correlates with what a typical
                              player can actually spot on the board)
    favicon.svg               Shared with Wordsmith
  src/
    main.jsx                  React root, no PostHog (Wordsmith has it; we don't yet)
    index.css                 Tailwind import + design tokens + animation keyframes
    App.jsx                   Phase router (idle → playing → gameover)
    game/
      constants.js            Board geometry, difficulty configs, animation timings
      letters.js              Random letter rolls, weighted by difficulty
      scoring.js              Word value + combo/chain multipliers
      path.js                 8-direction adjacency + DFS path finding
    hooks/
      useDictionary.js        Loads + parses ENABLE list once on mount
      useGame.js              Reducer-driven game state machine (the brain)
      useHighScore.js         Per-difficulty localStorage personal bests +
                              last-used player name pre-fill
      useLeaderboard.js       Fetches top-10 from the remote API per
                              difficulty, exposes qualifies()/submit()
    lib/
      leaderboard.js          Fetch wrapper for the wordcollapse-api Fly
                              service (GET /leaderboard, POST /submit-score,
                              with an 8s AbortController timeout for the
                              cold-start window)
    components/
      TitleScreen.jsx         Logo, difficulty cards, high-score row, Play button
      PlayScreen.jsx          HUD + word input + Board + LifelinePanel + next-row preview
      Board.jsx               5×5 grid; absolute-positioned tiles; drag/tap selection
      LifelinePanel.jsx       Bomb + Collapse buttons with remaining-uses badges
      Toasts.jsx              Floating "+points / COMBO x3 / HUGE CLEAR" feedback
      GameOverScreen.jsx      Score recap, top-10 leaderboard panel, name
                              entry only when score qualifies for the board
    game/
      lifelines.js            Bomb-target finder + Collapse repack algorithm
```

---

## 2. Visual / brand system

The design tokens in `src/index.css` mirror Wordsmith's so the two games
share typography and the calm-vs-danger color palette. Tailwind v4 reads
them via the CSS-first `@theme` block — every token surfaces as a utility
class (e.g. `text-primary-800`, `bg-danger-500`).

- Fonts (loaded from Google Fonts in `index.html`):
  - `font-sans`    Inter — body
  - `font-display` Plus Jakarta Sans — logo, scores, tile letters
  - `font-label`   Lexend — small uppercase labels
- Brand:
  - `primary-800` `#1e3a8a`  blue half of "Word"
  - `danger-500`  `#ef4444`  red half of "Collapse" + danger accents
  - `warn-500`    `#f59e0b`  combo / chain accent
- Page background mixes a faint blue glow top-right and red glow
  bottom-left (`body` background-image), reinforcing brand split.

### Animation primitives (defined in `index.css`)

| Class | Duration | Easing | Use |
| --- | --- | --- | --- |
| `.animate-fly-in` | 1100ms | ease-out | toasts (+points, COMBO x3, HUGE CLEAR, LIFELINE +1) |
| `.animate-shake` | 180ms | ease-in-out | invalid submit, row impact, bomb impact, near-overflow |
| `.animate-shake-hard` | 380ms | ease-in-out | game-over slam |
| `.animate-tile-clear` | 150ms | cubic-bezier(0.22,1,0.36,1) | a tile is being removed by a word clear |
| `.animate-tile-explode` | 280ms | cubic-bezier(0.34,1.56,0.64,1) | bomb-triggered tile clear (red flash + rotate) |
| `.animate-tile-land` | 160ms | cubic-bezier(0.34,1.56,0.64,1) | (defined; not yet wired) |
| `.animate-danger-pulse` | 1100ms loop | ease-in-out | board card glow when any column ≥ 4 |
| `.animate-red-flash` | 520ms | ease-out | red overlay at game-over |
| `.animate-tile-pop` | 240ms | cubic-bezier(0.34,1.56,0.64,1) | (defined; usable for staggered intros) |

Tile movement (gravity, row shift) is driven by a CSS `transition` on
the `transform` of each absolutely-positioned tile, not a keyframe. New
tiles enter from below by rendering at `row = ROWS` on first paint, then
swapping to their real `row` after `useLayoutEffect` + rAF — the CSS
transition animates the slide-in.

---

## 3. Game model

### Coordinates

The board is 5 columns × **10 rows** (geometry constants in
`game/constants.js`). **Origin is top-left**: row 0 is the top, row 9
is the bottom (where new rows arrive). Internally each column is
stored as a stack — `columns[c]` is an array of `Tile` objects,
**bottom-up**: `columns[c][0]` sits at row 9, `columns[c][i]` at
row `9 - i`. Empty cells (visual gaps in the column above the stack)
live at rows `0..(9 - stack.length)`.

Tile size is responsive (`useBoardGeometry`):

- **Desktop** (`availW ≥ 640`) — tiles fit-to-viewport, sized as
  `min(widthFit, heightFit, MAX_TILE_SIZE=46)`. Board frame padding
  is `BOARD_FRAME_PADDING=28`. The play UI tries hard to stay within
  one viewport so nothing scrolls during a round.
- **Mobile / narrow** (`availW < 640`) — tiles are sized by **width
  only**, capped at `NARROW_MAX_TILE_SIZE=64`. Frame padding drops
  to `NARROW_BOARD_FRAME_PADDING=12` so the board runs nearly
  edge-to-edge. The page is allowed to scroll vertically — the
  tradeoff is large tappable tiles. Floating lifeline + ✓ FABs sit
  in the bottom corners of the board card (see §5).

### Mobile layout: pinned viewport, scrollable board

The PlayScreen is **pinned to the viewport** at all sizes —
`h-[100dvh] overflow-hidden flex flex-col` on the outer wrapper. The
page never scrolls during gameplay. The middle flex child (`flex-1
min-h-0 overflow-y-auto overscroll-contain`) wraps the Board: when
the board is taller than the available space (mobile, where the full
10-row board is ~700 px and the available slice is ~500 px), this
container scrolls internally; on desktop the board fits naturally
and `overflow-y:auto` is a no-op.

**Auto-scroll.**

- **Game start.** A `[game.phase]`-keyed effect runs when the player
  enters `'playing'`: it scrolls the container to its bottom
  immediately AND once more 200 ms later. The double-fire catches
  the post-settle layout — `useBoardGeometry`'s ResizeObserver
  resolves asynchronously, so the *first* render uses the default
  46-px tile size and a bottom-anchor computed from that lands wrong
  once the mobile 64-px size kicks in. Both scrolls are `auto`
  (instant) because the player hasn't engaged yet.
- **Row arrival.** A `[game.totalTiles]`-keyed effect watches the
  tile count via `prevTotalTilesRef`. On increase (a row arrived —
  clears decrease it, scrambles don't change it) the container
  *smoothly* scrolls to its bottom so the freshly-arrived row is
  visible without manual scrolling.

**Out-of-view affordances.** A relative wrapper around the scroll
container renders two chevron chips (top, bottom), pointer-events:
none, fading in via opacity. State is computed from `scrollTop` +
`clientHeight` + `scrollHeight` via a scroll listener and a
ResizeObserver on the container; both are re-attached when
`boardGeometry.tileSize` changes (since scrollHeight changes with
it). Up chevron shows when there's content above the viewport, down
chevron when there's content below — invisible on desktop where
the board fits.

**Touch model.**

| Surface | `touch-action` | Behavior |
| --- | --- | --- |
| Outer wrapper | (default `auto`) | n/a — outer is `overflow: hidden`, can't scroll |
| Board-scroll container | (default `auto`) | Browser pans vertically when the touch starts on a non-tile region |
| Tile elements | `none` | Browser hands the entire gesture to JS — drag-select works in any direction without competing with scroll |
| Empty-cell placeholders | (default `auto`) | Pan up into the scroll container |

A drag that begins on a tile is committed to "JS-handled" by the
browser the moment it sees `touch-action: none`, so the player can
move the finger in any direction (vertical too — `EYE`, `OUT`)
without the board accidentally scrolling. A touch that begins on an
empty cell scrolls the board. With a fully-populated board the only
scrolling lever is the auto-scroll, but late-game gameplay is
focused on the bottom anyway.

The board card itself still uses `overflow: hidden` — it clips the
freshly-mounted tile that enters from `renderRow = ROWS` (below the
inner container) so the entry animation doesn't leak below the
card's bottom edge.

Narrow-viewport detection is a small `useNarrowViewport` hook in
`src/hooks/useNarrowViewport.js` that mirrors a
`matchMedia('(max-width: 639px)')` listener — shared with
GameOverScreen for its collapsible-default behavior.

Game seeds **3 rows** at start (`INITIAL_ROWS = 3`) so the player
has real planning context from turn 0 and the playability scorer's
"highest occupied row" check is meaningful immediately.

```
visual row     col 0    col 1    col 2    col 3    col 4
   0           ·        ·        ·        ·        ·
   1           ·        ·        K        ·        ·
   2           ·        N        E        ·        ·
   3           ·        E        O        X        W
   4           S        L        O        G        A
```

Storing per-column stacks makes gravity trivial — after a clear we
just `Array.prototype.filter` each column to drop removed tiles, and
indices automatically re-pack toward the bottom. Indices changing
moves the tile's `(row, col)` derivation, which feeds straight into
the CSS `transform` transition.

### Tiles

Each tile has a globally-unique `id` (monotonic counter in `useGame.js`)
and an uppercase `letter`. The `id` is the React key for the tile
component, so the same DOM node persists as the tile moves around the
board — that's what lets the CSS transition animate position changes.

### Row arrival

A row enters by `unshift`ing a freshly-rolled tile onto each column.
Existing tiles' indices grow by 1, which means each tile's derived
`row` decreases by 1 (moves up by one). Overflow check happens
**before** the push: if any column is already at `ROWS` length,
adding another would exceed the visible grid → game over.

### Falling / gravity

After a clear, each column's tile array is filtered to remove cleared
ids. Remaining tiles shift toward index 0 (toward the bottom). Their
derived row positions change → CSS transition handles the fall.

### Path / adjacency

`game/path.js` exposes:

- `isAdjacent(a, b)` — true iff `|Δrow| ≤ 1`, `|Δcol| ≤ 1`, and the
  cells aren't identical (8-direction adjacency).
- `findPath(grid, word)` — exhaustive DFS from every matching starting
  cell. Returns the first path that spells `word` without revisiting a
  tile, or `null`. Search space is at most 25 cells × 8 neighbours per
  step — fast enough to call on every keystroke.

### Letter generation

Two layers in `game/letters.js`:

**1. Stratified row construction (`rollRow`)**
Rather than independently sampling 5 cells and rejection-checking the
result, we build each row by *slot purpose* and pick distinct letters
from each pool:

- Pick a vowel count of 2 or 3, biased by `difficulty.vowelBias`
  (Chill 0.46 → 3 vowels ~46%, Frenzy 0.34 → 3 vowels ~34%).
- Draw that many distinct vowels from the weighted pool
  `AAAEEEIIIOOUU` — repetitions in the pool give E/A/I higher
  selection probability without ever putting two of them in one row.
- Always include 1 R/S/T/L/N anchor.
- With probability `difficulty.rareLetterChance`, include 1 rare
  letter (J/Q/X/Z).
- Fill remaining slots with distinct, *digraph-biased* consonants:
  35% from `COMMON_HIGH = RSTLN`, 40% from `COMMON_MID = DHCMPG`
  (letters that form glue patterns like TH, SH, CH, CR, CL, PR, PL,
  GR, MP, ND), 25% from `COMMON_OTHER = BFKVWY` (long tail).
- **Place vowels at non-adjacent slot positions.** Instead of a pure
  random shuffle, `placeAvoidingAdjacentVowels` enumerates the
  position sets of size `vowelCount` over 5 slots where no two chosen
  indices are consecutive (6 sets for 2-vowel rows; the single
  `{0,2,4}` set for 3-vowel rows), picks one uniformly, drops the
  vowels in, and fills the rest with consonants. **No new row ever
  has two horizontally-adjacent vowels.** Verified by 5000-row smoke
  test: 0% horizontal adjacency.

Hard guarantees: all 5 letters distinct, 2–3 vowels, ≤ 1 rare,
≥ 1 R/S/T/L/N anchor, **no horizontally-adjacent vowels within a
row**. No retries, no patchers — every roll is structurally valid.

**2. Playability scoring (`rollPlayableRow`)**

This is the function the reducer actually calls. It draws
`QUALITY_ATTEMPTS` (= 20) candidate rows. For each candidate it
simulates arrival on the current columns, enumerates every distinct
3–5 letter word on the resulting grid (DFS, deduped, capped at 200)
**against the curated common-words dictionary** (≈ 12.7k entries —
not full ENABLE), and **scores** the candidate. The first candidate
that clears the per-difficulty threshold wins; if none clear the
bar after 20 attempts, the highest-scored candidate is returned as
a graceful fallback.

**Why two dictionaries?** Word *acceptance* (when the player
submits) uses full ENABLE so legal Scrabble plays still count.
Word *enumeration for playability* uses the common-words subset so
the scorer matches what a typical English-speaker can actually spot
under time pressure. Without this split, a board that's technically
rich but full of obscure entries (`firn`, `nidi`, `airn`, `aas`)
would falsely register as "playable". Verified on the user's
problematic `UTFAS / NDIHA / IRUGL` board: 86 distinct ENABLE words
collapse to 39 common words (still plenty — `fair`, `said`, `shag`,
`drug`, `hair`, `rift`, `gift`, `gash`, `shaft`, `shift`, `drift`,
…) but now the count actually predicts the player's experience.

This replaced an earlier "first row whose post-arrival grid contains
*any* 3+ letter ENABLE word" check, which let through rows whose new
tiles were islands — the dictionary find could be entirely on
unrelated tiles, leaving the player with a dead adjacency graph.

**Scoring rules**

```
+10 per distinct length-3 word
+20 per distinct length-4 word
+35 per distinct length-5 word
+5  if the word's path includes any new-row tile
+5  if the word's path includes any tile in the topmost occupied row
-5  per 8-adjacent vowel-vowel pair on the resulting grid
```

The vowel-adjacency penalty handles the *cross-row* clusters that
the in-row constructive placement can't address: when a new vowel
would land on top of (or diagonally next to) an existing vowel, the
penalty makes the candidate score worse, so `rollPlayableRow` —
which already takes the best of 20 candidates — tends to pick
arrivals that disperse vowels across columns rather than stacking
them.

**Per-difficulty thresholds** (`DIFFICULTY[d].quality`):

```
chill:    minLongWords=4  minNewRowUses=2  minHighestUses=1
standard: minLongWords=2  minNewRowUses=1  minHighestUses=1
frenzy:   minLongWords=1  minNewRowUses=0  minHighestUses=0
```

`minLongWords` counts distinct **4–5 letter** words (not 3+). ENABLE
is permissive with obscure 3-letter entries (`aa`, `aal`, `ait`,
`fas`, `dit`, ...) that don't translate to "a human will spot this
under time pressure"; the length-4+ count correlates much better
with player-perceived playability.

`minNewRowUses` and `minHighestUses` count words of *any* length
(≥3) whose paths involve those rows. A row of new tiles that
doesn't contribute to any word is by definition not integrating
with the rest of the board.

**Seed-row exception**

When `columns` is empty (game start), thresholds are relaxed to
`{ minLongWords: 0, minNewRowUses: 0, minHighestUses: 0 }` because a
single 5-tile linear strip can naturally only produce a handful of
horizontally-connected words.

**Graceful degradation**

If pathological RNG produces 20 candidates that all miss the bar,
the highest-scoring candidate wins anyway. Empirically (smoke test:
50 trials per difficulty, 3 sequential rows each) every difficulty
hit the threshold on every trial with averages of ~50+ length-4+
words per board. The fallback path is a defensive guard, not the
norm.

The dictionary lives on reducer state (set via `SET_DICTIONARY` in a
`useEffect` watching the `dictionary` prop), so this validation runs
inside reducer-pure functions without needing outer-scope refs.

**Performance**

Per arrival: ~1.5ms in Node, well under the 16ms budget for a 60Hz
visual frame and only triggered ~once every 5–15s anyway. The
DFS-with-`visited`-Set has bounded explosion (max 8·7·6·5 = 1680
paths per starting cell at length 5, capped at 200 distinct words
total per board).

### Scoring

`scoring.js`:

- `wordBasePoints(word)` = `10 * length + 5 * (length - 3)^2`
- `awardPoints({ word, comboCount, chainStep })`
  = `base × (1 + 0.25 × max(0, combo-1)) × (1 + 0.5 × max(0, chain-1))`

`combo` is the number of consecutive clears within `COMBO_WINDOW_MS`
(4 seconds). It increments on each successful clear and resets to 0
when the window lapses without another clear. `chain` is wired but
always `1` today — we don't yet auto-clear gravity-formed words.

Bonus toasts:
- Every clear → `+N` toast.
- Combo ≥ 2 → extra `COMBO x{n}` toast.
- Path length ≥ 6 → extra `HUGE CLEAR` toast.

### Difficulty (in `constants.js`)

```
chill      seconds=15.0  pressureFloor=10.0  acceleratePerWord=0.985  vowelBias=0.46  rare=0.02
standard   seconds=10.0  pressureFloor=6.0   acceleratePerWord=0.975  vowelBias=0.40  rare=0.05
frenzy     seconds=7.0   pressureFloor=4.0   acceleratePerWord=0.96   vowelBias=0.34  rare=0.10
```

- `seconds` is the **starting** row interval.
- `acceleratePerWord` is multiplied into `rowInterval` on each clear,
  clamped at `pressureFloor` (in seconds).
- `pressureFactor(columns)` shaves up to 25% off the *effective*
  interval as the board fills (used only for the progress bar — base
  interval is unaffected so the cadence isn't permanently faster).

---

## 4. State machine

`useGame(dictionary)` is a `useReducer` plus a single `requestAnimationFrame`
loop. The reducer is the only place state changes.

### Phases

`'idle' | 'playing' | 'gameover'` — controlled by `App.jsx` which renders
the matching screen.

### Actions

| Action | Trigger | Effect |
| --- | --- | --- |
| `START_GAME` | TitleScreen "Play" or GameOverScreen "Play again" | Resets state, picks first `nextRow`, sets phase = playing |
| `SET_DIFFICULTY` | TitleScreen card click | Only valid in idle |
| `STOP_GAME` | Red stop button on PlayScreen | Phase → gameover |
| `RESET` | "Main Menu" on GameOverScreen | Phase → idle, difficulty preserved |
| `TICK` | rAF loop (only while phase=playing) | Advances `rowProgress`, `elapsedMs`, expires combo + toasts; if `rowProgress ≥ 1` and no clear is in flight, calls `arriveRow` inline |
| `ARRIVE_ROW` | (Only via TICK today) | Pushes `nextRow` onto bottom of every column. If any column was full → phase = gameover + heavy shake + red flash |
| `CLEAR_START` | `submitPath` on a valid word | Marks tile ids as `clearingIds`; tiles get the `.animate-tile-clear` class |
| `CLEAR_END` | `setTimeout(ANIM.tileClear)` after CLEAR_START | Filters cleared tiles out of columns (causing gravity), awards points + combo, queues toasts, shrinks `rowInterval` |
| `INVALID` | `submitPath` rejects (too short / unknown / no path) | Increments `shakeKey` to retrigger board shake |

### Board-arrival deferral

`TICK` will *not* trigger `ARRIVE_ROW` while `clearingIds.size > 0`.
Reason: clear and arrival animations overlapping looks chaotic. The
defer is invisible because clear animations finish in ~150ms.

### Manual invariants worth knowing

- A new tile's `id` is assigned **once** at row roll time (or on a fresh
  arrival in `applyArrival`). It must never change.
- `columns` is *always* per-column-stacks, length ≤ ROWS.
- The 2D `grid[row][col]` view is **derived** in `useGame` via
  `useMemo` — never stored back.

---

## 4½. Lifelines

Three single-purpose actions the player can spend to relieve pressure
or recover opportunity. Constants live in `constants.js`:

| Constant | Value | Meaning |
| --- | --- | --- |
| `LIFELINE_INITIAL_USES` | 2 | Starting count for Bomb / Collapse at game start |
| `LIFELINE_MAX` | 3 | Cap on accumulated Bomb / Collapse uses |
| `LIFELINE_REGEN_EVERY_WORDS` | 8 | Each `N`-th cleared word grants +1 to **each** of Bomb / Collapse |
| `SCRAMBLE_INITIAL_USES` | 1 | Player starts with one Scramble charge so the mechanic is discoverable from round 1 |
| `SCRAMBLE_MAX` | 1 | Cap on held Scramble charges |
| `SCRAMBLE_REGEN_EVERY_WORDS` | 15 | Each `N`-th cleared word *attempts* to award a Scramble charge (silently dropped if already at cap) |

State is tracked as `bombUses`, `collapseUses`, `scrambleUses`.
`CLEAR_END` (the action that finalises a successful word) is also the
regen tick — when `wordsCount` becomes a multiple of the respective
regen interval, the corresponding lifeline gets +1 (capped) and a
`LIFELINE +1` / `SCRAMBLE +1` toast is queued.

### Bomb (`useBomb`)

Algorithm (`game/lifelines.js → bombTargetIds`): walks the grid view
from `target = COLS` down to `target = 1`; for each target tile-count
walks rows top-down (row 0 first) and returns the ids of the first
row whose populated count equals `target`. So a row of 5 wins over a
row of 4; among 4-tile rows, the topmost (closest to overflow) wins.

Reducer flow: `BOMB_START` records ids in `explodingIds` and
decrements `bombUses` (no-op if the board is empty — use is refunded
by never being decremented). `Tile` renders any id in `explodingIds`
with `.animate-tile-explode` (280 ms punchier-than-clear keyframe
with stagger via inline `animation-delay` so the row reads as a
chained blast). `BOMB_END` (scheduled after `ANIM.tileExplode`)
removes the tiles via the existing per-column filter, and
gravity / column compaction follows automatically.

No score, no combo, no rowInterval shrinkage — bomb is purely
relief.

### Collapse (`useCollapse`)

Algorithm (`game/lifelines.js → computeCollapse`): given the current
per-column stacks containing `N` total tiles, computes target heights
`[fullRows + 1, …, fullRows + 1, fullRows, …, fullRows]` where
`fullRows = floor(N / COLS)` and the leftmost `N % COLS` columns get
the +1. Then pops excess tiles off the top of any over-tall column
(left → right) into a queue, and pushes from the queue onto any
under-tall column's top (also left → right).

The bottom of every column is preserved, so any near-overflow word
patterns the player was eyeing don't get scrambled. CSS `transform`
transitions on tile elements drive the visual fall — no custom
keyframes needed for the repack itself.

The reducer refuses to consume a use if the algorithm reports
`changed: false` (the board is already in a collapsed shape).

Worked example for the canonical case (heights `[5, 2, 2, 2, 5]`,
16 tiles): result heights `[4, 3, 3, 3, 3]`. The top tiles of cols
0 and 4 (3 spilled total) land atop cols 1, 2, 3 in left-to-right
order. Bottom rows of every column stay put.

### Scramble (`useScramble`)

Algorithm (`game/lifelines.js → scrambleColumns`): flatten all tile
objects via `columns.flat()`, Fisher-Yates shuffle, repack into
columns preserving each column's original height. Tile *ids* travel
with their letters, so the React keys stay stable — the existing
transform transition on each tile drives the visible slide from old
to new positions.

A light dictionary-aware quality bias runs `SCRAMBLE_ATTEMPTS=8`
shuffles, scores each candidate's resulting grid with the existing
`scoreBoard` from `letters.js`, and picks the candidate whose grid
has the highest score (i.e. the most distinct dictionary words
formable on the new adjacency graph). Nudges the result toward
playable boards without being deterministic.

Reducer flow is **three phases** so the visible movement reads as
lift → shuffle → settle:

1. `SCRAMBLE_START` (now): marks every current tile id in
   `scramblingIds` and decrements `scrambleUses`. The Board renders
   matching tiles with `.animate-tile-scramble` (lift + jitter
   keyframe on the modern `scale` / `rotate` CSS properties so they
   don't fight the inline `transform: translate(...)`) and refuses
   pointer input while the set is non-empty.
2. `SCRAMBLE_DO` (now + `SCRAMBLE_MUTATE_DELAY = 180 ms`): applies
   the shuffled columns. Tiles slide to new positions via the
   existing 200 ms transform transition, overlapping the back half
   of the keyframe so the motion feels chaotic rather than
   sequential.
3. `SCRAMBLE_END` (now + `ANIM.tileScramble = 700 ms`): clears
   `scramblingIds`, restoring pointer input.

No score, no combo, no rowInterval change, no effect on the
upcoming queued row — Scramble is purely an "opportunity recovery"
mechanic. Tile count and per-column heights are preserved, so
danger level isn't directly reduced.

## 5. Input

`PlayScreen.jsx` owns the canonical `selection` state (the path of
chosen tiles). `Board.jsx` is a controlled component — it receives
`selection`, mutates it via `onSelectionChange`, and signals commits
via `onCommit`. PlayScreen also owns `typed` (the keyboard string).
Three input flows feed the same selection:

- **Drag** — pointer-down on a tile starts the path; pointer-move
  extends through 8-adjacent neighbours; backtracking by dragging
  back over the second-to-last tile pops the last entry. Pointer-up
  *after movement* commits unconditionally (PlayScreen rejects
  too-short paths). The hit zone is **center-biased during drag**:
  `pickTile` accepts an optional `hitInset` (0 for pointer-down,
  `DRAG_HIT_INSET = 0.22` for pointer-move) that shrinks the
  accepting region to the central 56% of each tile. A diagonal drag
  from A to D grazes the corners of the cardinal neighbours B and C
  — those corner regions sit outside the inset, so the path doesn't
  accidentally pick them up. Initial taps still use the full tile so
  edge taps register.
- **Tap-build** — pointer-up *without movement* is treated as a tap
  rather than a drag and **does not clear the path**. Subsequent taps
  extend / backtrack the selection:
    - Tap an adjacent tile not in the path → extend.
    - Tap a non-last tile already in the path → truncate to it.
    - Tap a non-adjacent tile not in the path → start over.
    - Tap the *last* selected tile → commit on the matching pointer-up
      (or, if the path is < 3 long, just clear).
  The same Enter key the keyboard uses also commits an in-progress
  tap selection.
- **Keyboard** — `<input>` tracks `typed`. Each keystroke runs
  `findPath(grid, typed)` and highlights the resolved tiles. `Enter`
  submits, `Escape` clears. **Desktop only**: on narrow viewports
  (`window.innerWidth < 640`) the entire input card is `hidden` and
  the auto-focus useEffect short-circuits, so the on-screen keyboard
  never appears. Mobile players have no word display at all — the
  selection is conveyed by tile highlight + connecting line, and
  the ✓ button in the mobile control strip below the board serves
  as both submit and live validity cue (see Submit button below).
  - A window-level `keydown` listener (active only during
    `phase === 'playing'` and skipped when the `<input>` itself is
    focused, to avoid double-firing) catches the same keys
    everywhere else: any single letter focuses the input + injects
    the char; `Enter` submits via the same `handleEnter`;
    `Backspace` pops the last selected tile (or last typed char if
    there's no tile selection); `Escape` clears both. Enter and
    Backspace fall through to the focused element when nothing is
    selected/typed so a focused lifeline button can still be
    activated by the keyboard.
- **Submit button (✓)** — two placements share the same
  `SubmitButton` component with a `large` prop:
    - **Desktop** — small 36×36 button inside the input card on the
      right.
    - **Mobile** — large 56×56 button in the mobile control strip
      *below* the board (right side of the strip).
  Three visual states (both placements): disabled grey when length <
  3 or no realisable path; primary navy when length ≥ 3 but the word
  isn't in ENABLE (clickable, will trigger the shake reject); success
  green when the word is in ENABLE (clickable, will score). On
  desktop, paired with a one-shot session hint that surfaces the
  first time a tap-built selection reaches 3 letters — the hint is
  omitted on mobile since the FAB itself is unmissable.
- **Mobile floating word display** — between the HUD and the board,
  a slim 36-px-tall band shows `currentInput` in large translucent
  navy when a selection or typed string is active, plus a `+N` base
  score in success-green when the word is in ENABLE. Fades opacity
  in/out, no layout shift. Combo / chain multipliers are not shown
  — they're path-independent multipliers awarded on the resulting
  clear, so the base score is what makes word-length tradeoffs
  legible at the decision point.
- **Mobile control strip** — between the board and the progress bar
  sits a single row holding `[BOMB] [COLLAPSE] ............ [✓]`
  (`flex justify-between`). All three buttons are 56×56 so the touch
  targets read as gameplay abilities. Critically, **no controls
  overlap the board area** — the board is a pure interaction
  surface, so drag-select tracing never risks an accidental tap on
  a lifeline. Compact `LifelinePanel` was bumped from 40 → 56 px
  to match the ✓ size; the desktop vertical sidecar variant on the
  right of the board is unchanged.

Mode-switch rules:

- Typing always wins: any input change drops the in-flight tile
  selection so the input becomes the source of truth.
- When `game.grid` mutates (clear or arrival), the selection is
  reset because tile ids may have moved or vanished.
- Auto-focus on the input fires whenever phase is `playing`, so
  typing-only play needs no clicks.
- **Global letter capture** — a window-level `keydown` listener (only
  active during `phase === 'playing'`) catches single-letter
  keystrokes when the input isn't focused, focuses it, and manually
  appends the letter via `handleTypedChange`. Browsers don't
  reliably forward the keystroke that started focus, so the manual
  append is required. Cmd/Ctrl/Alt-modified keys are ignored.

### Visual feedback during selection

- Selected tiles render in primary navy with a `scale: 1.05` boost.
- A single SVG `polyline` underlays the selected path, drawn in
  semi-transparent navy. Path order is preserved by iterating
  `selectedIds` (a `Set` whose insertion order matches path order).

---

## 6. Animations / game feel — implementation notes

- **Row arrival** — handled by tile `transform` transitions plus the
  "first paint at row=ROWS" trick in `Tile`. Tiles slide in from
  below in 200ms with `cubic-bezier(0.25, 0.8, 0.25, 1)`.
- **Tile clear** — pure CSS keyframe (`tile-clear`) at 150ms; React
  unmounts the tile after the keyframe via the `setTimeout` in
  `submitPath`.
- **Gravity** — same 200ms `transform` transition, no extra code; it
  fires automatically when column indices change.
- **Combo / chain feedback** — toasts come out of the reducer
  (`CLEAR_END`) and render with `animate-fly-in`. They self-prune in
  `TICK` once `now >= expiresAt`.
- **Danger** — `useGame.danger` is true when any column has ≥ 4 tiles.
  The board card gets `animate-danger-pulse` (red glow ring) and the
  next-row progress bar swaps to a darker red gradient.
- **Shake** — `Board` listens to `shakeKey` / `hardShakeKey` props and
  re-applies the corresponding class via DOM mutation + reflow trick.
  Reducer increments those counters at:
  - **shakeKey** — invalid submit, near-overflow row arrival.
  - **hardShakeKey** — overflow (game over).
- **Red flash** — same trick on a `RedFlash` overlay div, driven by
  `redFlashKey` (incremented at game-over).

---

## 7. Persistence

Two layers, deliberately separate so the game stays playable when the
network is down or the leaderboard service is asleep.

### Local — `useHighScore` (`localStorage`)

`wordcollapse:highscore:v1` stores per-difficulty personal bests:

```json
{
  "chill":    { "name": "Dan", "score": 412 } | null,
  "standard": null,
  "frenzy":   null
}
```

`wordcollapse:lastname:v1` stores the most recently submitted player
name as a bare string so the game-over input can pre-fill it on the
next round. Written only when a name is non-empty.

The `storage` event listener keeps both keys live across tabs.

### Remote — `useLeaderboard` + `lib/leaderboard.js`

API base: `https://wordcollapse-api.fly.dev` (Fly app `wordcollapse-api`,
single `shared-cpu-1x` machine, SQLite on a 1 GB volume mounted at
`/data`). Endpoints used:

- `GET /leaderboard?difficulty=<chill|standard|frenzy>&limit=10` →
  array of `{ player_name, score, words, best_word, created_at }`,
  sorted by score desc.
- `POST /submit-score` → body
  `{ difficulty, player_name, score, words, best_word }`.

`fetch` wrapper details:

- 8-second `AbortController` timeout. The Fly machine `auto_stops` when
  idle, so the first request after a quiet period takes ~1–2s to wake;
  8s gives the cold start headroom without leaving the UI hung if the
  service is genuinely down.
- Response normalization tolerates either a bare array or
  `{ leaderboard: [...] }` — the live API returns the bare form today.
- `Content-Type: application/json` for both verbs; no auth headers
  (CORS is wide open server-side per the deployment notes).

### Submit flow (game-over)

1. Player reaches `phase === 'gameover'`. `useLeaderboard` is enabled
   only in this phase (`enabled: game.phase === 'gameover'`) so we
   don't wake the Fly machine on the title screen.
2. Hook fetches top-10 for the played difficulty. While loading, the
   game-over screen shows a "Loading scores…" placeholder.
3. `qualifies(score)` returns true when `score > 0` AND either the
   board has < 10 entries or `score > entries[entries.length - 1].score`.
   Returns false during loading or after a fetch error so we never
   show a stale prompt.
4. If qualified and not yet submitted, the name input appears
   (pre-filled with `useHighScore.lastName`). Submit POSTs the score,
   then re-fetches the leaderboard so the player's row appears in the
   list and gets highlighted (`bg-secondary-50`, primary-blue text).
5. After a successful API submit, `App.handleSubmit` also calls
   `high.submit()` to mirror the entry into the local personal-best
   row — keeping the title screen's per-difficulty card in sync.
6. If the POST fails, `saved` is rolled back so the player can retry;
   a `text-danger-600` line surfaces the error inline.

### Sub-top-10 personal bests — known gap

A player whose score is a new personal best but does NOT crack the
top-10 leaderboard sees no name prompt by design (per UX choice
"Only if it qualifies for top 10"), and so their local high score is
not updated either. The previous best stays on the title screen even
though they exceeded it. Acceptable tradeoff for now; revisit if
players complain.

---

## 8. Setup / run

```bash
# Install
npm install

# Dev (Vite, hot-reload)
npm run dev

# Production build → dist/
npm run build
npm run preview
```

The dictionary is served as a static file from `public/`. No server is
required for play.

---

## 8½. Failure-mode notebook

A running record of in-game failure modes the player has surfaced and
how the system responded. Useful when revisiting a balance lever later
to remember *why* it was set the way it was.

### Dead adjacency graph (resolved 2026-05-08)

**Symptom.** Player got three rows where the letters were
"reasonable English-looking" individually but produced a board with
no obvious play. Example: `UTFAS / NDIHA / IRUGL` — the player felt
like nothing connected.

**Root cause.** The previous playability check was *"does any 3+
letter ENABLE word exist anywhere on the post-arrival grid"*. That
passes even when the new row is an island of letters disconnected
from the rest of the board's word potential — the dictionary find
could be entirely on unrelated tiles.

**Fix.** Switched to a candidate-scoring pipeline (see
"Playability scoring" above). Per-difficulty thresholds now require
words to *involve* the new row and the danger row, not just exist
somewhere.

**Update 2026-05-09 — common-words dictionary added.** Curated
~12.7k entry file `public/common-words.txt` now feeds the
playability scorer (acceptance still uses ENABLE). On the user's
example board, 86 ENABLE matches collapse to 39 common-word
matches (`fair`, `said`, `shag`, `drug`, `hair`, `rift`, `gift`,
`gash`, `shaft`, `shift`, `drift`, …) — the metric now correlates
with what a typical player would recognize under time pressure
rather than overcounting via Scrabble-tournament short words.

## 9. Known gaps / next steps

- **No automated tests** — gameplay logic in `path.js`, `scoring.js`,
  `letters.js`, and the reducer are all easy to unit-test (Vitest +
  React Testing Library would slot in cleanly).
- **No chain reactions yet** — `awardPoints` accepts a `chainStep`
  multiplier but always passes 1. Auto-detecting and clearing
  cascade-formed words after gravity is the natural next feature.
- **No sound** — design feedback hints at audio for danger/impact;
  not wired.
- **No mid-game pause** — design is "no pausing during interactions",
  so this is intentional.
- **Game-over flash → recap** is instant. The mockup feedback
  recommended a brief freeze before the recap UI; we currently fade
  straight to the GameOverScreen.
- **Toast layout** — toasts stack with a fixed 12px offset; if many
  fire at once they overlap. Acceptable while combos are bounded
  (at most 2 toasts per clear), but would need a queue/lane system
  in a heavier feature pass.

---

## 10. Change log

- **2026-05-13 — Quit button matches Wordsmith design.**
  - New `src/components/QuitButton.jsx`, ported from Wordsmith's
    `QuitButton`: 40 × 40 transparent rounded button with a
    red-circle + white-square SVG glyph; hover gets a subtle
    `bg-danger-500/10` tint, the glyph scales up 110% with a
    `brightness-90` pass, and a `font-label` tooltip ("Quit game")
    fades in below. `tabIndex={-1}` + `onMouseDown` preventDefault
    keep the desktop text input focused when the player clicks.
  - PlayScreen replaces both the mobile and desktop stop-button
    inline buttons with `<QuitButton onClick={game.stop} />`. The
    flat-fill red circle / outline-stop icon are gone; the new
    glyph carries the colour itself so the button reads as part of
    the Wordsmith family rather than a Word-Collapse-specific
    flat-fill control.
  - Removed the now-unused `StopIcon` helper from PlayScreen.

- **2026-05-13 — Initial scroll fix + out-of-view chevron affordances.**
  - **Game-start scroll to bottom.** PlayScreen's earlier auto-scroll
    only fired on `totalTiles` increase; the increase from 0 → 15
    happens *before* `useBoardGeometry`'s ResizeObserver has settled
    on the mobile tile size, so the scrollTo landed against the
    default-geometry layout and the actual bottom of the board ended
    up out of view. Added a `[game.phase]`-keyed effect that
    scrolls immediately on `'playing'` *and* re-scrolls after a
    200 ms delay to catch the post-settle layout. Both scrolls use
    `behavior: 'auto'` (instant) since the player hasn't engaged yet.
  - **"More tiles this way" chevron chips.** Small fading chips at
    the top / bottom edges of the board scroll region, visible when
    `scrollTop > 4` (content above) or
    `scrollTop + clientHeight < scrollHeight - 4` (content below).
    Implementation: relative wrapper around the scroll container,
    chips are absolute, pointer-events: none, z-10. State tracked
    via a scroll listener + ResizeObserver, re-bound when
    `boardGeometry.tileSize` changes.

- **2026-05-13 — Center-biased hit zone for drag selection.**
  - **Symptom.** Diagonal drags on mobile frequently picked up the
    cardinal neighbour (right/left/above/below) of the source tile
    instead of (or in addition to) the diagonal target — the finger's
    path grazed the cardinal cell's interior briefly on the way
    across.
  - **Fix.** `pickTile` accepts an optional `hitInset`; pointer-down
    keeps the generous full-tile hit area so taps near the edge
    still register, while pointer-move uses
    `DRAG_HIT_INSET = 0.22` to restrict the hit zone to the central
    ~56% of each tile. A clean diagonal from A's center to D's
    center crosses the *corners* of B and C, which sit well outside
    the inset rectangle, so neither cardinal neighbour gets
    accidentally picked up. Off-diagonal drags that genuinely linger
    over a cardinal cell still pick it up (the finger enters that
    cell's inset region).
  - Threshold tuned by feel; lower values feel slacker (cardinals
    triggered too easily), higher values feel sticky (finger has to
    overshoot before a tile commits).

- **2026-05-12 — Pin layout + scrollable board.**
  - **No more full-page scroll.** PlayScreen outer wrapper is now
    `h-[100dvh] overflow-hidden flex flex-col`; the page stays
    locked to the viewport during gameplay regardless of column
    height. Resolves Safari/iOS address-bar reflow and page-pull
    issues.
  - **Board scrolls internally.** The middle flex child is
    `flex-1 min-h-0 overflow-y-auto overscroll-contain`; when the
    full 10-row Board is taller than this region (mobile) the
    container scrolls. Desktop layouts fit naturally and the
    overflow-y rule is a no-op.
  - **Board.jsx simplified.** Removed the viewport-cropping logic
    (`viewportRows`, `topRow`, `yOffset`, height transition, etc.).
    Board always renders the full ROWS-tall inner container. Card
    `overflow: hidden` still clips the entry animation. ~50 lines
    of state lighter.
  - **Auto-scroll on row arrival.** `useEffect` watches
    `game.totalTiles` via a ref; on increase (a row arrived; clears
    decrease it, scrambles don't change it) the container smoothly
    scrolls to its bottom so the new row is visible without
    manual scrolling.
  - **Touch model.** Tiles keep `touch-action: none` so drag-select
    in any direction (including vertical for `EYE`-style words)
    doesn't compete with browser pan. Empty cells / placeholders /
    gaps default to `auto`, so a touch that begins on a non-tile
    region pans the scroll container.
  - **Toasts hoisted out.** Toasts now render at the
    PlayScreen outer level, so a `+points` / `COMBO x3` overlay
    stays anchored to the viewport even while the board scrolls.

- **2026-05-12 — Polish: Best-word overflow, selection persistence, selected-tile bleed.**
  - **GameOverScreen — Best Word font tiers.** Replaced the
    single-breakpoint font tier (`>4 chars`) with a length-based
    ladder: 4 chars → 3xl, 5–6 → xl, 7–8 → lg, 9+ → base. Added
    `truncate` + `title` as a safety net. Closes the
    "HOLLYWOOD overflows its tile" report.
  - **PlayScreen — selection persists across row arrivals.** The
    `useEffect` that watched `game.grid` used to blow the selection
    away on every column mutation. Replaced with a remap: look each
    selected id up by `findTilePos`, take its new (row, col); drop
    the whole selection only if any id is missing (cleared) OR if
    any consecutive pair is no longer 8-adjacent (gravity broke
    the path). For pure row arrivals every existing tile shifts up
    by one row, so adjacency is preserved and the player's
    in-progress tap-build survives.
  - **Board — selected tiles no longer scale.** Removed
    `scale-[1.05]` from the selected-tile className. Replaced with
    a slightly stronger drop shadow (`shadow-xl` + heavier color)
    so the visual feedback is still unmissable. Fixes selected
    tiles in any row visually bleeding into the row below.

- **2026-05-12 — Restructure GameOverScreen for mobile.**
  - **Information hierarchy.** Top → bottom is now: outcome
    (GAME OVER + score) → 3 stat tiles → small celebratory callout →
    save flow (when relevant) → primary CTA (Play Again) → secondary
    CTA (Main Menu) → collapsible Leaderboard → collapsible Words
    Found. Replay button is now above the fold on common phone
    viewports without scrolling.
  - **Third stat tile is now Rank, not NEW.** Quantitative ("#4"),
    consistent with the other two tiles, and emotionally consequential
    — gives the run identity. New `computeRank` helper reads
    `leaderboard.entries` (preferring `submittedEntry` post-save) and
    returns the player's position, with "—" for loading / error /
    outside-top-10.
  - **"New Personal Best" badge.** Small inline chip below the stat
    tiles (when `isHighScore`) instead of consuming a full tile.
  - **Collapsible sections.** `<CollapsibleSection>` wraps both the
    Leaderboard and the Words Found list. `defaultOpen` is `!narrow`
    via the new shared `useNarrowViewport` hook — open on desktop,
    collapsed on mobile so the replay CTA stays above the fold.
  - **Shared `useNarrowViewport` hook.** Extracted from PlayScreen
    into `src/hooks/useNarrowViewport.js` so both screens share a
    single matchMedia listener for the 640 px breakpoint.

- **2026-05-12 — Reduce adjacent vowels.**
  - **Symptom.** Player feedback after many rounds: too many
    adjacent vowels, both within rows and stacked vertically.
  - **Root cause.** `rollRow` ended in a uniform shuffle of all 5
    slot letters, so the only no-adjacent-vowel arrangement for a
    3-vowel row (`VCVCV`) had ~10% probability. Cross-row stacking
    was unconstrained — `scoreBoard` only counted words, so a
    candidate with vowels piled directly on top of an existing
    vowel column scored the same as one with vowels dispersed.
  - **Fix part 1 — constructive placement.** Replaced the row-end
    shuffle with `placeAvoidingAdjacentVowels`: enumerate the
    position sets where vowels are non-adjacent (6 sets for
    2-vowel rows, `{0,2,4}` for 3-vowel rows), pick one uniformly,
    drop vowels in, fill consonants around them. **Horizontal
    vowel adjacency on new rows is now 0%** (verified by a
    5000-row smoke test).
  - **Fix part 2 — `scoreBoard` penalty.** Added a
    `VOWEL_ADJACENCY_PENALTY = 5` per 8-adjacent vowel-vowel pair
    on the simulated post-arrival grid. Steers
    `rollPlayableRow`'s best-of-20 candidate selection toward
    arrivals that disperse vowels across columns rather than
    stacking them — the only thing the in-row constructive
    placement can't address.

- **2026-05-12 — Add Scramble lifeline.**
  - **Third lifeline button** with the Lucide-style Shuffle icon
    and a new amber `warn` tone. Renders alongside Bomb / Collapse
    in both the mobile control strip and the desktop sidecar.
  - **Earning curve.** Player starts at 1 charge so the mechanic
    is discoverable from round 1; recharges +1 every
    `SCRAMBLE_REGEN_EVERY_WORDS = 15` cleared words, capped at
    `SCRAMBLE_MAX = 1`. Awards above the cap are silently dropped
    so a stockpiled charge feels rare and valuable. New
    `SCRAMBLE +1` toast on each successful recharge.
  - **Algorithm.** `game/lifelines.js → scrambleColumns`:
    Fisher-Yates over `columns.flat()`, repack into columns
    preserving each column's height. Tile ids travel with their
    letters so React keeps the same DOM nodes — the existing
    transform transition handles the slide animation for free.
    Dictionary-aware quality bias (8 attempts, pick the highest
    `scoreBoard` result) nudges toward playable adjacencies.
    Exposed `scoreBoard` as a top-level named export from
    `letters.js` so lifelines.js can reuse it.
  - **Three-phase animation.** `SCRAMBLE_START` marks all tile ids
    in a new `scramblingIds` Set (lifts + jitters via the new
    `.animate-tile-scramble` keyframe — uses the modern `scale` /
    `rotate` CSS properties so it composes cleanly with the inline
    `transform: translate(...)`); `SCRAMBLE_DO` swaps columns at
    `SCRAMBLE_MUTATE_DELAY = 180 ms` so the slide overlaps the
    wobble; `SCRAMBLE_END` clears the set at `ANIM.tileScramble =
    700 ms`. Pointer input on the Board is blocked while
    `scramblingIds.size > 0`.
  - **No collateral effects.** No score, no combo, no rowInterval
    change, no effect on the upcoming queued row. Tile count and
    per-column heights are preserved.
  - **Side fix.** `START_GAME` now also preserves `commonDict`
    (previously was reset to `null`, requiring the dictionary
    effect to re-fire on each new round).

- **2026-05-12 — Mobile vertical-density polish pass.**
  - **HUD: score now geometrically centered.** Replaced the mobile
    `flex justify-between` HUD with `grid grid-cols-3` and
    `justify-self-{start,center,end}` so the score sits at the true
    center of the screen, independent of the timer pill / stop
    button widths.
  - **Outer container gap 8 → 6 px**, floating word display
    `h-9 → h-6`, text-2xl → text-lg, badge text-lg → text-sm.
    Reclaims ~28 px between the HUD and the board card.
  - **Viewport MIN 7 → 5, BUFFER 3 → 2.** Less aggressive growth:
    game start (maxHeight=3) now shows 5 rows instead of 7, the
    board card grows by one row per column-height step from
    `maxHeight >= 4`, and the full 10 rows are revealed only at
    `maxHeight >= 8` (was 7). The card is ~140 px shorter at game
    start, and the next-row preview no longer sits below the fold
    on common phone viewports during early-mid play.

- **2026-05-12 — Drop the sliding viewport for a bottom-anchored
  growing one.**
  - **Symptom.** Even with the 350 ms slide-up hold, the player saw
    a row "rise up" and then "go back down" 600 ms later as the
    viewport scrolled up and the just-arrived row 9 clipped out of
    the bottom of the window.
  - **Root cause.** A fixed 7-row viewport that slides to expose
    row 0 cannot keep row 9 visible — it's a structural property
    of the design, not a timing issue. The 350 ms delay only
    deferred the disappearance; it didn't prevent it.
  - **Fix.** Bottom-anchor the viewport and let it grow upward:
    `viewportRows = clamp(maxHeight + 3, 7, 10)`,
    `viewportTop = ROWS - viewportRows`. Card stays at 7 rows
    through maxHeight 4, grows by one row per column-height step
    after that, maxes out at 10 rows. Row 9 is always visible —
    new arrivals can never clip. Removed `useState`/`useEffect`
    for viewportTop (no slide to delay) and
    `VIEWPORT_SLIDE_UP_HOLD_MS`.
  - **Tradeoff.** Card grows downward in the page flow when
    columns get tall (height 5+), pushing the next-row preview
    lower. Acceptable given the player's attention in late game
    is on the board itself; better than the previous behavior of
    making a freshly-arrived row visually disappear.

- **2026-05-12 — Bugfix: invisible row arrivals on slide thresholds.**
  - **Symptom.** On Frenzy: occasionally "the timer finishes but a new
    row does not rise up." Reproducible at every 4→5, 5→6, 6→7
    max-column-height transition.
  - **Cause.** When a row arrival raised `maxColumnHeight` across a
    slide threshold, `targetTop` recomputed in the same render the
    new tile mounted. The new tile at row 9 was positioned at
    `(9 - newTop) * cellStride`, which exceeded `visibleInnerHeight`
    by ~`tileGap`. The card's `overflow: hidden` then clipped the
    tile during its entry animation — visually identical to the
    arrival not happening.
  - **Fix.** `viewportTop` is now `useState` + a `useEffect` that
    defers slide-**up** (target < current) by 350 ms so the arrival
    animation plays at the still-bottom-anchored viewport before
    the camera scrolls. Slide-**down** (target ≥ current, e.g.
    clears shrinking columns) still applies immediately.

- **2026-05-12 — Fixed 7-row sliding viewport on mobile.**
  - Replaced the "grow visible rows with max column height" crop
    with a **fixed 7-row window** that scrolls vertically across the
    board. The window is bottom-aligned (rows 3–9) when the board
    is safe and slides upward as columns grow, ending at rows 0–6
    when overflow is imminent — so the player always sees the
    dangerous part of the board. Off-screen new arrivals are still
    visible in the next-row preview, so planning information stays
    complete.
  - `Board.jsx` prop API changed from `visibleRows` to
    `(viewportRows, topRow)` so the same component handles both the
    desktop full-board case (`ROWS, 0`) and the mobile sliding case
    (`7, dynamic`). `pickTile` now clamps to the visible row range so
    pointer-capture can't accidentally pick a clipped tile.
  - New `useNarrowViewport` hook in `PlayScreen.jsx` wraps a
    `matchMedia('(max-width: 639px)')` listener — orientation
    changes / window resizes flip the viewport mode live.
  - **Smaller next-row preview tiles on mobile.** 40 × 30 px with
    `opacity-50` (was board-tile-sized at `opacity-60`) — preview
    reads as low-priority incoming info rather than competing with
    the live board tiles.

- **2026-05-12 — Global Enter / Backspace / Escape.**
  - The window-level keydown listener used to only handle single
    letter keys. Extended to also handle `Enter` (submit via
    `handleEnter`), `Backspace` (pop last selection tile, or last
    typed char if no selection), and `Escape` (clear both). All
    gated on "input not focused" to avoid double-firing with the
    desktop `<input>`'s own onKeyDown. Enter and Backspace fall
    through (no preventDefault) when there's nothing to submit/pop,
    so focused lifeline buttons can still be activated via keyboard.
  - `handleEnter` is read through a fresh-every-render ref
    (`handleEnterRef`) so the once-attached listener always calls
    the current version rather than the closure from first render.
    Fixes desktop-simulating-mobile workflow where drag is tedious
    and the player wants real keyboard shortcuts.

- **2026-05-12 — Move mobile controls off the board.**
  - **Lifelines + ✓ now live in a row below the board** (between
    board and progress bar), not as FABs overlapping the board
    corners. Layout: `[BOMB] [COLLAPSE] ............ [✓]` with
    `flex justify-between`. Restores the board as a pure interaction
    surface — drag-tracing never risks an accidental lifeline tap,
    and the bottom row of tiles is no longer visually crowded by
    chrome during pressure moments.
  - **Compact lifeline buttons 40 → 56 px.** Bumped `w-10 h-10` to
    `w-14 h-14`, icon 20 → 24 px, badge 16 → 20 px, gap 2 → 3.
    Matches the ✓ FAB size so all three controls in the new strip
    read at one size class. The buttons now register as gameplay
    abilities rather than utility chrome.

- **2026-05-12 — Mobile viewport efficiency pass.**
  - **Dynamic empty-row cropping.** Board internal size is still
    `ROWS=10`, but the visible area now only renders the bottom
    `visibleRows = clamp(maxColHeight + 3, 5, 10)` rows. At game
    start (max-col = 3) the board shows 6 rows; as columns fill
    the visible area opens up upward, reaching the full 10 by the
    time any column has 7+ tiles. `Board.jsx` does the crop via a
    `yOffset` subtracted from tile positions plus `overflow: hidden`
    on the card chrome; gameplay code paths (gravity, overflow,
    path finding) operate on the full 10-row grid unchanged. Picks
    user feedback's recommended path over reducing `ROWS` so
    strategic depth is preserved.
  - **Tighter mobile padding.** Page outer padding `px-3 py-3` →
    `px-2 py-2`; column gap `gap-3` → `gap-2`. Board frame padding
    branched: `NARROW_BOARD_FRAME_PADDING=12` (was the same 28 as
    desktop). Threaded `framePadding` through `useBoardGeometry`
    + `makeBoardGeometry` so geometry width math correctly reserves
    the smaller mobile frame. Board card border-radius now
    `rounded-2xl sm:rounded-3xl` for a tighter mobile look.
  - **Compressed mobile HUD.** Lifelines pulled out of the top
    action bar; remaining items are timer · score · stop only.
  - **Mobile lifeline FABs.** Bomb + collapse compact buttons now
    float at the board's `-bottom-3 -left-3` corner, mirroring the
    ✓ FAB on the right. Slight overlap with the board chrome is
    deliberate per design spec.
  - **Mobile floating word display.** Slim 36-px band between HUD
    and board fades in `currentInput` (large navy tracking) plus
    `+wordBasePoints` in success-green when the word is in ENABLE.
    No layout shift; opacity-only transition. Replaces the
    previously-displayed word card / input on mobile entirely.

- **2026-05-12 — Mobile keyboard + scroll fixes.**
  - **No `<input>` or word card on mobile.** PlayScreen's input card
    is now `hidden sm:flex` — desktop keeps the real `<input>` for
    keyboard play, mobile shows nothing in its place. The auto-focus
    useEffect short-circuits when `window.innerWidth < 640`, so
    nothing summons the on-screen keyboard. The current word being
    built is conveyed entirely by tile highlight + connecting line
    on the board. Closes the *"keyboard pops up and eats half the
    screen the moment the round starts (and stays up when tapping
    tiles)"* report.
    - Earlier draft kept a read-only word display panel on mobile;
      removed after the user confirmed they wanted no card at all.
  - **Mobile ✓ FAB on the board.** New `large` prop on
    `SubmitButton` (56×56, rounded-2xl, larger check icon).
    Rendered as a sibling of `<Board>` inside the board area with
    `absolute -bottom-3 -right-3 z-10 sm:hidden`, so it overlaps
    the board card's bottom-right corner. Same three color states
    as the desktop ✓ — grey disabled / navy clickable-but-invalid /
    green valid-word — so the FAB doubles as a live validity cue.
    Disabled state gets a subtle border so it doesn't blend into
    the paper-colored board card.
  - **Per-tile `touch-action` instead of container-wide.** `Board.jsx`
    used to set `touch-action: none` on the whole grid container,
    which blocked vertical page scroll when the finger was anywhere
    on the board. Moved `touch-action: none` onto the absolutely
    positioned tile elements only; the container and the empty-cell
    placeholders default to `auto`, so touches on empty grid space
    let the page scroll. Drag-selects still capture cleanly because
    they begin on a tile (where `touch-action: none` applies) and
    `setPointerCapture` carries the gesture across the rest of the
    grid. Closes the *"can't scroll the page while touching the
    board"* report.

- **2026-05-11 — Aggressive mobile consolidation.**
  - **Single top action bar on mobile.** Restructured the PlayScreen
    header into two parallel renders: a compact mobile bar
    (`flex sm:hidden`) holding `[⏰ timer · score · stop · 💣 · ⬇]`,
    and the original two-group desktop header (`hidden sm:flex`).
    Difficulty card and words count are dropped on mobile — difficulty
    is a round-start choice and words count is available on the
    gameover screen.
  - **Lifelines moved into the mobile header.** Lifelines no longer
    render below the board on mobile; they're now the rightmost
    elements in the top action bar. Tradeoff acknowledged: lifelines
    are out of the easy-reach thumb zone, but stay one tap away from
    every gameplay moment, and the previously-stacked horizontal
    row below the board cost ~70 px of vertical real estate.
  - **`LifelinePanel` gains a `compact` prop.** Compact = 40 × 40 px
    rounded-xl buttons with smaller icons (20 px) and a smaller
    16 px badge; horizontal flex always. Default unchanged (64 × 64
    rounded-2xl vertical for the desktop sidecar).
  - **Desktop lifelines moved to `hidden sm:flex` sidecar only.**
    The old mobile-stacked lifeline row below the board has been
    removed; only the absolute-positioned right-side sidecar
    remains, gated by `sm:` breakpoint.

- **2026-05-11 — Mobile polish pass.**
  - **Width-driven tile sizing on narrow viewports.** `useBoardGeometry`
    now branches on `availW < NARROW_VIEWPORT_BREAKPOINT (640px)`: on
    narrow widths it ignores the height constraint and uses width-only
    sizing capped at `NARROW_MAX_TILE_SIZE=64`. The page is allowed to
    scroll vertically on mobile — the tradeoff is tap-target tiles
    that fill the horizontal space, which the player explicitly asked
    for. Desktop branch unchanged (still fit-to-viewport with cap 46).
  - **Horizontal lifelines on mobile.** `LifelinePanel` is now
    `flex gap-3 sm:flex-col` — row of two buttons below the board on
    mobile, column sidecar on desktop. Cuts the vertical overhead of
    the lifeline area roughly in half.
  - **PlayScreen layout drops fit-to-viewport on mobile.** Outer
    container is now `sm:flex sm:flex-col` (no flex on mobile) and the
    inner container loses `flex-1 min-h-0` on mobile so content can
    push the page taller than the viewport. Header gets tighter mobile
    spacing: `gap-2 sm:gap-3`, smaller score (`text-3xl sm:text-5xl`),
    smaller stop button (`w-10 sm:w-11`), and slimmer difficulty card
    padding.
  - **GameOver Save button overflow fix.** Name input + Save are now
    `flex flex-col gap-3 sm:flex-row` so on mobile they stack
    vertically (button gets `w-full sm:w-auto`); on desktop they
    stay side-by-side. Outer card padding reduced from
    `p-8 sm:p-12` to `p-5 sm:p-12` and outer page padding from
    `px-4 py-8` to `px-3 py-6 sm:px-4 sm:py-8` so the card breathes
    on narrow phones.
  - **Title screen high score now uses the live leaderboard.** App
    enables `useLeaderboard` whenever `game.phase !== 'playing'`,
    keyed off `pendingDifficulty` on the title screen and
    `game.difficulty` on gameover. The title's "High Score" card
    prefers the global top-1 entry from the leaderboard, falling back
    to the local personal best when the network hasn't responded yet
    or the leaderboard is empty. Shows a `Loading…` placeholder while
    the cold-start fetch is in flight. Closes the *"first visit shows
    No score yet"* gap.

- **2026-05-10 — Remote leaderboard wired up.**
  - **API service.** Hooked the game to `wordcollapse-api.fly.dev`
    (Fly app, single shared-cpu-1x machine in `sjc`, SQLite on a
    1 GB volume at `/data`). Endpoints: `GET /leaderboard`,
    `POST /submit-score`, `GET /health`.
  - **New files.** `src/lib/leaderboard.js` (fetch wrapper with 8s
    `AbortController` timeout for the Fly cold-start window;
    normalizes either `[...]` or `{ leaderboard: [...] }`),
    `src/hooks/useLeaderboard.js` (per-difficulty fetch + `qualifies()`
    + `submit()` + stale-response guard via a `reqIdRef`).
  - **Submit-flow UX (per user choice).** Name prompt fires
    *only* when the score qualifies for the top 10 — i.e. board has
    < 10 entries OR score beats the 10th-place cutoff. Sub-top-10
    personal bests no longer prompt and so don't update local high
    score either; documented as an explicit known gap in §7.
  - **GameOverScreen** now renders a top-10 leaderboard panel for
    the played difficulty (loading / error / empty / list states),
    highlighting the player's just-submitted entry with
    `bg-secondary-50` + primary-blue text. Submit button shows
    `Saving…` and disables during the POST; failure surfaces an
    inline `text-danger-600` retry message and rolls back the
    `saved` flag so the player can resubmit.
  - **Name pre-fill.** `useHighScore` gained a `lastName` field
    backed by `wordcollapse:lastname:v1` in localStorage. Saved on
    every successful submit, pre-filled into the game-over input on
    the next round.
  - **App.jsx** instantiates `useLeaderboard(game.difficulty,
    { enabled: game.phase === 'gameover' })` so the Fly machine only
    wakes on game-over — title-screen visits don't poke it. The new
    `handleSubmit(name)` calls `leaderboard.submit()` first, then
    mirrors a successful result into `high.submit()` so the
    title-screen personal-best card stays in sync.
  - **Build verified** (`npx vite build` — clean, 232 kB JS / 35 kB
    CSS); dev server boots; `GET /health` and
    `GET /leaderboard?difficulty=standard&limit=10` both responded
    successfully against the live API. **Not yet manually exercised
    in a browser end-to-end** — the qualifies/highlight/error
    branches are covered by the implementation but unverified by a
    play session.
  - **Bugfix (same day).** Pre-fill name input was uneditable —
    clearing the field re-snapped to `lastName`. Cause: a defensive
    `useEffect([lastName, name])` was rehydrating the input on every
    keystroke that emptied it. `useHighScore` already reads
    `lastName` synchronously in the `useState` initializer, so the
    `useState(lastName || '')` initial value is always present on
    the first render — the effect was redundant. Removed it.

- **2026-05-09 — Iteration 6: submit button, validity cue, ambient cleanup.**
  - **Submit button inside the input.** New `SubmitButton`
    component lives on the right side of the input card. Three
    states: disabled grey (`< 3` chars or no realisable path),
    primary navy (length OK, not in ENABLE — will shake on submit),
    success green (in ENABLE — will score). Click fires the same
    `handleEnter` path as the Enter key. Closes the
    "tap-mode-with-no-keyboard" UX gap on mobile.
  - **One-shot submit hint.** First time a tap-built selection
    reaches `MIN_WORD_LENGTH` in a session, a small label fades in
    under the input: *"Tap ✓ or the last letter again to submit."*
    Hidden on first commit (and also rendered with reserved height
    so its appearance doesn't shift the page).
  - **Validity cue uses ENABLE.** The button's "valid word" highlight
    queries the full ENABLE dictionary (the acceptance check),
    threaded into PlayScreen as a new `dictionary` prop from
    `App.jsx`.
  - **Ambient gradient cleanup.** Dropped the bottom-left red glow
    from the body background — with the taller 10-row board it
    bled into the play area and read as an unintentional smudge
    rather than a brand accent. Kept the subtle blue at top-right.

- **2026-05-09 — Iteration 5: common-words, taller board, alignment, countdown.**
  - **Common-words dictionary.** New `public/common-words.txt`
    (~12.7k curated 3–7 letter entries — sorted, dedup'd, filtered
    against ENABLE). Loaded in parallel with ENABLE via
    `useDictionary` and threaded through to `rollPlayableRow`. The
    playability scorer now enumerates against the common-words set
    while word **acceptance** still uses ENABLE. Verified: the
    user's `UTFAS / NDIHA / IRUGL` board drops from 86 ENABLE
    matches to 39 common-word matches (still plenty, but the words
    are actually recognizable: `fair`, `said`, `shag`, `drug`,
    `hair`, `rift`, `gift`, `gash`, `shaft`, `shift`, `drift`).
    All 3 difficulties hit thresholds 50/50 trials at ~2ms/row.
  - **Taller board.** `ROWS = 10` (was 5), `TILE_SIZE = 46` (was
    64), `TILE_GAP = 6` (was 8) — board is 254×494 px, fits a
    laptop viewport but gives the player real breathing room before
    overflow becomes a concern.
  - **Multi-row seed.** `INITIAL_ROWS = 3` (was 1). `START_GAME`
    pumps three rows in sequentially through the playability
    scorer so each seed row is held to the same bar as runtime
    arrivals. Gives the player planning context from turn 0 and
    makes the "highest occupied row" check meaningful immediately.
  - **Alignment fix.** Lifelines were rendered as a flex sibling of
    the board, which shifted the board off the page's true center
    and made input + next-row preview look offset. Refactored to
    `flex flex-col items-center` for the input/board/next-row
    column with lifelines absolute-positioned off the board's
    right edge — board, input, and next-row preview all share the
    same horizontal axis.
  - **Next-row countdown.** New `nextRowRemainingMs` derived from
    `rowProgress`, `rowInterval`, and the fullness pressure
    factor; rendered as `Xs` (whole seconds when ≥ 3, one decimal
    when < 3 for endgame urgency) inline with the "NEXT ROW"
    label. Turns red in danger state.

- **2026-05-08 — Iteration 4: candidate-scored row generation.**
  - **Problem.** Prior generator passed any row that produced "any
    3+ letter ENABLE word anywhere on the board" — letting through
    rows whose new tiles formed an island disconnected from the rest
    of the adjacency graph. Surfaced via player feedback on a
    `UTFAS / NDIHA / IRUGL` board that felt unplayable.
  - **Fix.** Replaced the boolean check with a scoring pipeline.
    `rollPlayableRow` now draws 20 candidates, scores each by
    distinct-word count (weighted by length 3/4/5 → 10/20/35) plus
    +5 bonuses for words involving the new row or the topmost
    occupied row, and returns the first candidate to clear a
    per-difficulty threshold. If none pass, the highest-scored
    candidate falls through.
  - **Thresholds** stored in `DIFFICULTY[d].quality`:
    Chill `4-long-words / 2-new-row / 1-highest`,
    Standard `2 / 1 / 1`,
    Frenzy `1 / 0 / 0`. The "long words" count is length ≥ 4 because
    ENABLE is generous with obscure 3-letter entries that wouldn't
    register as words to a typical player. Seed row at game start
    uses relaxed `{ 0, 0, 0 }` thresholds (linear strip, low ceiling).
  - **Letter pools refactored** into three tiers — `RSTLN` anchors,
    `DHCMPG` digraph-friendly mid (forms TH/SH/CH/CR/CL/PR/PL/GR/MP/ND),
    `BFKVWY` long tail. Fill-letter bias is 35/40/25, concentrating
    rows on letters that actually form glue patterns. Anchor still
    guaranteed from RSTLN.
  - **Performance.** Per-arrival cost ~1.5ms in Node. DFS path
    explosion bounded by 200-distinct-words cap.
  - **Smoke test (50 trials × 3 sequential rows × 3 difficulties).**
    All trials hit the threshold on the first qualifying candidate,
    averaged 50+ length-4+ words per resulting board. The fallback
    "best-scored" branch is a defensive guard, not the norm.
  - **Open caveat documented in §8½** — the example player board
    that triggered this iteration actually has 86 distinct words on
    its own and would have passed the new check. The fix improves
    candidate selection but doesn't fully address player perception
    when ENABLE entries are obscure. Possible follow-ups: curated
    common-words subset for the playability check, hint lifeline,
    further-slowed cadence.

- **2026-05-08 — Iteration 3: lifelines + input polish.**
  - **Lifelines.** Added `Bomb` and `Collapse` lifelines with badged
    buttons rendered to the right of the board (`LifelinePanel.jsx`).
    Each starts with 2 uses, regenerates +1 to *each* every 8 cleared
    words, capped at 3. Algorithms live in `game/lifelines.js`:
      - **Bomb** scans rows top-down for the row with the highest
        tile count and clears those tiles with a punchier
        `tile-explode` keyframe (staggered via inline
        `animation-delay`). No score / combo / cadence change.
      - **Collapse** repacks per-column stacks to stair-stepped
        target heights (leftmost columns get the +1 partial) by
        spilling tops of over-tall columns into shorter columns.
        Bottom rows preserved; CSS transform transition handles the
        fall. Reducer skips burning a use if no change would result.
  - **Lifeline regen tick.** `CLEAR_END` now grants +1 to each
    lifeline every `LIFELINE_REGEN_EVERY_WORDS` words and queues a
    `LIFELINE +1` toast.
  - **Smaller word input.** Constrained to `max-w-sm`, reduced
    vertical padding, smaller font; centered horizontally.
  - **Auto-focus on letter keypress.** A global `keydown` listener
    (active only during `phase === 'playing'`) catches single-letter
    keystrokes when the input isn't focused, focuses it, and
    manually appends the letter via `handleTypedChange` (the natural
    keystroke is dropped during focus transition by the browser).
  - **Microcopy.** Input placeholder updated from `Connect letters`
    to `Create words` (user edit).
  - **Tech_Design** sections updated: file map, animation table,
    new §4½ Lifelines, input section now describes global letter
    capture.

- **2026-05-08 — Iteration 2: stratified letter rolling.**
  - User reported a row of `I T E E E` (three duplicate Es). Replaced
    the reject-sampling row generator with a constructive,
    stratified one in `letters.js`. Each roll now picks vowel count
    (2 or 3, biased by difficulty) → distinct vowels → 1 anchor →
    optional 1 rare → distinct fill consonants → shuffle. No retries
    needed; every row is structurally valid by construction.
  - Hard-coded guarantees per row: **all 5 letters unique**, **2–3
    vowels**, **≤ 1 rare letter**, **≥ 1 R/S/T/L/N anchor**.
  - `rollPlayableRow` (the dictionary-aware wrapper) is unchanged —
    it still simulates arrival and probes for any 3-/4-letter
    ENABLE word, retrying up to 8x if the resulting grid has none.
  - Removed the now-unused `rollLetter` export and the `rowMeetsConstraints`
    + `patchRow` helpers; deleted the `VOWEL_SET`/`HIGH_SET`/`RARE_SET`
    membership-check sets that only existed for the old patcher.
  - Smoke test (10 sample rows, Standard difficulty) showed every row
    matched the new guarantees.

- **2026-05-07 — Iteration 1.** User feedback driven.
  - **Initial board not empty.** `START_GAME` now seeds `columns` with
    one fully-populated row so the player isn't staring at an empty
    grid waiting for the first arrival.
  - **Slower default cadence.** Difficulty timings raised from 7/5/3s
    to 15/10/7s; pressure floors lifted to 10/6/4s.
  - **Title-screen casing fix.** The difficulty card subtitle (`5s PER
    ROW`) was being CSS-uppercased into `5S PER ROW`. Removed the
    `uppercase` Tailwind class on that span; the literal string now
    drives casing (lowercase `s`, uppercase `PER ROW`).
  - **Tap-to-build selection.** Board pointer model now distinguishes
    tap from drag: pointer-up without movement preserves the
    selection so the player can tap-tap-tap a word, then re-tap the
    last letter (or press Enter) to commit. Drag still commits on
    release. Selection state is now owned by PlayScreen and Board is
    a controlled component (`selection` + `onSelectionChange` +
    `onCommit`).
  - **Smarter letter generation.** `rollRow` now enforces ≥2 vowels,
    ≤1 rare letter, ≥1 R/S/T/L/N anchor (retries up to 8x, with a
    deterministic patcher fallback). On top of that, `rollPlayableRow`
    simulates the row arriving on the current board and DFS-probes
    the resulting grid for any 3-/4-letter ENABLE word — retries up
    to 8x if no realisable word exists. Dictionary lives on reducer
    state via a new `SET_DICTIONARY` action.

- **2026-05-07 — Initial scaffold.**
  - Vite 8 + React 19 + Tailwind v4 project bootstrapped at repo root.
  - Wordsmith design tokens ported into `src/index.css`; ENABLE word
    list copied to `public/`.
  - Game model: per-column stacks, derived 2D grid, 8-direction DFS
    path finder, difficulty-weighted letter generation, combo-aware
    scoring.
  - `useGame` reducer with all phase transitions; rAF-driven TICK
    loop drives row cadence + clock; clear→gravity flow uses a 150ms
    timeout to let the clear animation play before tiles unmount.
  - PlayScreen wires drag (pointer-captured on Board) + keyboard
    (controlled input + live `findPath`) to one `selectedIds` set.
  - Animations: tile slide-in from below the board, gravity via
    transform transitions, tile-clear keyframe, danger pulse, shake +
    hard shake on dedicated counters, red-flash overlay at game over.
  - Per-difficulty high score persisted in `localStorage`.
  - Build verified (`npm run build`); dev server confirmed serving on
    localhost. **Gameplay has not yet been manually exercised in a
    browser — first run will likely surface UX polish opportunities.**
