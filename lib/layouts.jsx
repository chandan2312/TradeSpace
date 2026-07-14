export const LAYOUT_CONFIG = {
  "1": { count: 1, cols: 1, rows: 1 },
  
  "2v": { count: 2, cols: 2, rows: 1 },
  "2h": { count: 2, cols: 1, rows: 2 },
  
  "3v": { count: 3, cols: 3, rows: 1 },
  "3h": { count: 3, cols: 1, rows: 3 },
  "3a": { count: 3, cols: 2, rows: 2, spans: [[1,1,2,2], [2,1,3,2], [1,2,3,3]] }, // 2 top, 1 bot
  "3b": { count: 3, cols: 2, rows: 2, spans: [[1,1,3,2], [1,2,2,3], [2,2,3,3]] }, // 1 top, 2 bot
  "3c": { count: 3, cols: 2, rows: 2, spans: [[1,1,2,3], [2,1,3,2], [2,2,3,3]] }, // 1 left, 2 right
  "3d": { count: 3, cols: 2, rows: 2, spans: [[1,1,2,2], [1,2,2,3], [2,1,3,3]] }, // 2 left, 1 right
  
  "4": { count: 4, cols: 2, rows: 2 },
  "4h": { count: 4, cols: 1, rows: 4 },
  "4v": { count: 4, cols: 4, rows: 1 },
  "4c": { count: 4, cols: 2, rows: 3, spans: [[1,1,2,4], [2,1,3,2], [2,2,3,3], [2,3,3,4]] }, // 1 left, 3 right
  "4d": { count: 4, cols: 2, rows: 3, spans: [[1,1,2,2], [1,2,2,3], [1,3,2,4], [2,1,3,4]] }, // 3 left, 1 right
  
  "5a": { count: 5, cols: 6, rows: 2, spans: [[1,1,4,2], [4,1,7,2], [1,2,3,3], [3,2,5,3], [5,2,7,3]] }, // 2 top, 3 bot
  "5b": { count: 5, cols: 6, rows: 2, spans: [[1,1,3,2], [3,1,5,2], [5,1,7,2], [1,2,4,3], [4,2,7,3]] }, // 3 top, 2 bot
  
  "6": { count: 6, cols: 3, rows: 2 },
  "6h": { count: 6, cols: 1, rows: 6 },
  "6v": { count: 6, cols: 6, rows: 1 },
  
  "8": { count: 8, cols: 4, rows: 2 },
  "8v": { count: 8, cols: 8, rows: 1 }
};

export function LayoutIcon({ layoutId, isActive, onClick }) {
  const config = LAYOUT_CONFIG[layoutId];
  if (!config) return null;
  
  const { cols, rows, spans } = config;
  
  // We'll draw a 24x24 SVG
  const size = 20;
  const gap = 1;
  const w = size / cols;
  const h = size / rows;
  
  const rects = [];
  if (spans) {
    spans.forEach((span, i) => {
      const [cStart, rStart, cEnd, rEnd] = span;
      rects.push({
        x: (cStart - 1) * w,
        y: (rStart - 1) * h,
        width: (cEnd - cStart) * w - gap,
        height: (rEnd - rStart) * h - gap
      });
    });
  } else {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        rects.push({
          x: c * w,
          y: r * h,
          width: w - gap,
          height: h - gap
        });
      }
    }
  }

  return (
    <div 
      onClick={onClick}
      style={{
        padding: 4,
        borderRadius: 4,
        cursor: "pointer",
        background: isActive ? "var(--primary)" : "transparent",
        opacity: isActive ? 1 : 0.6,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }}
      title={layoutId}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {rects.map((r, i) => (
          <rect 
            key={i} 
            x={r.x} 
            y={r.y} 
            width={Math.max(1, r.width)} 
            height={Math.max(1, r.height)} 
            fill="currentColor" 
            rx={1}
          />
        ))}
      </svg>
    </div>
  );
}
