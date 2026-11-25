import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

const usageCore = require(path.join(ROOT, 'usage-core.js'));
const cdp = require(path.join(ROOT, 'cdp.js'));

function createFakeDom() {
  const attrsMap = new WeakMap();
  function matchSingle(el, sel) {
    if (!el || el.nodeType !== 1) return false;
    let rest = sel.trim();
    if (!rest) return false;
    const tagM = rest.match(/^([a-zA-Z0-9_-]+)/);
    if (tagM) {
      if (el.tagName !== tagM[1].toUpperCase()) return false;
      rest = rest.slice(tagM[0].length);
    }
    while (rest.length > 0) {
      if (rest[0] === '.') {
        const m = rest.match(/^\.([a-zA-Z0-9_-]+)/);
        if (!m || !el.classList.contains(m[1])) return false;
        rest = rest.slice(m[0].length);
      } else if (rest[0] === '[') {
        const m = rest.match(/^\[([a-zA-Z0-9_-]+)(?:=["']([^"']*)["'])?\]/);
        if (!m) return false;
        const val = el.getAttribute(m[1]);
        if (val === null) return false;
        if (m[2] !== undefined && val !== m[2]) return false;
        rest = rest.slice(m[0].length);
      } else {
        return false;
      }
    }
    return true;
  }

  class FakeNode {
    constructor(nodeType, tagName = '') {
      this.nodeType = nodeType;
      this.tagName = tagName ? tagName.toUpperCase() : '';
      this.childNodes = [];
      this.parentNode = null;
      this.ownerDocument = null;
      this._listeners = new Map();
      const styleProps = new Map();
      this.style = {
        get background() { return styleProps.get('background') || ''; },
        set background(v) { if (v) styleProps.set('background', String(v)); else styleProps.delete('background'); },
        get height() { return styleProps.get('height') || ''; },
        set height(v) { styleProps.set('height', String(v)); },
        get bottom() { return styleProps.get('bottom') || ''; },
        set bottom(v) { styleProps.set('bottom', String(v)); },
        get left() { return styleProps.get('left') || ''; },
        set left(v) { styleProps.set('left', String(v)); },
      };
      this.classList = {
        _set: new Set(),
        add: (...cs) => { cs.forEach((c) => { if (c) this.classList._set.add(c); }); this._syncClass(); },
        remove: (...cs) => { cs.forEach((c) => this.classList._set.delete(c)); this._syncClass(); },
        contains: (c) => this.classList._set.has(c),
      };
      attrsMap.set(this, new Map());
    }
    _syncClass() { attrsMap.get(this).set('class', [...this.classList._set].join(' ')); }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
    get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
    get firstElementChild() { return this.children[0] || null; }
    get nextSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.childNodes.indexOf(this);
      return idx >= 0 ? this.parentNode.childNodes[idx + 1] || null : null;
    }
    get id() { return this.getAttribute('id') || ''; }
    set id(v) { this.setAttribute('id', v); }
    get isConnected() {
      let cur = this;
      while (cur) { if (cur === doc.documentElement) return true; cur = cur.parentNode; }
      return false;
    }
    get className() { return this.getAttribute('class') || ''; }
    set className(v) {
      this.classList._set.clear();
      String(v || '').split(/\s+/).filter(Boolean).forEach((c) => this.classList._set.add(c));
      this._syncClass();
    }
    set textContent(v) {
      for (const c of this.childNodes) c.parentNode = null;
      this.childNodes = [];
      const s = String(v ?? '');
      if (s) this.appendChild(doc.createTextNode(s));
    }
    get textContent() {
      if (this.nodeType === 3) return this.nodeValue || '';
      return this.childNodes.map((c) => c.textContent).join('');
    }
    set innerHTML(v) {
      for (const c of this.childNodes) c.parentNode = null;
      this.childNodes = [];
      if (v) this.appendChild(doc.createTextNode(String(v)));
    }
    setAttribute(k, v) {
      const val = String(v);
      attrsMap.get(this).set(k, val);
      if (k === 'class') {
        this.classList._set.clear();
        val.split(/\s+/).filter(Boolean).forEach((c) => this.classList._set.add(c));
      }
    }
    getAttribute(k) { const m = attrsMap.get(this); return m.has(k) ? m.get(k) : null; }
    hasAttribute(k) { return attrsMap.get(this).has(k); }
    removeAttribute(k) { attrsMap.get(this).delete(k); }
    appendChild(child) {
      if (child.nodeType === 11) {
        for (const c of child.childNodes.slice()) this.appendChild(c);
        return child;
      }
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      child.ownerDocument = doc;
      this.childNodes.push(child);
      return child;
    }
    insertBefore(child, ref) {
      if (!ref) return this.appendChild(child);
      if (child.parentNode) child.parentNode.removeChild(child);
      const idx = this.childNodes.indexOf(ref);
      child.parentNode = this;
      child.ownerDocument = doc;
      if (idx < 0) this.childNodes.push(child);
      else this.childNodes.splice(idx, 0, child);
      return child;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx >= 0) { this.childNodes.splice(idx, 1); child.parentNode = null; }
      return child;
    }
    addEventListener(type, fn) {
      if (!this._listeners.has(type)) this._listeners.set(type, []);
      this._listeners.get(type).push(fn);
    }
    dispatchEvent(ev) {
      ev.target = ev.target || this;
      for (const fn of (this._listeners.get(ev.type) || []).slice()) fn.call(this, ev);
      return true;
    }
    matches(sel) { return String(sel).split(',').some((s) => matchSingle(this, s)); }
    closest(sel) {
      let cur = this;
      while (cur && cur.nodeType === 1) { if (cur.matches(sel)) return cur; cur = cur.parentElement; }
      return null;
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 1) {
            if (c.matches(sel)) out.push(c);
            walk(c);
          }
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  }

  const doc = {
    nodeType: 9,
    documentElement: null,
    head: null,
    body: null,
    createElement(tag) { const n = new FakeNode(1, tag); n.ownerDocument = doc; return n; },
    createElementNS(_ns, tag) { const n = new FakeNode(1, tag); n.ownerDocument = doc; return n; },
    createDocumentFragment() { const n = new FakeNode(11, '#fragment'); n.ownerDocument = doc; return n; },
    createTextNode(val) { const n = new FakeNode(3); n.nodeValue = String(val ?? ''); n.ownerDocument = doc; return n; },
    getElementById(id) { return doc.documentElement.querySelectorAll('*').find((e) => e.getAttribute('id') === id) || null; },
    querySelector(sel) { return doc.documentElement.querySelector(sel); },
    querySelectorAll(sel) { return doc.documentElement.querySelectorAll(sel); },
  };
  doc.documentElement = doc.createElement('html');
  doc.head = doc.createElement('head');
  doc.body = doc.createElement('body');
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  return { doc };
}

function hexToRgb(hex) {
  const m = String(hex).trim().match(/^#([0-9a-f]{6})$/i);
  assert.ok(m, `Expected #RRGGBB hex token, got ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHue([r, g, b]) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const d = max - min;
  if (d === 0) return 0;
  let h = 0;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return (h * 60 + 360) % 360;
}

function hueGap(a, b) {
  const diff = Math.abs(a - b) % 360;
  return Math.min(diff, 360 - diff);
}

function rgbDist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

test('Issue #82: Dark and Light --_d0..--_d9 model palettes are maximally distinct across the hue wheel with zero blue collisions', () => {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const extractPalette = (slice) => {
    const out = [];
    for (let i = 0; i < 10; i++) {
      const m = slice.match(new RegExp(`--_d${i}:(#[0-9A-Fa-f]{6})`));
      assert.ok(m, `Missing --_d${i} token`);
      out.push(m[1]);
    }
    return out;
  };
  const lightIdx = css.indexOf('&[data-ag-cs-theme="light"]');
  assert.ok(lightIdx > 0);
  const darkPalette = extractPalette(css.slice(0, lightIdx));
  const lightPalette = extractPalette(css.slice(lightIdx, lightIdx + 4500));

  for (const [name, pal] of [['dark', darkPalette], ['light', lightPalette]]) {
    const rgbs = pal.map(hexToRgb);
    const hues = rgbs.slice(0, 9).map(rgbToHue);
    for (let i = 0; i < hues.length; i++) {
      for (let j = i + 1; j < hues.length; j++) {
        const gap = hueGap(hues[i], hues[j]);
        assert.ok(
          gap >= 25,
          `${name} palette chromatic slots ${i} (${pal[i]}) and ${j} (${pal[j]}) must have >= 25° hue gap, got ${gap.toFixed(1)}°`
        );
      }
    }
    for (let i = 0; i < rgbs.length; i++) {
      for (let j = i + 1; j < rgbs.length; j++) {
        const d = rgbDist(rgbs[i], rgbs[j]);
        assert.ok(
          d >= 55,
          `${name} palette slots ${i} (${pal[i]}) and ${j} (${pal[j]}) must have >= 55 RGB distance, got ${d.toFixed(1)}`
        );
      }
    }
  }
});

test('Issue #82: createHomeModelColours preserves usage-ranked priority, stays stable on filter, avoids cross-workspace starvation, and home-studio-panel styles 10+ overflow models uniquely', () => {
  const assign = usageCore.createHomeModelColours();
  const issue82 = assign([
    'Gemini 4 Hydrogen (High)',
    'Gemini 4 Neon (High)',
    'Gemini 4 Hydrogen (XHigh)',
  ]);
  assert.deepEqual(issue82, {
    'Gemini 4 Hydrogen (High)': 0,
    'Gemini 4 Neon (High)': 1,
    'Gemini 4 Hydrogen (XHigh)': 2,
  });

  const range7d = assign(['Gemini 4 Neon (High)', 'Gemini 4 Hydrogen (XHigh)']);
  assert.deepEqual(range7d, {
    'Gemini 4 Neon (High)': 1,
    'Gemini 4 Hydrogen (XHigh)': 2,
  });

  const wsA = assign(Array.from({ length: 12 }, (_, i) => `wsA-model-${i}`));
  assert.equal(new Set(Object.values(wsA)).size, 12);
  const wsB = assign(['wsB-primary', 'wsB-secondary', 'wsB-tertiary']);
  assert.deepEqual(wsB, { 'wsB-primary': 0, 'wsB-secondary': 1, 'wsB-tertiary': 2 });

  const merged = assign(['wsA-model-0', 'wsB-primary', 'wsB-secondary', 'wsA-model-1']);
  assert.equal(new Set(Object.values(merged)).size, 4);
  assert.equal(merged['wsA-model-0'], 0);

  const assign15 = usageCore.createHomeModelColours();
  const ids15 = Array.from({ length: 15 }, (_, i) => `Model-${i}`);
  const map15 = assign15(ids15);
  assert.equal(new Set(Object.values(map15)).size, 15);
  assert.deepEqual(Object.values(map15).sort((a, b) => a - b), Array.from({ length: 15 }, (_, i) => i));

  const { doc } = createFakeDom();
  const home = doc.createElement('div');
  home.className = 'agy-home';
  const greeting = doc.createElement('div');
  greeting.setAttribute('data-testid', 'home-greeting');
  home.appendChild(greeting);
  doc.body.appendChild(home);

  const src = fs.readFileSync(path.join(ROOT, 'home-studio-panel.js'), 'utf8');
  const sb = {
    document: doc,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    requestAnimationFrame: (fn) => { fn(16); return 1; },
    cancelAnimationFrame: () => {},
    Map, Set, Array, Object, Math, Number, String, Boolean, Date, JSON, Promise,
  };
  sb.window = sb;
  sb.globalThis = sb;
  vm.runInNewContext(src, sb);

  const models12 = Array.from({ length: 12 }, (_, i) => ({
    id: `Model-${String(i).padStart(2, '0')}`,
    tokens: (12 - i) * 1000,
    sessions: 1,
    input: (12 - i) * 700,
    output: (12 - i) * 300,
    cacheHitRate: 0.5,
  }));
  const dayModels = Object.fromEntries(models12.map((m) => [m.id, m.tokens]));
  const stubUsageCore = {
    ...usageCore,
    HOME_MODEL_ROWS: 12,
    aggregateUsageRollup: () => ({
      workspaces: [],
      sessions: 12,
      calls: 24,
      tokens: 78000,
      subagentTokens: 0,
      cacheHitRate: 0.5,
      activeDays: 1,
      model: models12[0].id,
      grid: { cells: [] },
      models: models12,
      modelDays: [{ date: '2026-11-26', models: dayModels }],
    }),
  };

  const ctl = sb.__agPrismHomeStudioPanel.createHomeStudioPanelController({
    usageCore: stubUsageCore,
    isDestroyed: () => false,
    getHomeLayout: () => 'studio',
    getLang: () => 'en',
    uiText: () => ({}),
    getDisplayName: () => '',
    ensureHooks: () => null,
    canMountRealCanvas: () => false,
    setAttrIfChanged: (el, k, v) => el.setAttribute(k, v),
    runGuardedMut: (fn) => fn(),
  });
  ctl.renderHomePanel();
  const tabs = home.querySelectorAll('.ag-cs-home-tab');
  const modelsTab = tabs.find((b) => b.getAttribute('data-tab') === 'models') || tabs[1];
  assert.ok(modelsTab);
  modelsTab.dispatchEvent({ type: 'click', bubbles: true });

  const swatches = home.querySelectorAll('.ag-cs-home-model-swatch');
  const segs = home.querySelectorAll('.ag-cs-home-chart-seg');
  assert.equal(swatches.length, 12);
  assert.equal(segs.length, 12);

  for (let i = 0; i < 10; i++) {
    assert.equal(swatches[i].getAttribute('data-color'), String(i));
    assert.equal(swatches[i].style.background, '');
  }
  assert.equal(swatches[10].getAttribute('data-color'), '10');
  assert.equal(swatches[11].getAttribute('data-color'), '11');
  assert.match(swatches[10].style.background, /^hsl\(\d+ 68% 52%\)$/);
  assert.match(swatches[11].style.background, /^hsl\(\d+ 68% 52%\)$/);
  assert.notEqual(swatches[10].style.background, swatches[11].style.background);
  assert.equal(segs[10].style.background, swatches[10].style.background);
  assert.equal(segs[11].style.background, swatches[11].style.background);

  const autoBytes = Buffer.byteLength(cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: 'auto' }, { bundleCachePath: '' }), 'utf8');
  assert.ok(autoBytes < 547500, `Channel 1 auto must remain < 547,500 B, got ${autoBytes}`);
});
