/* =============================================================================
   SynthWorks — charts.js
   A thin, theme-aware layer over Chart.js.

   Every chart in the app is created through one of the factories here so they
   all share the same typography, grid weight, tooltip and animation curve —
   and so a theme switch can restyle all of them at once.
   ========================================================================== */

import { money, num, escapeHtml } from './utils.js';

/** Every live chart, so we can retheme / destroy them together. */
const registry = new Map();

const css = (name, fallback = '') =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export const PALETTE = () => [
  css('--primary', '#7C3AED'),
  css('--accent', '#A855F7'),
  '#D946EF', '#EC4899', '#3B82F6', '#06B6D4', '#22C55E', '#F59E0B', '#EF4444', '#64748B',
];

/* =============================================================================
   GLOBAL DEFAULTS
   ========================================================================== */

function applyDefaults() {
  const { Chart } = window;
  if (!Chart) return false;

  Chart.defaults.font.family = css('--font-sans', 'Inter, sans-serif');
  Chart.defaults.font.size = 11;
  Chart.defaults.font.weight = 500;
  Chart.defaults.color = css('--chart-tick', '#94a3b8');
  Chart.defaults.borderColor = css('--chart-grid', 'rgba(255,255,255,.06)');
  Chart.defaults.animation.duration = 900;
  Chart.defaults.animation.easing = 'easeOutQuart';
  Chart.defaults.plugins.legend.display = false;
  Chart.defaults.plugins.tooltip.enabled = false;   // replaced by our DOM tooltip
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.responsive = true;
  Chart.defaults.interaction = { mode: 'index', intersect: false };
  Chart.defaults.elements.point.hoverRadius = 5;
  Chart.defaults.elements.bar.borderRadius = 6;
  Chart.defaults.elements.bar.borderSkipped = false;

  return true;
}

/* =============================================================================
   CUSTOM TOOLTIP
   Chart.js's canvas tooltip cannot use our CSS variables, so we render a real
   DOM node instead. One node per chart, positioned over the canvas.
   ========================================================================== */

function tooltipHandler(formatter) {
  return (context) => {
    const { chart, tooltip } = context;
    const parent = chart.canvas.parentNode;

    let node = parent.querySelector('.chart-tip');
    if (!node) {
      node = document.createElement('div');
      node.className = 'chart-tip';
      parent.style.position = parent.style.position || 'relative';
      parent.append(node);
    }

    if (tooltip.opacity === 0) { node.classList.remove('is-on'); return; }

    const title = tooltip.title?.[0] || '';
    const rows = (tooltip.dataPoints || []).map((point) => {
      const color = point.dataset.borderColor || point.dataset.backgroundColor;
      const swatch = Array.isArray(color) ? color[point.dataIndex] : color;
      const value = formatter ? formatter(point.raw, point) : num(point.raw);
      return `<div class="tip-row">
                <i style="background:${typeof swatch === 'string' ? escapeHtml(swatch) : 'var(--accent)'}"></i>
                ${escapeHtml(point.dataset.label || '')}
                <b>${escapeHtml(value)}</b>
              </div>`;
    }).join('');

    node.innerHTML = `${title ? `<div class="tip-title">${escapeHtml(title)}</div>` : ''}${rows}`;
    node.classList.add('is-on');

    // Keep the tooltip inside the canvas box.
    const width = node.offsetWidth;
    const left = Math.min(Math.max(tooltip.caretX, width / 2 + 4), chart.width - width / 2 - 4);
    node.style.left = `${left}px`;
    node.style.top = `${tooltip.caretY}px`;
  };
}

/* =============================================================================
   SCALE PRESETS
   ========================================================================== */

const gridX = () => ({
  grid: { display: false },
  border: { display: false },
  ticks: { padding: 8, maxRotation: 0, autoSkipPadding: 16 },
});

const gridY = (formatter) => ({
  beginAtZero: true,
  grid: { color: css('--chart-grid'), drawTicks: false },
  border: { display: false, dash: [4, 4] },
  ticks: {
    padding: 10,
    maxTicksLimit: 6,
    callback: (value) => (formatter ? formatter(value) : num(value, { compact: true })),
  },
});

/** Vertical gradient fill for area charts. */
function areaFill(ctx, color, strength = 0.34) {
  const { chart } = ctx;
  const { ctx: canvasCtx, chartArea } = chart;
  if (!chartArea) return 'transparent';

  const gradient = canvasCtx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
  gradient.addColorStop(0, hexToRgba(color, strength));
  gradient.addColorStop(0.7, hexToRgba(color, strength * 0.25));
  gradient.addColorStop(1, hexToRgba(color, 0));
  return gradient;
}

function hexToRgba(hex, alpha) {
  const clean = String(hex).replace('#', '');
  if (clean.length < 6) return `rgba(124,58,237,${alpha})`;
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* =============================================================================
   FACTORY
   ========================================================================== */

/**
 * Creates (or replaces) a chart bound to a canvas id.
 * @param {string} canvasId
 * @param {Object} config  Chart.js config
 * @returns {Chart|null}
 */
export function makeChart(canvasId, config) {
  if (!applyDefaults()) {
    console.warn('[charts] Chart.js is not loaded');
    return null;
  }

  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  registry.get(canvasId)?.destroy();
  const chart = new window.Chart(canvas.getContext('2d'), config);
  registry.set(canvasId, chart);
  return chart;
}

export const getChart = (canvasId) => registry.get(canvasId) || null;

export function destroyChart(canvasId) {
  registry.get(canvasId)?.destroy();
  registry.delete(canvasId);
}

export function destroyAllCharts() {
  registry.forEach((chart) => chart.destroy());
  registry.clear();
}

/* =============================================================================
   PRESETS
   ========================================================================== */

/**
 * Area / line chart.
 * @param {string} id
 * @param {{labels: string[], datasets: {label:string, data:number[], color?:string, fill?:boolean, dashed?:boolean}[], currency?:boolean, stepped?:boolean}} opts
 */
export function areaChart(id, { labels, datasets, currency = true, tension = 0.42 }) {
  const colors = PALETTE();
  const fmt = currency ? (value) => money(value, { compact: true }) : (value) => num(value);

  return makeChart(id, {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map((set, index) => {
        const color = set.color || colors[index % colors.length];
        return {
          label: set.label,
          data: set.data,
          borderColor: color,
          backgroundColor: set.fill === false ? 'transparent' : (ctx) => areaFill(ctx, color),
          fill: set.fill !== false,
          tension,
          borderWidth: 2.4,
          borderDash: set.dashed ? [5, 5] : undefined,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointBackgroundColor: color,
          pointBorderColor: css('--bg-2', '#0f172a'),
          pointBorderWidth: 2.5,
          pointHitRadius: 22,
        };
      }),
    },
    options: {
      scales: { x: gridX(), y: gridY(fmt) },
      plugins: { tooltip: { external: tooltipHandler(fmt) } },
    },
  });
}

/**
 * Bar chart (grouped or stacked).
 */
export function barChart(id, { labels, datasets, currency = false, stacked = false, horizontal = false }) {
  const colors = PALETTE();
  const fmt = currency ? (value) => money(value, { compact: true }) : (value) => num(value);

  return makeChart(id, {
    type: 'bar',
    data: {
      labels,
      datasets: datasets.map((set, index) => ({
        label: set.label,
        data: set.data,
        backgroundColor: set.color || colors[index % colors.length],
        hoverBackgroundColor: set.hoverColor || set.color || colors[index % colors.length],
        borderRadius: 6,
        borderSkipped: false,
        barPercentage: 0.72,
        categoryPercentage: 0.74,
        maxBarThickness: 46,
      })),
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x',
      scales: horizontal
        ? { x: { ...gridY(fmt), stacked }, y: { ...gridX(), stacked } }
        : { x: { ...gridX(), stacked }, y: { ...gridY(fmt), stacked } },
      plugins: { tooltip: { external: tooltipHandler(fmt) } },
    },
  });
}

/**
 * Doughnut / pie.
 */
export function donutChart(id, { labels, data, colors = null, currency = false, cutout = '72%' }) {
  const palette = colors || PALETTE();
  const fmt = currency ? (value) => money(value) : (value) => num(value);

  return makeChart(id, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        label: '',
        data,
        backgroundColor: palette,
        borderColor: css('--bg-2', '#0f172a'),
        borderWidth: 3,
        hoverOffset: 9,
        hoverBorderColor: css('--bg-2', '#0f172a'),
      }],
    },
    options: {
      cutout,
      radius: '92%',
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        tooltip: {
          external: (context) => {
            // Doughnuts have no dataset label, so build the row from the slice.
            const { chart, tooltip } = context;
            const parent = chart.canvas.parentNode;
            let node = parent.querySelector('.chart-tip');
            if (!node) {
              node = document.createElement('div');
              node.className = 'chart-tip';
              parent.append(node);
            }
            if (tooltip.opacity === 0) { node.classList.remove('is-on'); return; }

            const point = tooltip.dataPoints[0];
            const total = point.dataset.data.reduce((sum, value) => sum + value, 0);
            const pct = total ? ((point.raw / total) * 100).toFixed(1) : '0';

            node.innerHTML = `
              <div class="tip-title">${escapeHtml(point.label)}</div>
              <div class="tip-row">
                <i style="background:${escapeHtml(point.dataset.backgroundColor[point.dataIndex])}"></i>
                ${pct}%<b>${escapeHtml(fmt(point.raw))}</b>
              </div>`;
            node.classList.add('is-on');
            node.style.left = `${tooltip.caretX}px`;
            node.style.top = `${tooltip.caretY}px`;
          },
        },
      },
    },
  });
}

/**
 * Compact sparkline for stat tiles. No axes, no grid, no interaction.
 */
export function sparkline(id, { data, color = null, fill = true }) {
  const stroke = color || css('--accent', '#a855f7');

  return makeChart(id, {
    type: 'line',
    data: {
      labels: data.map((_, index) => index),
      datasets: [{
        data,
        borderColor: stroke,
        backgroundColor: fill ? (ctx) => areaFill(ctx, stroke, 0.28) : 'transparent',
        fill,
        tension: 0.4,
        borderWidth: 2,
        pointRadius: 0,
      }],
    },
    options: {
      animation: { duration: 700 },
      scales: { x: { display: false }, y: { display: false } },
      plugins: { tooltip: { enabled: false } },
      events: [],
      layout: { padding: { top: 2, bottom: 0 } },
    },
  });
}

/**
 * Radar — used on Analytics for the workload profile.
 */
export function radarChart(id, { labels, datasets }) {
  const colors = PALETTE();

  return makeChart(id, {
    type: 'radar',
    data: {
      labels,
      datasets: datasets.map((set, index) => {
        const color = set.color || colors[index % colors.length];
        return {
          label: set.label,
          data: set.data,
          borderColor: color,
          backgroundColor: hexToRgba(color, 0.18),
          borderWidth: 2,
          pointBackgroundColor: color,
          pointRadius: 3,
        };
      }),
    },
    options: {
      scales: {
        r: {
          beginAtZero: true,
          grid: { color: css('--chart-grid') },
          angleLines: { color: css('--chart-grid') },
          pointLabels: { color: css('--chart-tick'), font: { size: 11, weight: '600' } },
          ticks: { display: false, maxTicksLimit: 5 },
        },
      },
      plugins: { tooltip: { external: tooltipHandler() } },
    },
  });
}

/* =============================================================================
   CUSTOM HTML LEGEND
   ========================================================================== */

/**
 * Renders an interactive legend into `container` for a chart.
 * Clicking an entry toggles that series.
 * @param {HTMLElement|string} container
 * @param {Chart} chart
 * @param {{values?: string[]}} [opts]
 */
export function renderLegend(container, chart, { values = null } = {}) {
  const host = typeof container === 'string' ? document.getElementById(container) : container;
  if (!host || !chart) return;

  const isDonut = chart.config.type === 'doughnut' || chart.config.type === 'pie';

  const entries = isDonut
    ? chart.data.labels.map((label, index) => ({
        label,
        color: chart.data.datasets[0].backgroundColor[index],
        index,
        value: values?.[index],
      }))
    : chart.data.datasets.map((set, index) => ({
        label: set.label,
        color: typeof set.borderColor === 'string' ? set.borderColor : set.backgroundColor,
        index,
        value: values?.[index],
      }));

  host.innerHTML = entries.map((entry) => `
    <button class="legend-item" type="button" data-index="${entry.index}" aria-pressed="true">
      <span><i style="background:${escapeHtml(typeof entry.color === 'string' ? entry.color : '#7C3AED')}"></i>
      ${escapeHtml(entry.label ?? '')}</span>
      ${entry.value != null ? `<b>${escapeHtml(entry.value)}</b>` : ''}
    </button>`).join('');

  host.onclick = (event) => {
    const button = event.target.closest('.legend-item');
    if (!button) return;
    const index = Number(button.dataset.index);

    if (isDonut) {
      chart.toggleDataVisibility(index);
    } else {
      chart.setDatasetVisibility(index, !chart.isDatasetVisible(index));
    }
    chart.update();

    const visible = isDonut ? chart.getDataVisibility(index) : chart.isDatasetVisible(index);
    button.classList.toggle('is-off', !visible);
    button.setAttribute('aria-pressed', String(visible));
  };
}

/* =============================================================================
   THEME SYNC
   Re-colour every live chart when the theme flips. Cheaper and smoother than
   destroying and rebuilding them.
   ========================================================================== */

document.addEventListener('synthworks:theme', () => {
  if (!window.Chart) return;
  applyDefaults();

  registry.forEach((chart) => {
    const tickColor = css('--chart-tick');
    const gridColor = css('--chart-grid');

    Object.values(chart.options.scales || {}).forEach((scale) => {
      if (scale.ticks) scale.ticks.color = tickColor;
      if (scale.grid) scale.grid.color = gridColor;
      if (scale.angleLines) scale.angleLines.color = gridColor;
      if (scale.pointLabels) scale.pointLabels.color = tickColor;
    });

    // Doughnut segment borders match the card background, which changes.
    chart.data.datasets.forEach((set) => {
      if (chart.config.type === 'doughnut' || chart.config.type === 'pie') {
        set.borderColor = css('--bg-2');
        set.hoverBorderColor = css('--bg-2');
      }
      if (set.pointBorderColor) set.pointBorderColor = css('--bg-2');
    });

    chart.update('none');
  });
});

/* Charts inside a collapsing sidebar / resizing drawer need a nudge. */
window.addEventListener('resize', () => {
  registry.forEach((chart) => chart.resize());
});

export default makeChart;
