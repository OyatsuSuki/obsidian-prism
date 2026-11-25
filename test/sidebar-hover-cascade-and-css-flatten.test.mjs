import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

test('ui-runtime isolates sidebar hover mutations (0 sync/icon cascade) and throttles unfocused wakeWinBlur re-arms', () => {
  const uiSrc = fs.readFileSync(path.join(ROOT, 'ui-runtime.js'), 'utf8');
  let moCb = null;
  let timerSeq = 1;
  const timers = new Map();
  let blurTimerCreations = 0;
  let now = 2000;
  let hasFocusVal = true;
  const winListeners = new Map();

  function mkNode(tag, attrs = {}) {
    const attrMap = new Map(Object.entries(attrs).map(([k, v]) => [k, String(v)]));
    const children = [];
    const node = {
      nodeType: 1, tagName: String(tag).toUpperCase(), parentElement: null, parentNode: null,
      children, childNodes: children, isConnected: true, hidden: false, style: { setProperty() {}, removeProperty() {} },
      get firstElementChild() { return children[0] || null; },
      get lastElementChild() { return children[children.length - 1] || null; },
      get className() { return attrMap.get('class') || ''; },
      set className(v) { attrMap.set('class', String(v || '')); },
      get id() { return attrMap.get('id') || ''; },
      set id(v) { attrMap.set('id', String(v || '')); },
      classList: {
        contains: (c) => (attrMap.get('class') || '').split(/\s+/).includes(c),
        add() {}, remove() {},
      },
      getAttribute: (k) => (attrMap.has(k) ? attrMap.get(k) : null),
      setAttribute(k, v) { attrMap.set(k, String(v)); },
      hasAttribute: (k) => attrMap.has(k),
      removeAttribute(k) { attrMap.delete(k); },
      appendChild(c) { c.parentElement = c.parentNode = this; children.push(c); return c; },
      removeChild(c) { const i = children.indexOf(c); if (i >= 0) children.splice(i, 1); c.parentElement = c.parentNode = null; return c; },
      matches(sel) {
        return sel.split(',').some((p) => {
          const s = p.trim();
          if (s === 'aside') return this.tagName === 'ASIDE';
          if (s === 'button') return this.tagName === 'BUTTON';
          if (s === 'svg') return this.tagName === 'SVG';
          const tidM = s.match(/\[data-testid="([^"]+)"\]/);
          if (tidM) return this.getAttribute('data-testid') === tidM[1];
          return false;
        });
      },
      closest(sel) {
        let cur = this;
        while (cur) { if (cur.matches?.(sel)) return cur; cur = cur.parentElement; }
        return null;
      },
      querySelector(sel) {
        for (const c of children) {
          if (c.matches?.(sel)) return c;
          const hit = c.querySelector?.(sel);
          if (hit) return hit;
        }
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (el) => {
          for (const c of el.children) {
            if (c.matches?.(sel)) out.push(c);
            walk(c);
          }
        };
        walk(this);
        return out;
      },
      contains(other) {
        let cur = other;
        while (cur) { if (cur === this) return true; cur = cur.parentElement; }
        return false;
      },
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 240, height: 32, right: 240, bottom: 32 }),
    };
    return node;
  }

  const html = mkNode('html', { 'data-ag-cs-style': '1' });
  const body = mkNode('body');
  const aside = mkNode('aside');
  const row = mkNode('div', { 'data-testid': 'conversation-row-sidebar' });
  aside.appendChild(row);
  body.appendChild(aside);
  const divSidebar = mkNode('div', { 'data-testid': 'sidebar-split' });
  const divRow = mkNode('div', { 'data-testid': 'conversation-row-sidebar' });
  divSidebar.appendChild(divRow);
  body.appendChild(divSidebar);
  html.appendChild(body);

  const rafs = [];
  const doc = {
    documentElement: html, body, head: mkNode('head'), hidden: false,
    hasFocus: () => hasFocusVal,
    getElementById: () => null,
    createElement: (t) => mkNode(t),
    querySelector: (s) => html.querySelector(s),
    querySelectorAll: (s) => html.querySelectorAll(s),
    addEventListener() {}, removeEventListener() {},
  };
  const sb = {
    document: doc, location: { pathname: '/' }, navigator: { language: 'en' }, devicePixelRatio: 1,
    CSS: { supports: () => true },
    performance: { now: () => now },
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; },
    cancelAnimationFrame() {},
    setTimeout(fn, ms = 0) {
      const id = timerSeq++;
      if (ms === 1200) blurTimerCreations += 1;
      timers.set(id, { fn, ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    setInterval: () => 0, clearInterval() {},
    MutationObserver: class { constructor(cb) { moCb = cb; } observe() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    matchMedia: () => ({ matches: false }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener(t, fn) { if (!winListeners.has(t)) winListeners.set(t, new Set()); winListeners.get(t).add(fn); },
    removeEventListener(t, fn) { winListeners.get(t)?.delete(fn); },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    __agAnimatedIcons: { renderIcon: () => '<svg></svg>' },
    Map, Set, WeakMap, WeakSet, Array, Object, Math, Number, String, Boolean, Date, Promise, RegExp, JSON,
  };
  sb.window = sb; sb.globalThis = sb;
  vm.runInNewContext(uiSrc, sb);
  sb.__agCsUiMain({ motionLevel: 'ultra', sidebarRestyle: true, homeLayout: 'off', homeRipple: false });

  // 1) 20 sidebar hover button (with SVG, in both <aside> and non-<aside> <div> wrappers) -> 0 runSync & 0 iconIncrementalRuns
  const perf0 = sb.__agPrism.getState().perf;
  for (let i = 0; i < 20; i++) {
    const targetRow = i % 2 === 0 ? row : divRow;
    const hoverBtn = mkNode('button', { class: 'hover-act' });
    hoverBtn.appendChild(mkNode('svg', { class: 'lucide lucide-ellipsis' }));
    targetRow.appendChild(hoverBtn);
    moCb([{ type: 'childList', target: targetRow, addedNodes: [hoverBtn], removedNodes: [] }]);
    targetRow.removeChild(hoverBtn);
    moCb([{ type: 'childList', target: targetRow, addedNodes: [], removedNodes: [hoverBtn] }]);
  }
  while (rafs.length) rafs.shift()(now += 16);
  const perf1 = sb.__agPrism.getState().perf;
  assert.equal(perf1.syncCount, perf0.syncCount, 'Sidebar hover button add/remove must trigger 0 runSync calls');
  assert.equal(perf1.iconIncrementalRuns, perf0.iconIncrementalRuns, 'Sidebar hover button must trigger 0 iconIncrementalRuns');

  // 2) Unfocused pointermove wakes BLUR_ATTR in 0ms and throttles rapid re-arms within 400ms
  hasFocusVal = false;
  blurTimerCreations = 0;
  for (const fn of winListeners.get('blur') || []) fn();
  assert.equal(blurTimerCreations, 1);
  for (const [id, t] of [...timers.entries()]) { if (t.ms === 1200) { timers.delete(id); t.fn(); } }
  assert.equal(html.getAttribute('data-ag-cs-win-blur'), '1');

  blurTimerCreations = 0;
  const pmFns = [...(winListeners.get('pointermove') || [])];
  for (const fn of pmFns) fn({ clientX: 10, clientY: 10 });
  assert.equal(html.getAttribute('data-ag-cs-win-blur'), null, 'First pointermove must wake blur attr in 0ms');
  assert.equal(blurTimerCreations, 1, 'First wake re-arms 1 blur timer');

  for (let i = 0; i < 30; i++) {
    now += 6;
    for (const fn of pmFns) fn({ clientX: 10 + i, clientY: 20 + i });
  }
  assert.equal(blurTimerCreations, 1, 'Rapid pointermove within 400ms must throttle blur timer re-arms');
  sb.__agPrism.destroy();
});

test('style.css excludes hover-card-popup from backdrop-filter and enforces Light Mode contrast & mascot clearance', () => {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.ok(
    css.includes('.agy-overlay:not([data-hover-card-popup]):not([data-testid="model-selector-panel"]),.surface-glass'),
    'style.css must exclude [data-hover-card-popup] from backdrop-filter'
  );
  assert.ok(css.includes('padding-bottom:76px !important;'), 'conversation viewport must reserve 76px bottom clearance for dual mascots');
  assert.ok(css.includes('padding-bottom:72px !important;'), 'studio home must reserve 72px bottom clearance for dual mascots');
  assert.ok(css.includes('--muted-foreground:#4B5B73 !important;'), 'Crystal light muted foreground must meet WCAG AA contrast');
  assert.ok(css.includes('--muted-foreground:#574F45 !important;'), 'Alabaster light muted foreground must meet WCAG AA contrast');
});
