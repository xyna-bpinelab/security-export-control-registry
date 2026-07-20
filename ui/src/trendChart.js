// Renders a small single-series line chart showing an entity list's
// record_count over time. No charting library — the app has no other chart
// dependency, and this stays simple enough to build with raw SVG.
const SVG_NS = 'http://www.w3.org/2000/svg';
const WIDTH = 640;
const HEIGHT = 180;
const MARGIN = { top: 16, right: 64, bottom: 28, left: 52 };

function niceNum(range, round) {
  if (range <= 0) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction;
  if (round) {
    niceFraction = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  } else {
    niceFraction = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

// Standard "nice ticks" algorithm: picks a human-friendly step (1/2/5/10 x
// power of ten) so the y-axis reads 0 / 1,000 / 2,000 rather than raw data
// min/max.
function niceTicks(min, max, count = 3) {
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.05);
    min -= pad;
    max += pad;
  }
  const step = niceNum(niceNum(max - min, false) / (count - 1), true);
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = niceMin; v <= niceMax + step / 2; v += step) ticks.push(Math.round(v));
  return { ticks, niceMin, niceMax };
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

function formatDate(iso) {
  const [, m, d] = iso.split('-');
  return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
}

/**
 * Renders a record-count trend chart into `container`.
 * @param {HTMLElement} container
 * @param {Array<{date: string, record_count: number}>} series
 * @param {string} listName - used only for the SVG's accessible label
 */
export function renderTrendChart(container, series, listName) {
  container.innerHTML = '';
  container.style.position = 'relative';
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));

  const header = document.createElement('div');
  header.className = 'trend-chart-header';
  const title = document.createElement('span');
  title.className = 'trend-chart-title';
  title.textContent = '収録件数の推移';
  header.appendChild(title);
  container.appendChild(header);

  if (sorted.length < 2) {
    const msg = document.createElement('p');
    msg.className = 'trend-chart-empty';
    msg.textContent = 'データ蓄積中です。日次の推移は数日分のデータが集まると表示されます。';
    container.appendChild(msg);
    return;
  }

  const values = sorted.map(p => p.record_count);
  const { ticks, niceMin, niceMax } = niceTicks(Math.min(...values), Math.max(...values));

  const plotW = WIDTH - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;

  const t0 = new Date(sorted[0].date).getTime();
  const t1 = new Date(sorted[sorted.length - 1].date).getTime();
  const tSpan = Math.max(1, t1 - t0);

  const xPos = (d) => MARGIN.left + ((new Date(d).getTime() - t0) / tSpan) * plotW;
  const yPos = (v) => MARGIN.top + plotH - ((v - niceMin) / (niceMax - niceMin)) * plotH;

  const svg = svgEl('svg', {
    viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
    class: 'trend-chart-svg',
    role: 'img',
    'aria-label': `${listName}の収録件数推移`
  });

  // Gridlines + y-axis labels (clean, rounded values)
  ticks.forEach(t => {
    const gy = yPos(t);
    svg.appendChild(svgEl('line', {
      x1: MARGIN.left, x2: WIDTH - MARGIN.right, y1: gy, y2: gy,
      class: 'trend-gridline'
    }));
    const label = svgEl('text', {
      x: MARGIN.left - 8, y: gy, class: 'trend-axis-label',
      'text-anchor': 'end', 'dominant-baseline': 'middle'
    });
    label.textContent = t.toLocaleString();
    svg.appendChild(label);
  });

  // X-axis: first/last date only, to avoid label clutter
  const firstPt = sorted[0];
  const lastPt = sorted[sorted.length - 1];
  [[firstPt, 'start'], [lastPt, 'end']].forEach(([pt, anchor]) => {
    const label = svgEl('text', {
      x: xPos(pt.date), y: HEIGHT - MARGIN.bottom + 18, class: 'trend-axis-label',
      'text-anchor': anchor
    });
    label.textContent = formatDate(pt.date);
    svg.appendChild(label);
  });

  const linePoints = sorted.map(p => `${xPos(p.date)},${yPos(p.record_count)}`);
  const baseline = MARGIN.top + plotH;
  const areaPath = `M${xPos(firstPt.date)},${baseline} L${linePoints.join(' L')} L${xPos(lastPt.date)},${baseline} Z`;
  svg.appendChild(svgEl('path', { d: areaPath, class: 'trend-area' }));
  svg.appendChild(svgEl('path', { d: `M${linePoints.join(' L')}`, class: 'trend-line' }));

  // End marker + direct label (the line's own value never requires hovering)
  svg.appendChild(svgEl('circle', {
    cx: xPos(lastPt.date), cy: yPos(lastPt.record_count), r: 5, class: 'trend-end-marker'
  }));
  const endLabel = svgEl('text', {
    x: xPos(lastPt.date) + 10, y: yPos(lastPt.record_count), class: 'trend-end-label',
    'dominant-baseline': 'middle'
  });
  endLabel.textContent = `${lastPt.record_count.toLocaleString()}件`;
  svg.appendChild(endLabel);

  // Hover layer: crosshair + dot + tooltip, all findable by nearest-x
  const hoverLine = svgEl('line', {
    class: 'trend-hover-line', y1: MARGIN.top, y2: baseline, x1: -100, x2: -100
  });
  const hoverDot = svgEl('circle', { class: 'trend-hover-dot', r: 5, cx: -100, cy: -100 });
  svg.appendChild(hoverLine);
  svg.appendChild(hoverDot);

  const hitRect = svgEl('rect', {
    x: MARGIN.left, y: MARGIN.top, width: plotW, height: plotH, class: 'trend-hit-rect'
  });
  svg.appendChild(hitRect);

  const tooltip = document.createElement('div');
  tooltip.className = 'trend-tooltip';
  const tooltipDate = document.createElement('div');
  tooltipDate.className = 'trend-tooltip-date';
  const tooltipValue = document.createElement('div');
  tooltipValue.className = 'trend-tooltip-value';
  tooltip.appendChild(tooltipDate);
  tooltip.appendChild(tooltipValue);

  function nearestPoint(clientX) {
    const rect = svg.getBoundingClientRect();
    const svgX = (clientX - rect.left) * (WIDTH / rect.width);
    let nearest = sorted[0];
    let minDist = Infinity;
    for (const p of sorted) {
      const d = Math.abs(xPos(p.date) - svgX);
      if (d < minDist) {
        minDist = d;
        nearest = p;
      }
    }
    return nearest;
  }

  function showHover(clientX) {
    const pt = nearestPoint(clientX);
    const px = xPos(pt.date);
    const py = yPos(pt.record_count);
    hoverLine.setAttribute('x1', px);
    hoverLine.setAttribute('x2', px);
    hoverDot.setAttribute('cx', px);
    hoverDot.setAttribute('cy', py);
    hoverLine.classList.add('is-visible');
    hoverDot.classList.add('is-visible');

    const rect = svg.getBoundingClientRect();
    tooltip.style.left = `${px * (rect.width / WIDTH)}px`;
    tooltip.style.top = `${py * (rect.height / HEIGHT)}px`;
    tooltip.classList.add('is-visible');
    tooltipDate.textContent = pt.date;
    tooltipValue.textContent = `${pt.record_count.toLocaleString()}件`;
  }

  function hideHover() {
    hoverLine.classList.remove('is-visible');
    hoverDot.classList.remove('is-visible');
    tooltip.classList.remove('is-visible');
  }

  hitRect.addEventListener('pointermove', (e) => showHover(e.clientX));
  hitRect.addEventListener('pointerleave', hideHover);

  container.appendChild(svg);
  container.appendChild(tooltip);
}
