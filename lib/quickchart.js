export function generateSparklineUrl(frames, targetPrice = null, color = "#2196F3") {
  let tf = "M15";
  let bars = frames?.M15 || [];
  
  if (frames?.M15 && frames?.H1 && targetPrice) {
    const recentM15 = frames.M15.slice(-100);
    const minM15 = Math.min(...recentM15.map(c => c.low));
    const maxM15 = Math.max(...recentM15.map(c => c.high));
    
    // Zoom out to H1 if the target price is outside the recent M15 range
    if (targetPrice < minM15 || targetPrice > maxM15) {
      tf = "H1";
      bars = frames.H1;
    }
  }

  // Default to H1 if M15 was empty for some reason
  if (!bars.length && frames?.H1) {
    tf = "H1";
    bars = frames.H1;
  }

  const recentBars = bars.slice(-100);
  const data = recentBars.map(c => c.close);
  const labels = data.map((_, i) => i);
  
  const datasets = [{
    data: data,
    borderColor: color,
    borderWidth: 2,
    fill: false,
    pointRadius: 0
  }];

  if (targetPrice) {
    datasets.push({
      data: Array(data.length).fill(targetPrice),
      borderColor: 'rgba(255, 255, 255, 0.4)',
      borderWidth: 1,
      borderDash: [5, 5],
      fill: false,
      pointRadius: 0
    });
  }

  const chart = {
    type: 'line',
    data: { labels, datasets },
    options: {
      legend: { display: false },
      scales: {
        xAxes: [{ display: false }],
        yAxes: [{ display: false, offset: true }]
      },
      layout: { padding: 15 },
      elements: { line: { tension: 0.1 } }
    }
  };
  
  return `https://quickchart.io/chart?w=500&h=150&bkg=181A20&c=${encodeURIComponent(JSON.stringify(chart))}`;
}
