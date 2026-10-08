import assert from "node:assert";

// Mock coordinates object
function createMockCoords() {
  return {
    timeToX: (t) => t * 10,
    xToTime: (x) => Math.round(x / 10),
    priceToY: (p) => (100 - p) * 10,
    yToPrice: (y) => 100 - y / 10,
    pipSize: () => 0.01,
  };
}

// Emulate getPositionGeometry from useDrawings.js
function getPositionGeometry(d, coords) {
  if (!d || (d.kind !== "long-position" && d.kind !== "short-position")) return null;
  if (!d.points || d.points.length < 2) return null;
  const p0 = d.points[0];
  const p1 = d.points[1];
  if (p0.time == null || p0.price == null || p1.time == null) return null;

  const sx0 = coords.timeToX(p0.time);
  const sy0 = coords.priceToY(p0.price);
  const sx1 = coords.timeToX(p1.time);
  if (sx0 == null || sy0 == null || sx1 == null) return null;

  const isLong = d.kind === "long-position";
  const dir = isLong ? 1 : -1;
  const pip = coords.pipSize ? coords.pipSize() : 0.01;
  const stopDist = d.style?.stopLevel ?? (Math.abs(p1.price - p0.price) || pip * 100);
  const profitDist = d.style?.profitLevel ?? (Math.abs(p1.price - p0.price) || pip * 100);

  const stopPrice = p0.price - dir * stopDist;
  const profitPrice = p0.price + dir * profitDist;

  const syStop = coords.priceToY(stopPrice) ?? (sy0 + (isLong ? 40 : -40));
  const syProfit = coords.priceToY(profitPrice) ?? (sy0 - (isLong ? 40 : -40));

  const xMin = Math.min(sx0, sx1);
  const xMax = Math.max(sx0, sx1);

  return {
    sx0,
    sy0,
    sx1,
    syStop,
    syProfit,
    xMin,
    xMax,
    anchors: [
      { x: sx0, y: sy0 },
      { x: sx1, y: sy0 },
      { x: sx0, y: syStop },
      { x: sx0, y: syProfit },
    ],
  };
}

// Emulate updated hitTopmost logic from useDrawings.js
function hitTestDrawing(d, t, coords, isSelected = false, isTouch = true) {
  const HANDLE_RADIUS = isTouch ? 28 : 10;
  const LINE_RADIUS = isTouch ? 14 : 6;
  const BODY_RADIUS = isTouch ? 16 : 8;

  if (d.kind === "long-position" || d.kind === "short-position") {
    const geom = getPositionGeometry(d, coords);
    if (!geom) return null;

    // Check handles & exit points ONLY when drawing is in Edit Mode (isSelected)
    if (isSelected) {
      // Exit Point 3: Take Profit (extends TP vertically in that direction)
      if (
        Math.hypot(geom.xMin - t.x, geom.syProfit - t.y) <= HANDLE_RADIUS ||
        Math.hypot(geom.xMax - t.x, geom.syProfit - t.y) <= HANDLE_RADIUS ||
        (Math.abs(t.y - geom.syProfit) <= LINE_RADIUS && t.x >= geom.xMin - HANDLE_RADIUS && t.x <= geom.xMax + HANDLE_RADIUS)
      ) {
        return { hit: "handle", handleIndex: 3 };
      }

      // Exit Point 2: Stop Loss (extends SL vertically in that direction)
      if (
        Math.hypot(geom.xMin - t.x, geom.syStop - t.y) <= HANDLE_RADIUS ||
        Math.hypot(geom.xMax - t.x, geom.syStop - t.y) <= HANDLE_RADIUS ||
        (Math.abs(t.y - geom.syStop) <= LINE_RADIUS && t.x >= geom.xMin - HANDLE_RADIUS && t.x <= geom.xMax + HANDLE_RADIUS)
      ) {
        return { hit: "handle", handleIndex: 2 };
      }

      // Exit Point 1: Right boundary (extends time duration horizontally in that direction)
      if (
        Math.hypot(geom.sx1 - t.x, geom.sy0 - t.y) <= HANDLE_RADIUS ||
        (Math.abs(t.x - geom.sx1) <= LINE_RADIUS && t.y >= Math.min(geom.syStop, geom.syProfit) - HANDLE_RADIUS && t.y <= Math.max(geom.syStop, geom.syProfit) + HANDLE_RADIUS)
      ) {
        return { hit: "handle", handleIndex: 1 };
      }

      // Moving Point 0: Entry anchor dot ONLY (swiping moves entry point; middle remains body)
      if (Math.hypot(geom.sx0 - t.x, geom.sy0 - t.y) <= HANDLE_RADIUS) {
        return { hit: "handle", handleIndex: 0 };
      }
    }

    // Body hit (inside boundaries, interior green/red box, center dividing line)
    const yTop = Math.min(geom.syStop, geom.syProfit);
    const yBottom = Math.max(geom.syStop, geom.syProfit);
    const inBox = (t.x >= geom.xMin && t.x <= geom.xMax && t.y >= yTop && t.y <= yBottom);
    if (inBox) {
      return { hit: "body" };
    }
  }

  return null;
}

// Emulate body move/translation (translates all points [p0, p1])
function translateDrawing(d, dx, dy, coords) {
  const p0 = d.points[0];
  const p1 = d.points[1];
  const sx0 = coords.timeToX(p0.time);
  const sy0 = coords.priceToY(p0.price);
  const sx1 = coords.timeToX(p1.time);
  const sy1 = coords.priceToY(p1.price);

  const newP0 = {
    time: coords.xToTime(sx0 + dx),
    price: coords.yToPrice(sy0 + dy),
  };
  const newP1 = {
    time: coords.xToTime(sx1 + dx),
    price: coords.yToPrice(sy1 + dy),
  };

  return {
    ...d,
    points: [newP0, newP1],
  };
}

// Emulate handle dragging (moving point vs exit point extension)
function dragHandle(d, handleIndex, targetCursor, coords) {
  const p0 = d.points[0];
  const p1 = d.points[1];
  const dir = d.kind === "long-position" ? 1 : -1;
  const pip = coords.pipSize();

  if (handleIndex === 0) {
    // Moving Point 0: Entry anchor moves to target cursor point
    const newTime = coords.xToTime(targetCursor.x);
    const newPrice = coords.yToPrice(targetCursor.y);
    return {
      ...d,
      points: [{ time: newTime, price: newPrice }, { time: p1.time, price: newPrice }],
    };
  }
  if (handleIndex === 1) {
    // Exit Point 1: Right boundary extends horizontally
    const newTime = coords.xToTime(targetCursor.x);
    return {
      ...d,
      points: [p0, { time: newTime, price: p0.price }],
    };
  }
  if (handleIndex === 2) {
    // Exit Point 2: Stop Loss extends vertically in stop direction
    const cursorPrice = coords.yToPrice(targetCursor.y);
    const newStopDist = Math.max(pip, (p0.price - cursorPrice) * dir);
    return {
      ...d,
      style: { ...d.style, stopLevel: newStopDist },
    };
  }
  if (handleIndex === 3) {
    // Exit Point 3: Take Profit extends vertically in profit direction
    const cursorPrice = coords.yToPrice(targetCursor.y);
    const newProfitDist = Math.max(pip, (cursorPrice - p0.price) * dir);
    return {
      ...d,
      style: { ...d.style, profitLevel: newProfitDist },
    };
  }
  return d;
}

console.log("=====================================================================");
console.log("TEST: Chart Drawing Edit Mode Interaction & Dragging Workflows");
console.log("=====================================================================");

const coords = createMockCoords();
// Long position: Entry at price 50 (y=500), time 10 (x=100)
// Right boundary at time 20 (x=200)
// Stop level: 10 (stop price 40 -> y=600)
// Profit level: 20 (profit price 70 -> y=300)
const longTrade = {
  id: "test_rr_1",
  kind: "long-position",
  points: [
    { time: 10, price: 50 },
    { time: 20, price: 50 },
  ],
  style: {
    stopLevel: 10,
    profitLevel: 20,
  },
};

const geom = getPositionGeometry(longTrade, coords);
assert(geom !== null, "Position geometry calculated");
assert.strictEqual(geom.xMin, 100);
assert.strictEqual(geom.xMax, 200);
assert.strictEqual(geom.sy0, 500);
assert.strictEqual(geom.syStop, 600);
assert.strictEqual(geom.syProfit, 300);

// =====================================================================
// PART 1: UNSELECTED DRAWING (NOT IN EDIT MODE)
// When not in edit mode: swiping through moving points, exit points,
// or body must NEVER drag or extend.
// =====================================================================
console.log("\n--- Part 1: Unselected Drawing Hit-Testing (Not in Edit Mode) ---");

const unselTp = hitTestDrawing(longTrade, { x: 105, y: 308 }, coords, false);
assert.strictEqual(unselTp?.hit, "body", "Unselected near TP dot returns body hit, not handle");
console.log("✅ PASS: Unselected near TP corner returns hit: 'body'");

const unselSl = hitTestDrawing(longTrade, { x: 100, y: 600 }, coords, false);
assert.strictEqual(unselSl?.hit, "body", "Unselected near SL dot returns body hit, not handle");
console.log("✅ PASS: Unselected near SL corner returns hit: 'body'");

const unselRight = hitTestDrawing(longTrade, { x: 200, y: 450 }, coords, false);
assert.strictEqual(unselRight?.hit, "body", "Unselected near right boundary returns body hit, not handle");
console.log("✅ PASS: Unselected near right boundary returns hit: 'body'");

const unselEntryDot = hitTestDrawing(longTrade, { x: 100, y: 500 }, coords, false);
assert.strictEqual(unselEntryDot?.hit, "body", "Unselected near entry dot returns body hit, not handle");
console.log("✅ PASS: Unselected near entry dot returns hit: 'body'");

const unselBody = hitTestDrawing(longTrade, { x: 150, y: 400 }, coords, false);
assert.strictEqual(unselBody?.hit, "body", "Unselected inside interior returns body hit");
console.log("✅ PASS: Unselected inside interior returns hit: 'body'");

// =====================================================================
// PART 2: SELECTED DRAWING (IN EDIT MODE)
// 1. Swiping moving points moves ONLY that point.
// 2. Swiping exit points extends in that particular direction.
// 3. Swiping anywhere else on the body moves the drawing.
// =====================================================================
console.log("\n--- Part 2: Selected Drawing Hit-Testing & Extensions (In Edit Mode) ---");

// Test 2A: Moving Point: Entry anchor dot (x=100, y=500)
const hitEntry = hitTestDrawing(longTrade, { x: 105, y: 502 }, coords, true);
assert(hitEntry?.hit === "handle" && hitEntry?.handleIndex === 0, "Touch near entry dot triggers Handle 0");
console.log("✅ PASS: Moving point: Touch near entry dot hits Handle 0");

const movedEntry = dragHandle(longTrade, 0, { x: 120, y: 480 }, coords);
assert.strictEqual(movedEntry.points[0].time, 12, "Entry time updated to 12");
assert.strictEqual(movedEntry.points[0].price, 52, "Entry price updated to 52");
assert.strictEqual(movedEntry.points[1].time, 20, "Right boundary time unchanged at 20");
console.log("✅ PASS: Swiping entry moving point adjusts only entry point");

// Test 2B: Exit Point: Take Profit line & corner dots (Handle 3)
const hitTpLeft = hitTestDrawing(longTrade, { x: 105, y: 304 }, coords, true);
assert(hitTpLeft?.hit === "handle" && hitTpLeft?.handleIndex === 3, "Touch near TP left dot triggers Handle 3");
const hitTpLine = hitTestDrawing(longTrade, { x: 150, y: 305 }, coords, true);
assert(hitTpLine?.hit === "handle" && hitTpLine?.handleIndex === 3, "Touch along TP level line triggers Handle 3");
console.log("✅ PASS: Exit point: Touch on TP line/dots hits Handle 3");

// Swiping TP extends in that vertical direction (upward to price 80, y=200)
const extendedTp = dragHandle(longTrade, 3, { x: 150, y: 200 }, coords);
assert.strictEqual(extendedTp.style.profitLevel, 30, "TP extended to 30 price units (price 80)");
assert.strictEqual(extendedTp.points[0].price, 50, "Entry price unchanged during TP extension");
assert.strictEqual(extendedTp.style.stopLevel, 10, "SL unchanged during TP extension");
console.log("✅ PASS: Swiping TP exit point extends profit level in vertical direction");

// Test 2C: Exit Point: Stop Loss line & corner dots (Handle 2)
const hitSlLeft = hitTestDrawing(longTrade, { x: 98, y: 602 }, coords, true);
assert(hitSlLeft?.hit === "handle" && hitSlLeft?.handleIndex === 2, "Touch near SL left dot triggers Handle 2");
const hitSlLine = hitTestDrawing(longTrade, { x: 150, y: 598 }, coords, true);
assert(hitSlLine?.hit === "handle" && hitSlLine?.handleIndex === 2, "Touch along SL level line triggers Handle 2");
console.log("✅ PASS: Exit point: Touch on SL line/dots hits Handle 2");

// Swiping SL extends in that vertical direction (downward to price 35, y=650)
const extendedSl = dragHandle(longTrade, 2, { x: 150, y: 650 }, coords);
assert.strictEqual(extendedSl.style.stopLevel, 15, "SL extended to 15 price units (price 35)");
assert.strictEqual(extendedSl.points[0].price, 50, "Entry price unchanged during SL extension");
assert.strictEqual(extendedSl.style.profitLevel, 20, "TP unchanged during SL extension");
console.log("✅ PASS: Swiping SL exit point extends stop level in vertical direction");

// Test 2D: Exit Point: Right boundary edge & dot (Handle 1)
const hitRightBoundary = hitTestDrawing(longTrade, { x: 202, y: 450 }, coords, true);
assert(hitRightBoundary?.hit === "handle" && hitRightBoundary?.handleIndex === 1, "Touch near right boundary triggers Handle 1");
console.log("✅ PASS: Exit point: Touch on right boundary edge hits Handle 1");

// Swiping right boundary extends in that horizontal direction (to time 35, x=350)
const extendedRight = dragHandle(longTrade, 1, { x: 350, y: 450 }, coords);
assert.strictEqual(extendedRight.points[1].time, 35, "Right boundary extended to time 35");
assert.strictEqual(extendedRight.points[0].time, 10, "Entry time unchanged during right extension");
console.log("✅ PASS: Swiping right boundary exit point extends duration horizontally");

// Test 2E: Body: Swiping anywhere else on the body (middle line, green box, red box)
// Middle horizontal dividing line (x=150, y=500 - away from entry dot at x=100)
const hitMiddleLine = hitTestDrawing(longTrade, { x: 150, y: 500 }, coords, true);
assert.strictEqual(hitMiddleLine?.hit, "body", "Center dividing line away from dot hits 'body'");
console.log("✅ PASS: Body: Center line away from entry dot hits 'body'");

// Green interior zone (x=140, y=400)
const hitGreenBody = hitTestDrawing(longTrade, { x: 140, y: 400 }, coords, true);
assert.strictEqual(hitGreenBody?.hit, "body", "Green profit interior hits 'body'");
console.log("✅ PASS: Body: Green profit interior hits 'body'");

// Red interior zone (x=160, y=550)
const hitRedBody = hitTestDrawing(longTrade, { x: 160, y: 550 }, coords, true);
assert.strictEqual(hitRedBody?.hit, "body", "Red stop interior hits 'body'");
console.log("✅ PASS: Body: Red stop interior hits 'body'");

// Swiping anywhere else on the body moves the ENTIRE drawing
const movedBody = translateDrawing(longTrade, 50, -100, coords);
assert.strictEqual(movedBody.points[0].time, 15, "Entry time translated by +5");
assert.strictEqual(movedBody.points[0].price, 60, "Entry price translated by +10");
assert.strictEqual(movedBody.points[1].time, 25, "Right boundary time translated by +5");
assert.strictEqual(movedBody.points[1].price, 60, "Right boundary price matches entry price");
assert.strictEqual(movedBody.style.stopLevel, 10, "Stop level distance preserved");
assert.strictEqual(movedBody.style.profitLevel, 20, "Profit level distance preserved");
console.log("✅ PASS: Swiping from body translates the entire drawing across time & price");

console.log("\n🎯 ALL EDIT MODE SWIPE, MOVING POINT & EXIT EXTENSION TESTS PASSED 100%!");
