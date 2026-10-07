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

// Emulate hit-testing logic from useDrawings.js
function hitTestDrawing(d, t, coords, isTouch = true) {
  const HANDLE_RADIUS = isTouch ? 32 : 12;
  const BODY_RADIUS = isTouch ? 16 : 8;

  if (d.kind === "long-position" || d.kind === "short-position") {
    const geom = getPositionGeometry(d, coords);
    if (!geom) return null;

    // Handle 3: Take Profit
    if (
      Math.hypot(geom.xMin - t.x, geom.syProfit - t.y) <= HANDLE_RADIUS ||
      Math.hypot(geom.xMax - t.x, geom.syProfit - t.y) <= HANDLE_RADIUS ||
      (Math.abs(t.y - geom.syProfit) <= HANDLE_RADIUS && t.x >= geom.xMin - HANDLE_RADIUS && t.x <= geom.xMax + HANDLE_RADIUS)
    ) {
      return { hit: "handle", handleIndex: 3 };
    }

    // Handle 2: Stop Loss
    if (
      Math.hypot(geom.xMin - t.x, geom.syStop - t.y) <= HANDLE_RADIUS ||
      Math.hypot(geom.xMax - t.x, geom.syStop - t.y) <= HANDLE_RADIUS ||
      (Math.abs(t.y - geom.syStop) <= HANDLE_RADIUS && t.x >= geom.xMin - HANDLE_RADIUS && t.x <= geom.xMax + HANDLE_RADIUS)
    ) {
      return { hit: "handle", handleIndex: 2 };
    }

    // Handle 1: Right boundary / hold duration
    if (
      Math.hypot(geom.sx1 - t.x, geom.sy0 - t.y) <= HANDLE_RADIUS ||
      (Math.abs(t.x - geom.sx1) <= HANDLE_RADIUS && t.y >= Math.min(geom.syStop, geom.syProfit) - HANDLE_RADIUS && t.y <= Math.max(geom.syStop, geom.syProfit) + HANDLE_RADIUS)
    ) {
      return { hit: "handle", handleIndex: 1 };
    }

    // Handle 0: Entry anchor
    if (
      Math.hypot(geom.sx0 - t.x, geom.sy0 - t.y) <= HANDLE_RADIUS ||
      (Math.abs(t.y - geom.sy0) <= HANDLE_RADIUS && t.x >= geom.xMin - HANDLE_RADIUS && t.x <= geom.xMax + HANDLE_RADIUS)
    ) {
      return { hit: "handle", handleIndex: 0 };
    }

    // Body hit
    const yTop = Math.min(geom.syStop, geom.syProfit);
    const yBottom = Math.max(geom.syStop, geom.syProfit);
    if (t.x >= geom.xMin && t.x <= geom.xMax && t.y >= yTop && t.y <= yBottom) {
      return { hit: "body" };
    }
  }

  return null;
}

console.log("=====================================================================");
console.log("TEST: Mobile Touch RR Tool Corner / Dot Hit-Testing & Body Isolation");
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

// Test 1: Touching top-left TP corner dot (x=100, y=300)
const hitTpLeft = hitTestDrawing(longTrade, { x: 105, y: 308 }, coords);
assert(hitTpLeft?.hit === "handle" && hitTpLeft?.handleIndex === 3, "Touch within 32px of TP left dot triggers Handle 3");
console.log("✅ PASS: Touch near TP left corner hits Handle 3");

// Test 2: Touching top-right TP corner (x=200, y=300)
const hitTpRight = hitTestDrawing(longTrade, { x: 195, y: 295 }, coords);
assert(hitTpRight?.hit === "handle" && hitTpRight?.handleIndex === 3, "Touch near TP right corner triggers Handle 3");
console.log("✅ PASS: Touch near TP right corner hits Handle 3");

// Test 3: Touching along the TP horizontal line (x=150, y=300)
const hitTpLine = hitTestDrawing(longTrade, { x: 150, y: 310 }, coords);
assert(hitTpLine?.hit === "handle" && hitTpLine?.handleIndex === 3, "Touch near TP line triggers Handle 3");
console.log("✅ PASS: Touch along TP level line hits Handle 3");

// Test 4: Touching bottom-left SL corner dot (x=100, y=600)
const hitSlLeft = hitTestDrawing(longTrade, { x: 95, y: 605 }, coords);
assert(hitSlLeft?.hit === "handle" && hitSlLeft?.handleIndex === 2, "Touch near SL left dot triggers Handle 2");
console.log("✅ PASS: Touch near SL left corner hits Handle 2");

// Test 5: Touching bottom-right SL corner (x=200, y=600)
const hitSlRight = hitTestDrawing(longTrade, { x: 202, y: 610 }, coords);
assert(hitSlRight?.hit === "handle" && hitSlRight?.handleIndex === 2, "Touch near SL right corner triggers Handle 2");
console.log("✅ PASS: Touch near SL right corner hits Handle 2");

// Test 6: Touching right edge time boundary (x=200, y=450)
const hitRightBoundary = hitTestDrawing(longTrade, { x: 205, y: 450 }, coords);
assert(hitRightBoundary?.hit === "handle" && hitRightBoundary?.handleIndex === 1, "Touch near right boundary triggers Handle 1");
console.log("✅ PASS: Touch near right boundary edge hits Handle 1");

// Test 7: Touching entry dot (x=100, y=500)
const hitEntry = hitTestDrawing(longTrade, { x: 108, y: 504 }, coords);
assert(hitEntry?.hit === "handle" && hitEntry?.handleIndex === 0, "Touch near entry dot triggers Handle 0");
console.log("✅ PASS: Touch near entry dot hits Handle 0");

// Test 8: Swiping / touching inside the interior body (x=150, y=400)
const hitBody = hitTestDrawing(longTrade, { x: 150, y: 400 }, coords);
assert(hitBody?.hit === "body", "Touch inside interior returns 'body', isolating it from accidental drag");
console.log("✅ PASS: Touch in interior body returns hit: 'body'");

// Test 9: Outside chart area
const hitOutside = hitTestDrawing(longTrade, { x: 250, y: 700 }, coords);
assert(hitOutside === null, "Touch outside returns null");
console.log("✅ PASS: Touch outside returns null");

console.log("\n🎯 ALL MOBILE RR TOOL TOUCH INTERACTION TESTS PASSED 100%!");
