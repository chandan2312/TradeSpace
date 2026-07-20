const W = 1000;
const H = 800;
const limitX = W * 2 || 4000;
const limitY = H * 2 || 2000;

// t1 and t2 close together
const x1 = 500;
const y1 = 400;
const x2 = 500.1;
const y2 = 300;

let xs = x1, ys = y1, xe = x2, ye = y2;
const d = { extendLeft: true, extendRight: false };

if (d.extendLeft && x2 !== x1) {
    xs = -limitX;
    ys = y1 + ((-limitX - x1) * (y2 - y1)) / (x2 - x1);
    if (Math.abs(ys) > limitY) {
        ys = ys > 0 ? limitY : -limitY;
        xs = x1 + ((ys - y1) * (x2 - x1)) / (y2 - y1);
    }
}
console.log({xs, ys, xe, ye});
