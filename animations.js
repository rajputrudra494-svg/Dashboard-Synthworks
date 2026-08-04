/* =============================================================================
   SynthWorks — animations.js
   Every motion system in the product, behind one `initAnimations()` call.

     • page loader              • scroll reveal (IntersectionObserver / AOS)
     • GSAP entrance timelines  • animated counters
     • ripple clicks            • confetti (completion only)
     • page transitions         • sticky-header state

   DESIGN DIRECTION: minimal.
   The ambient layer — aurora, floating blobs, particle canvas, cursor glow,
   mouse spotlight, 3D tilt and magnetic buttons — has been removed. It was the
   most expensive thing on the page (a full-screen canvas plus two pointermove
   listeners running on every frame) and the least useful. What remains is
   motion that communicates: things entering, values counting, a click
   registering.

   Everything degrades gracefully: no GSAP, no AOS, or reduced-motion all still
   produce a working UI.
   ========================================================================== */

import { $, $$, el, rafThrottle, reducedMotion } from './utils.js';

const gsap = () => window.gsap;
const CALM = () => reducedMotion();

/* =============================================================================
   1. PAGE LOADER
   ========================================================================== */

export function mountLoader() {
  if ($('.page-loader')) return;
  const loader = el('div', { class: 'page-loader', id: 'pageLoader', 'aria-hidden': 'true' });
  loader.innerHTML = `
    <div class="loader-inner">
      <div class="loader-mark">S</div>
      <div class="loader-bar"><i></i></div>
    </div>`;
  document.body.prepend(loader);
}

export function hideLoader(delay = 160) {
  const loader = $('#pageLoader');
  if (!loader) return;
  setTimeout(() => {
    loader.classList.add('is-done');
    setTimeout(() => loader.remove(), 400);
  }, delay);
}

/* =============================================================================
   2. BACKGROUND
   Kept as an exported no-op so any page still calling it stays valid. The
   minimal theme paints a flat surface from --bg; there is nothing to mount.
   ========================================================================== */

export function mountBackground() {
  // Remove a layer left over from a previously cached build.
  $('.fx-layer')?.remove();
  $('.cursor-glow')?.remove();
}

/* =============================================================================
   3. SCROLL REVEAL
   Uses AOS when present; otherwise our own [data-reveal] observer, which is
   lighter and needs no second stylesheet.
   ========================================================================== */

let revealObserver = null;

/** Marks a node revealed and stops watching it. */
function reveal(node) {
  if (node.classList.contains('is-revealed')) return;
  node.classList.add('is-revealed');
  revealObserver?.unobserve(node);
}

/** True when any part of the node is within the viewport. */
function isInView(node) {
  const rect = node.getBoundingClientRect();
  return rect.top < (window.innerHeight || 0) && rect.bottom > 0;
}

export function initReveal(root = document) {
  if (window.AOS?.init && !window.__aosReady) {
    window.AOS.init({ duration: 420, easing: 'ease-out-cubic', once: true, offset: 30, disable: CALM });
    window.__aosReady = true;
  }

  const nodes = $$('[data-reveal]:not(.is-revealed)', root);
  if (!nodes.length) return;

  if (CALM() || typeof IntersectionObserver === 'undefined') {
    nodes.forEach(reveal);
    return;
  }

  if (!revealObserver) {
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => { if (entry.isIntersecting) reveal(entry.target); });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
  }

  nodes.forEach((node) => revealObserver.observe(node));

  // ── Safety nets ─────────────────────────────────────────────────────────
  // [data-reveal] starts at opacity:0, so content being readable must never
  // depend on an observer callback arriving. Two guarantees:
  //   1. Anything already on screen is revealed on the next frame.
  //   2. Whatever is still hidden shortly after is revealed unconditionally —
  //      covers deferred callbacks in background tabs and embedded renderers.
  requestAnimationFrame(() => nodes.forEach((node) => { if (isInView(node)) reveal(node); }));
  setTimeout(() => nodes.forEach((node) => { if (isInView(node)) reveal(node); }), 700);
}

/** Applies --i to a container's children so `.stagger` delays cascade. */
export function stagger(container, step = 1) {
  if (!container) return;
  Array.from(container.children).forEach((child, index) => {
    child.style.setProperty('--i', String(index * step));
  });
}

/* =============================================================================
   4. ANIMATED COUNTERS
   ========================================================================== */

/**
 * Counts an element from its current value to `to`.
 * @param {HTMLElement} node
 * @param {number} to
 * @param {{duration?:number, format?:(n:number)=>string, decimals?:number}} [opts]
 */
export function countTo(node, to, { duration = 700, format = null, decimals = 0 } = {}) {
  if (!node) return;

  const from = Number(node.dataset.countValue || 0);
  const target = Number(to) || 0;
  node.dataset.countValue = String(target);

  const write = (value) => {
    node.textContent = format ? format(value) : value.toFixed(decimals);
  };

  if (CALM() || from === target) { write(target); return; }

  const start = performance.now();
  // easeOutExpo — fast then settles, which reads as confident rather than slow.
  const ease = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

  (function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    write(from + (target - from) * ease(progress));
    if (progress < 1) requestAnimationFrame(step);
    else write(target);
  })(start);
}

/** Counts every [data-count] element in `root` once it scrolls into view. */
export function initCounters(root = document) {
  const nodes = $$('[data-count]', root);
  if (!nodes.length) return;

  const run = (node) => {
    const to = Number(node.dataset.count) || 0;
    const decimals = Number(node.dataset.countDecimals || 0);
    const prefix = node.dataset.countPrefix || '';
    const suffix = node.dataset.countSuffix || '';
    const compact = node.dataset.countCompact === 'true';

    countTo(node, to, {
      decimals,
      format: (value) => {
        const shown = compact && Math.abs(value) >= 10000
          ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
          : new Intl.NumberFormat(undefined, { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(value);
        return `${prefix}${shown}${suffix}`;
      },
    });
  };

  // Counted once, tracked here because the fallbacks below can fire first.
  const counted = new WeakSet();
  const start = (node) => {
    if (counted.has(node)) return;
    counted.add(node);
    run(node);
  };

  if (typeof IntersectionObserver === 'undefined') {
    nodes.forEach(start);
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      start(entry.target);
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.3 });

  nodes.forEach((node) => observer.observe(node));

  // A tile stuck at "0" is worse than one that skips its animation.
  requestAnimationFrame(() => nodes.forEach((node) => { if (isInView(node)) start(node); }));
  setTimeout(() => nodes.forEach((node) => { if (isInView(node)) start(node); }), 700);
}

/* =============================================================================
   5. RIPPLE CLICKS
   The one micro-interaction kept: it confirms a tap landed, which matters most
   on touch where there is no hover state.
   ========================================================================== */

function initRipple() {
  document.addEventListener('pointerdown', (event) => {
    const target = event.target.closest('.btn, .qa-tile, .nav-item, .pop-item, .command-item');
    if (!target || CALM()) return;

    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);

    const ripple = el('span', {
      class: 'ripple',
      style: {
        width: `${size}px`,
        height: `${size}px`,
        left: `${event.clientX - rect.left - size / 2}px`,
        top: `${event.clientY - rect.top - size / 2}px`,
      },
    });

    // The ripple needs a positioned, clipping host.
    if (getComputedStyle(target).position === 'static') target.style.position = 'relative';
    target.style.overflow = 'hidden';

    target.append(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
    setTimeout(() => ripple.remove(), 700);
  }, { passive: true });
}

/* =============================================================================
   6. CONFETTI
   Reserved for genuine milestones — completing a project or a task. Not
   ambient decoration.
   ========================================================================== */

/**
 * @param {{count?:number, duration?:number, colors?:string[], origin?:{x:number,y:number}}} [opts]
 */
export function confetti({
  count = 60,
  duration = 2400,
  colors = ['#7C3AED', '#A855F7', '#22C55E', '#FACC15', '#38BDF8'],
  origin = null,
} = {}) {
  if (CALM()) return;

  const layer = el('div', { class: 'confetti-layer', 'aria-hidden': 'true' });
  const shapes = ['', 'is-round', 'is-strip'];
  const originX = origin ? (origin.x / window.innerWidth) * 100 : null;

  for (let i = 0; i < count; i += 1) {
    const left = originX == null
      ? Math.random() * 100
      : Math.max(0, Math.min(100, originX + (Math.random() - 0.5) * 40));

    layer.append(el('i', {
      class: `confetti-bit ${shapes[i % shapes.length]}`,
      style: {
        left: `${left}%`,
        background: colors[i % colors.length],
        '--dx': `${(Math.random() - 0.5) * 280}px`,
        '--dr': `${Math.random() * 900 - 200}deg`,
        '--dur': `${1.8 + Math.random() * 1.2}s`,
        '--delay': `${Math.random() * 0.3}s`,
        top: origin ? `${origin.y}px` : '-14px',
      },
    }));
  }

  document.body.append(layer);
  setTimeout(() => layer.remove(), duration + 800);
}

/* =============================================================================
   7. GSAP ENTRANCE TIMELINES
   Short and subtle — a settle, not a performance.
   ========================================================================== */

/** Animates the shell (sidebar, topbar) in — called once per page load. */
export function animateShell() {
  const g = gsap();
  if (!g || CALM()) return;

  g.timeline({ defaults: { ease: 'power2.out' } })
    .from('.sidebar-nav .nav-item', { x: -8, opacity: 0, duration: 0.26, stagger: 0.014 })
    .from('.app-topbar > *', { y: -6, opacity: 0, duration: 0.26, stagger: 0.03 }, '-=0.2');
}

/** Animates a page's primary content blocks in. */
export function animatePage(selector = '.page > *') {
  const g = gsap();
  if (!g || CALM()) {
    $$(selector).forEach((n) => { n.style.opacity = ''; n.style.transform = ''; });
    return;
  }
  g.from(selector, {
    y: 8, opacity: 0, duration: 0.32, stagger: 0.035, ease: 'power2.out', clearProps: 'all',
  });
}

/** Animates a freshly rendered grid/list of items. */
export function animateItems(nodes, { y = 6, stagger: step = 0.02 } = {}) {
  const list = Array.isArray(nodes) ? nodes : Array.from(nodes || []);
  if (!list.length) return;

  const g = gsap();
  if (!g || CALM()) return;

  g.from(list, { y, opacity: 0, duration: 0.26, stagger: step, ease: 'power2.out', clearProps: 'all' });
}

/* =============================================================================
   8. PAGE TRANSITIONS
   ========================================================================== */

function initPageTransitions() {
  if (CALM()) return;

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href]');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href
      || href.startsWith('#')
      || href.startsWith('mailto:')
      || href.startsWith('tel:')
      || link.target === '_blank'
      || link.hasAttribute('download')
      || link.dataset.noTransition !== undefined
      || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;

    const url = new URL(href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search) return;

    event.preventDefault();
    document.body.classList.add('is-leaving');
    setTimeout(() => { location.href = url.href; }, 120);
  });

  // Restoring from bfcache leaves the exit class behind — clear it.
  window.addEventListener('pageshow', () => document.body.classList.remove('is-leaving'));
}

/* =============================================================================
   9. STICKY TOPBAR STATE
   ========================================================================== */

function initScrollFX() {
  const topbar = $('.app-topbar');
  if (!topbar) return;

  const onScroll = rafThrottle(() => {
    topbar.classList.toggle('is-scrolled', window.scrollY > 4);
  });

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* =============================================================================
   10. BOOT
   ========================================================================== */

let booted = false;

/**
 * Wires up every global animation system. Idempotent — safe to call twice.
 * The options are retained for call-site compatibility; the ambient layers
 * they used to enable no longer exist.
 */
export function initAnimations() {
  if (booted) { initReveal(); initCounters(); return; }
  booted = true;

  mountBackground();
  initRipple();
  initReveal();
  initCounters();
  initScrollFX();
  initPageTransitions();
}

export default initAnimations;
