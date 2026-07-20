function test(x1, y1, x2, y2, extendRight, extendLeft) {
  let xs = x1, ys = y1, xe = x2, ye = y2;
  const LIMIT = 10000;
  if (extendRight && x2 !== x1) {
    xe = LIMIT;
    ye = y1 + ((LIMIT - x1) * (y2 - y1)) / (x2 - x1);
    if (Math.abs(ye) > LIMIT) {
      ye = ye > 0 ? LIMIT : -LIMIT;
      xe = x1 + ((ye - y1) * (x2 - x1)) / (y2 - y1);
    }
  }
  if (extendLeft && x2 !== x1) {
    xs = -LIMIT;
    ys = y1 + ((-LIMIT - x1) * (y2 - y1)) / (x2 - x1);
    if (Math.abs(ys) > LIMIT) {
      ys = ys > 0 ? LIMIT : -LIMIT;
      xs = x1 + ((ys - y1) * (x2 - x1)) / (y2 - y1);
    }
  }
  return {xs, ys, xe, ye};
}

console.log(test(500, 400, 500.001, 300, true, true));
console.log(test(500, 400, 499.999, 300, true, true)); // x2 < x1
console.log(test(500, 400, 500.001, 400, true, true)); // y2 == y1
console.log(test(500, 400, 500.001, 300, false, false)); // extensions off
