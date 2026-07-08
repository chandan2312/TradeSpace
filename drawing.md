# Drawing Tools — Progress, Plan & Context

## Status: ✅ ALL CODE COMPLETE — Builds successfully — Ready for smoke-test

**Last build: ✓ Compiled successfully (next build, zero errors)**

### What's Done ✅
| # | File | Status |
|---|------|--------|
| 1 | `lib/draw/core.js` | ✅ Complete — types, defaults, geometry, hit-testing |
| 2 | `lib/draw/primitive.js` | ✅ Complete — canvas renderer (DrawingsPrimitive) |
| 3 | `lib/draw/useDrawings.js` | ✅ Complete — interaction hook, multi-pane safe via primRef |
| 4 | `components/DrawingToolbar.jsx` | ✅ Complete |
| 5 | `components/DrawingContextMenu.jsx` | ✅ Complete |
| 6 | `components/DrawingSettings.jsx` | ✅ Complete |
| 7 | `components/ChartPanel.jsx` | ✅ Complete — primRef passed, overlays rendered, handlers merged |
| 8 | `components/Dashboard.jsx` | ✅ Complete — `isActive={activePaneId === pane.id}` passed |

### Only Remaining Step: Smoke-Test
Run `npm run dev` and go through the checklist below.

---

## Architecture Overview

### Tech Stack
- **Charting**: `lightweight-charts` v4.2.0 (no built-in drawing tools)
- **Rendering**: Custom `ISeriesPrimitive` canvas API — same pattern as existing `AlertsPrimitive` and `PatternsPrimitive`
- **Framework**: Next.js 14 + React 18, no new dependencies needed (lucide-react already present)

### How It Works

**Coordinate anchoring**: Every drawing point is `{ logical, price }` — not raw time. Logical indices are stable across bar appends, pan, zoom, and reloads. This matches the existing `PatternsPrimitive` convention.

**Rendering layer**: `DrawingsPrimitive` is attached to the candlestick series via `series.attachPrimitive()`. It paints in `useMediaCoordinateSpace` with `zOrder: "top"` — above candles, alerts, and pattern backdrops.

**Interaction layer**: `useDrawings()` hook owns all state (active tool, drawings array, selection, hover, undo/redo) and exposes `pointerHandlers` that ChartPanel spreads onto the chart wrapper div.

**Persistence**: `localStorage["ts_drawings"]` = `{ "EURUSD:M5": [...], ... }` — debounced save, load on symbol/tf change. Matches existing `ts_*` convention.

**Multi-pane safety**: Each `ChartPanel` owns its own `drawPrimRef` passed to `useDrawings({ primRef })` — no global state conflict across panes.

### File Map

```
lib/draw/
  core.js          → Types, defaults, palette, geometry helpers, hit-testing
  primitive.js     → DrawingsPrimitive (canvas renderer, ISeriesPrimitive)
  useDrawings.js   → React hook: state machine, persistence, undo/redo, pointer handlers

components/
  DrawingToolbar.jsx      → Left-edge vertical icon bar (tools + style editor)
  DrawingContextMenu.jsx  → Right-click menu (clone, delete, lock, hide, z-order)
  DrawingSettings.jsx     → Settings popover (color, width, style, fill, extend, R:R, label)

components/ChartPanel.jsx → Wires in: attaches primitive, calls hook, renders overlays, merges pointer handlers
components/Dashboard.jsx  → Passes `isActive={activePaneId === pane.id}` to ChartPanel
```

---

## Drawing Types (data shapes)

All stored in `lib/draw/core.js`. A point = `{ logical: Number, price: Number }`.

### 1. Trendline
```js
{ id, type:"trendline", p1:{logical,price}, p2:{logical,price},
  color, width, style:"solid"|"dashed"|"dotted",
  extendLeft:false, extendRight:false, showLabel:true,
  hidden:false, locked:false }
```

### 2. Horizontal Line
```js
{ id, type:"horizontal", price,
  color, width, style, showLabel:true, hidden:false, locked:false }
```
Spans full chart width. Single price anchor. Drag handle on right edge.

### 3. Rectangle
```js
{ id, type:"rectangle", p1:{logical,price}, p2:{logical,price},
  color, fill:color, fillOpacity:0.12, width, style,
  hidden:false, locked:false }
```
4 handles: p1 (corner), p2 (corner), p1x (opposite corner helper), p2x (other).

### 4. Risk / Reward Tool
```js
{ id, type:"rrtool",
  entry:{logical,price}, stop:price, target:price, ratio:1,
  color, showLabel:true, hidden:false, locked:false }
```
Entry is a time+price anchor. Stop and target are price-only (horizontal levels).
Shows risk zone (red fill), reward zone (green fill), R:R label.
Drag entry, stop, target independently. Ratio auto-computes.

### 5. Measure
```js
{ id, type:"measure", p1:{logical,price}, p2:{logical,price}, transient:true }
```
Shows Δprice, %, bar count in a readout box. Dashed orange line with axis projections.

---

## Interaction Model

### Drawing Mode (tool active)
- Press → drag → release places the drawing
- Chart drag-pan is disabled via `handleScroll.pressedMouseMove: false` (wheel zoom stays on)
- Live preview rendered at 70% opacity during drag
- Returns to cursor after each draw unless "lock tool" toggle is on
- Escape cancels in-progress draw

### Cursor Mode (no tool active)
- **Click empty area**: deselects, chart pans normally
- **Click drawing body**: selects it (blue selection rings + handles)
- **Drag handle/endpoint**: resize that specific point (trendline endpoint, rect corner, RR stop/target, etc.)
- **Drag body (no handle)**: translate whole drawing
- **Right-click drawing**: context menu (clone, delete, lock, hide, z-order, edit settings)

### Keyboard Shortcuts
- `Escape` — cancel in-progress draw / deselect / close menus
- `Delete` / `Backspace` — delete selected drawing
- `Ctrl+Z` — undo (max 50 snapshots)
- `Ctrl+Shift+Z` / `Ctrl+Y` — redo

---

## Interaction Coexistence with Existing Features

| Feature | Conflict? | How It Coexists |
|---------|-----------|-----------------|
| Chart pan/zoom | No | Drawing mode disables drag-pan only; wheel zoom always works. Cursor mode: drawing hit-test fires `stopPropagation` only on hits, else chart pans normally. |
| Alert drag lines | No | Alerts use `onMouseMove`/`onContextMenu` (mouse events). Drawing tools use `onPointerDown`/`onPointerMove`/`onPointerUp` (pointer events). They fire independently. Context menus are merged: drawing hit-test wins, else alert menu. |
| Pattern indicators | No | PatternsPrimitive at `zOrder:"bottom"` (below candles). DrawingsPrimitive at `zOrder:"top"` (above everything). |
| Crosshair sync | No | Drawing tools don't touch crosshair state. |
| Multi-pane | No | Each pane has its own `drawPrimRef`, own `useDrawings` instance, own drawings array. Toolbar only shows on active pane (`isActive` prop). |

---

## Rendering Details (DrawingsPrimitive)

All in `lib/draw/primitive.js`:

- **Selection glow**: selected drawings get `shadowBlur: 8` for a subtle glow effect
- **Handles**: filled circles (5px) with dark center + colored border, enlarge on hover (6px)
- **Price tags**: small rounded rectangles with price text, auto-positioned, clamped to chart bounds
- **RR tool**: red fill for risk zone, green fill for reward zone, dashed entry connector, E/S/T labels, R:R readout
- **Measure**: dashed orange line, dotted axis projection lines, end dots, centered readout box with price diff, %, bar count
- **Rectangle**: filled with configurable opacity, border stroke

Helper: `hexA(hex, alpha)` converts hex to rgba string.

---

## Hit-Testing (`lib/draw/core.js`)

- `hitTest(drawings, px, py, conv)` → `{ drawing, handle }` or `null`
- Iterates topmost first (end of array)
- Handles checked first (6px radius), then bodies (7px tolerance)
- Body tests: `pointToSegmentDist` for lines, `pointInRect` for rectangles, band check for RR
- `drawingToPx(d, conv)` converts a drawing to pixel-space handles + bodies for hit-testing

---

## Undo/Redo System

- Max 50 snapshots in undo stack
- Snapshots are full `drawings[]` arrays (cheap since typically < 50 drawings)
- During drag gestures, intermediate commits use `noUndo: true` — only the final position gets an undo entry
- The pointer-down wrapper captures the pre-drag snapshot, pointer-up pushes it if the gesture actually moved something
- Undo clears redo stack and vice versa

---

## Style Defaults

```js
DEFAULT_STYLE = { color: "#2962ff", width: 2, style: "solid", fillOpacity: 0.12, showLabel: true }
PALETTE = ["#2962ff", "#ff9800", "#26a69a", "#ef5350", "#ab47bc", "#26c6da", "#ffd54f", "#d7dce6"]
DASH = { solid: [], dashed: [6,4], dotted: [2,4] }
```

---

## Smoke Test Checklist

```bash
cd /home/cc/Downloads/TRADING/TradeSpace
npm run dev      # start dev server, then test:
```
- [ ] Trendline: press-drag to draw, select, drag endpoints, extend left/right, change color/width/style
- [ ] Horizontal: click to place, drag handle to move price, settings panel
- [ ] Rectangle: press-drag to draw, drag corners to resize, drag body to move, fill opacity slider
- [ ] RR tool: press-drag to place (auto-computes stop/target from entry), drag entry/stop/target independently, R:R ratio updates live, edit ratio in settings
- [ ] Measure: press-drag between two points, readout shows Δprice, %, bars
- [ ] Select/deselect: click drawing to select (handles appear), click empty to deselect
- [ ] Delete: press Delete key, or right-click → Delete, or handle ✕
- [ ] Clone: right-click → Clone (offset copy)
- [ ] Lock/Hide: right-click → Lock/Hide (locked drawings can't be moved but can be selected)
- [ ] Z-order: right-click → Bring/Send front/back
- [ ] Settings: click gear icon → edit all properties (color, width, style, fill, extend, ratio, label)
- [ ] Undo/Redo: Ctrl+Z / Ctrl+Shift+Z after each action type
- [ ] Persistence: draw something, reload page → drawings should persist per symbol:tf
- [ ] Multi-pane: toolbar only shows on active pane, drawings are per-pane
- [ ] Coexistence: chart pan/zoom still works in cursor mode, alert lines still work, right-click still adds alerts on empty area
- [ ] Keyboard: Escape cancels everything, tool stays locked when lock is on

---

## No Backend Changes Required

Everything is client-side only. Drawings persist in localStorage. No new dependencies. No new API routes.

---

## Future Enhancements (not implemented yet)
- Fibonacci retracement tool
- Text/label annotation tool
- Magnet/snap to OHLC
- Drawing templates (save/load drawing sets with layouts)
- Sync drawings across panes
- Export drawings as image overlay
