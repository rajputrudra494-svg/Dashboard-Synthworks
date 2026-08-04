/* =============================================================================
   SynthWorks — landing.js
   Entry script for index.html. The public page has no Supabase dependency, so
   it stays deliberately light: theme, icons, scroll reveal, counters and the
   hero entrance.
   ========================================================================== */

import { $, icons, storage, rafThrottle } from './utils.js';
import { initAnimations, initReveal, initCounters } from './animations.js';

/* ── Theme (same contract as the app shell, without importing it) ─────────── */

function setTheme(next) {
  const root = document.documentElement;
  root.classList.add('theme-transition');
  root.dataset.theme = next;
  storage.set('theme', next);

  const meta = $('meta[name="theme-color"]');
  if (meta) meta.content = next === 'dark' ? '#0a0a0f' : '#fbfbfc';

  paintThemeButton();
  setTimeout(() => root.classList.remove('theme-transition'), 480);
}

function paintThemeButton() {
  const button = $('#themeToggle');
  if (!button) return;
  const dark = document.documentElement.dataset.theme === 'dark';
  button.innerHTML = `<i data-lucide="${dark ? 'sun' : 'moon'}"></i>`;
  button.setAttribute('aria-label', dark ? 'Switch to light theme' : 'Switch to dark theme');
  icons(button);
}

/* ── Sticky nav shadow ────────────────────────────────────────────────────── */

function initStickyNav() {
  const nav = $('#lpNav');
  if (!nav) return;

  const onScroll = rafThrottle(() => nav.classList.toggle('is-stuck', window.scrollY > 12));
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}

/* ── Smooth in-page anchors that respect the sticky header ────────────────── */

function initAnchors() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;

    const id = link.getAttribute('href').slice(1);
    if (!id) return;

    const target = document.getElementById(id);
    if (!target) return;

    event.preventDefault();
    const top = target.getBoundingClientRect().top + window.scrollY - 88;
    window.scrollTo({ top, behavior: 'smooth' });
    history.replaceState(null, '', `#${id}`);
  });
}

/* ── Hero entrance ────────────────────────────────────────────────────────── */

function animateHero() {
  const gsap = window.gsap;
  if (!gsap || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // Short and flat: everything settles within half a second.
  gsap.timeline({ defaults: { ease: 'power2.out' } })
    .from('.lp-nav > *',  { y: -6, opacity: 0, duration: .3, stagger: .04 })
    .from('.lp-eyebrow',  { y: 8, opacity: 0, duration: .3 }, '-=.15')
    .from('.lp-title',    { y: 10, opacity: 0, duration: .38 }, '-=.2')
    .from('.lp-lede',     { y: 8, opacity: 0, duration: .32 }, '-=.28')
    .from('.lp-cta > *',  { y: 8, opacity: 0, duration: .3, stagger: .05 }, '-=.24')
    .from('.lp-trust li', { y: 6, opacity: 0, duration: .26, stagger: .04 }, '-=.22')
    .from('.lp-window',   { y: 14, opacity: 0, duration: .42 }, '-=.3');
}

/* ── Boot ─────────────────────────────────────────────────────────────────── */

function boot() {
  icons();
  paintThemeButton();

  $('#themeToggle')?.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  const yearNode = $('#year');
  if (yearNode) yearNode.textContent = String(new Date().getFullYear());

  initAnimations({ particles: true });
  initStickyNav();
  initAnchors();
  initReveal();
  initCounters();
  animateHero();

  // Re-run reveal after fonts settle so nothing is measured mid-swap.
  document.fonts?.ready.then(() => initReveal());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
