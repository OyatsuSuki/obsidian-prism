import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

globalThis.__agCodexEffortSliderDisableAutoBoot = true;
const upstreamSlider = require(path.join(ROOT, 'vendor', 'effort-slider', 'upstream-client.js'));
const hostI18n = require(path.join(ROOT, 'vendor', 'host-i18n', 'host-i18n-runtime.js'));
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
      if (rest[0] === '#') {
        const m = rest.match(/^#([a-zA-Z0-9_-]+)/);
        if (!m || el.id !== m[1]) return false;
        rest = rest.slice(m[0].length);
      } else if (rest[0] === '.') {
        const m = rest.match(/^\.([a-zA-Z0-9_-]+)/);
        if (!m || !el.classList.contains(m[1])) return false;
        rest = rest.slice(m[0].length);
      } else if (rest[0] === '[') {
        const m = rest.match(/^\[([a-zA-Z0-9_-]+)(?:(\^?=)["']([^"']*)["'])?\]/);
        if (!m) return false;
        const val = el.getAttribute(m[1]);
        if (val === null) return false;
        if (m[2] === '=' && val !== m[3]) return false;
        if (m[2] === '^=' && !val.startsWith(m[3])) return false;
        rest = rest.slice(m[0].length);
      } else {
        return false;
      }
    }
    return true;
  }

  function matchesSelector(el, selectorList) {
    return String(selectorList || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .some((sel) => {
        if (sel.includes(' ')) {
          const parts = sel.split(/\s+/).filter(Boolean);
          if (!matchSingle(el, parts[parts.length - 1])) return false;
          let cur = el.parentElement;
          let pi = parts.length - 2;
          while (cur && pi >= 0) {
            if (matchSingle(cur, parts[pi])) pi -= 1;
            cur = cur.parentElement;
          }
          return pi < 0;
        }
        return matchSingle(el, sel);
      });
  }

  class FakeNode {
    constructor(nodeType, tagName = '') {
      this.nodeType = nodeType;
      this.tagName = tagName ? tagName.toUpperCase() : '';
      this.childNodes = [];
      this.parentNode = null;
      this.ownerDocument = null;
      this._listeners = new Map();
      this.hidden = false;
      this.disabled = false;
      const styleProps = new Map();
      this.style = {
        setProperty(k, v) { styleProps.set(k, String(v)); },
        getPropertyValue(k) { return styleProps.get(k) || ''; },
        removeProperty(k) { styleProps.delete(k); },
      };
      this.classList = {
        _set: new Set(),
        add: (...cs) => { cs.forEach((c) => { if (c) this.classList._set.add(c); }); this._syncClass(); },
        remove: (...cs) => { cs.forEach((c) => this.classList._set.delete(c)); this._syncClass(); },
        toggle: (c, f) => {
          const on = f === undefined ? !this.classList._set.has(c) : Boolean(f);
          if (on) this.classList._set.add(c); else this.classList._set.delete(c);
          this._syncClass();
          return on;
        },
        contains: (c) => this.classList._set.has(c),
      };
      attrsMap.set(this, new Map());
    }
    _syncClass() { attrsMap.get(this).set('class', [...this.classList._set].join(' ')); }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
    get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
    get firstChild() { return this.childNodes[0] || null; }
    get firstElementChild() { return this.children[0] || null; }
    get nextSibling() {
      if (!this.parentNode) return null;
      const idx = this.parentNode.childNodes.indexOf(this);
      return idx >= 0 ? this.parentNode.childNodes[idx + 1] || null : null;
    }
    get nextElementSibling() {
      let cur = this.nextSibling;
      while (cur && cur.nodeType !== 1) cur = cur.nextSibling;
      return cur || null;
    }
    get isConnected() {
      let cur = this;
      while (cur) {
        if (cur === doc.documentElement) return true;
        cur = cur.parentNode;
      }
      return false;
    }
    get className() { return this.getAttribute('class') || ''; }
    set className(v) {
      this.classList._set.clear();
      String(v || '').split(/\s+/).filter(Boolean).forEach((c) => this.classList._set.add(c));
      this._syncClass();
    }
    get id() { return this.getAttribute('id') || ''; }
    set id(v) { this.setAttribute('id', v); }
    get textContent() {
      if (this.nodeType === 3) return this.nodeValue || '';
      return this.childNodes.map((c) => c.textContent).join('');
    }
    set textContent(v) {
      if (this.nodeType === 3) { this.nodeValue = String(v ?? ''); return; }
      for (const c of this.childNodes) c.parentNode = null;
      this.childNodes = [];
      const s = String(v ?? '');
      if (s) this.appendChild(doc.createTextNode(s));
    }
    set innerHTML(v) {
      for (const c of this.childNodes) c.parentNode = null;
      this.childNodes = [];
      if (v) this.appendChild(doc.createTextNode(String(v)));
    }
    get innerHTML() { return this.textContent; }
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
    removeChild(child) {
      const idx = this.childNodes.indexOf(child);
      if (idx >= 0) { this.childNodes.splice(idx, 1); child.parentNode = null; }
      return child;
    }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    contains(other) {
      let cur = other;
      while (cur) { if (cur === this) return true; cur = cur.parentNode; }
      return false;
    }
    addEventListener(type, fn, opts = false) {
      const cap = typeof opts === 'object' ? Boolean(opts?.capture) : Boolean(opts);
      const key = `${type}:${cap ? 1 : 0}`;
      if (!this._listeners.has(key)) this._listeners.set(key, []);
      this._listeners.get(key).push(fn);
    }
    removeEventListener(type, fn, opts = false) {
      const cap = typeof opts === 'object' ? Boolean(opts?.capture) : Boolean(opts);
      const key = `${type}:${cap ? 1 : 0}`;
      const arr = this._listeners.get(key);
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    }
    dispatchEvent(ev) {
      ev.target = ev.target || this;
      ev.preventDefault = ev.preventDefault || (() => { ev.defaultPrevented = true; });
      ev.stopPropagation = ev.stopPropagation || (() => { ev._stopped = true; });
      ev.stopImmediatePropagation = ev.stopImmediatePropagation || (() => { ev._stopped = true; });
      const pathNodes = [];
      let cur = this;
      while (cur) { pathNodes.push(cur); cur = cur.parentNode; }
      pathNodes.push(doc);
      for (let i = pathNodes.length - 1; i >= 0; i--) {
        for (const fn of (pathNodes[i]._listeners.get(`${ev.type}:1`) || []).slice()) fn.call(pathNodes[i], ev);
      }
      if (!ev._stopped) {
        for (let i = 0; i < pathNodes.length; i++) {
          for (const fn of (pathNodes[i]._listeners.get(`${ev.type}:0`) || []).slice()) fn.call(pathNodes[i], ev);
        }
      }
      return !ev.defaultPrevented;
    }
    matches(sel) { return matchesSelector(this, sel); }
    closest(sel) {
      let cur = this;
      while (cur && cur.nodeType === 1) {
        if (matchesSelector(cur, sel)) return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    querySelectorAll(sel) {
      const out = [];
      const walk = (n) => {
        for (const c of n.childNodes) {
          if (c.nodeType === 1) {
            if (matchesSelector(c, sel)) out.push(c);
            walk(c);
          }
        }
      };
      walk(this);
      return out;
    }
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 220, height: 28, right: 220, bottom: 28 }; }
  }

  const doc = {
    nodeType: 9,
    documentElement: null,
    head: null,
    body: null,
    _listeners: new Map(),
    createElement(tag) { const n = new FakeNode(1, tag); n.ownerDocument = doc; return n; },
    createTextNode(val) { const n = new FakeNode(3); n.nodeValue = String(val ?? ''); n.ownerDocument = doc; return n; },
    getElementById(id) { return doc.documentElement.querySelectorAll('*').find((e) => e.id === id) || null; },
    querySelector(sel) { return doc.documentElement.querySelector(sel); },
    querySelectorAll(sel) { return doc.documentElement.querySelectorAll(sel); },
    addEventListener(type, fn, opts = false) {
      const cap = typeof opts === 'object' ? Boolean(opts?.capture) : Boolean(opts);
      const key = `${type}:${cap ? 1 : 0}`;
      if (!this._listeners.has(key)) this._listeners.set(key, []);
      this._listeners.get(key).push(fn);
    },
    removeEventListener(type, fn, opts = false) {
      const cap = typeof opts === 'object' ? Boolean(opts?.capture) : Boolean(opts);
      const key = `${type}:${cap ? 1 : 0}`;
      const arr = this._listeners.get(key);
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
  };
  doc.documentElement = doc.createElement('html');
  doc.head = doc.createElement('head');
  doc.body = doc.createElement('body');
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);
  const win = {
    document: doc,
    navigator: { language: 'zh-CN' },
    addEventListener() {},
    removeEventListener() {},
    requestAnimationFrame(fn) { fn(16); return 1; },
    cancelAnimationFrame() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    NodeFilter: { SHOW_TEXT: 4 },
  };
  doc.defaultView = win;
  return { doc, win };
}

test('Issue #80: v2.35.1 nested Orchestrator L3 inside L2 never hides or unbinds L2, tags outer Base-UI positioner, hides only L3, and cleans up cleanly', () => {
  const { doc, win } = createFakeDom();

  const neonLow = { label: 'Gemini 4 Neon (Low)', value: 1534 };
  const neonMed = { label: 'Gemini 4 Neon (Medium)', value: 1533 };
  const neonHigh = { label: 'Gemini 4 Neon (High)', value: 1532 };
  const neonXHigh = { label: 'Gemini 4 Neon (XHigh)', value: 1535 };
  const opusMed = { label: 'Claude Opus 5.5 (Medium)', value: 1401 };
  const opusHigh = { label: 'Claude Opus 5.5 (High)', value: 1402 };
  const orchOpt = { label: 'Orchestrator (Neon)', modelId: 'gemini-pro-orchestrator-neon', value: 1537 };

  const effortIndex = new Map([
    ['Gemini 4 Neon', new Map([['low', neonLow], ['medium', neonMed], ['high', neonHigh], ['xhigh', neonXHigh]])],
    ['Claude Opus 5.5', new Map([['medium', opusMed], ['high', opusHigh]])],
  ]);

  const committedOrch = [];
  const fiberProps = {
    selectedModel: orchOpt,
    modelOptions: [neonLow, neonMed, neonHigh, neonXHigh, opusMed, opusHigh, orchOpt],
    effortIndex,
    orchestratorPlanners: [neonLow, neonMed, neonHigh, neonXHigh, opusMed, opusHigh],
    orchestratorPlannerIndex: effortIndex,
    orchestratorDefaultPlanner: neonHigh,
    orchestratorPick: {
      model: neonMed.value,
      select(v) {
        fiberProps.orchestratorPick.model = v;
        committedOrch.push(v);
      },
    },
    setModelConfigByLabelForConversation() {},
    setIsOpen() {},
  };

  const trig = doc.createElement('button');
  trig.setAttribute('data-testid', 'model-selector-trigger');
  const providerFiber = { memoizedProps: { value: fiberProps }, return: null };
  trig.__reactFiber$i80 = { memoizedProps: fiberProps, return: providerFiber };
  doc.body.appendChild(trig);

  const panel = doc.createElement('div');
  panel.setAttribute('data-testid', 'model-selector-panel');
  const listWrap = doc.createElement('div');
  const orchItem = doc.createElement('div');
  orchItem.setAttribute('role', 'menuitem');
  const orchRow = doc.createElement('div');
  orchRow.setAttribute('data-testid', 'model-selector-orchestrator');
  orchRow.textContent = 'Orchestrator';
  orchItem.appendChild(orchRow);
  listWrap.appendChild(orchItem);
  panel.appendChild(listWrap);
  panel.__reactFiber$i80 = { memoizedProps: fiberProps, return: providerFiber };
  doc.body.appendChild(panel);

  const l2Pos = doc.createElement('div');
  l2Pos.setAttribute('role', 'presentation');
  l2Pos.setAttribute('data-side', 'right');
  l2Pos.setAttribute('data-nested', '');

  const l2Menu = doc.createElement('div');
  l2Menu.setAttribute('role', 'menu');
  l2Menu.className = 'agy-overlay';
  l2Menu.setAttribute('data-side', 'right');

  const rowNeon = doc.createElement('div');
  rowNeon.setAttribute('role', 'menuitem');
  rowNeon.setAttribute('data-testid', 'orchestrator-picker-row');
  rowNeon.setAttribute('data-model-base', 'Gemini 4 Neon');
  rowNeon.textContent = 'Gemini 4 Neon Medium';

  const rowOpus = doc.createElement('div');
  rowOpus.setAttribute('role', 'menuitem');
  rowOpus.setAttribute('data-testid', 'orchestrator-picker-row');
  rowOpus.setAttribute('data-model-base', 'Claude Opus 5.5');
  rowOpus.textContent = 'Claude Opus 5.5 Medium';

  const l3Pos = doc.createElement('div');
  l3Pos.setAttribute('role', 'presentation');
  l3Pos.setAttribute('data-side', 'right');
  l3Pos.setAttribute('data-nested', '');

  const l3Menu = doc.createElement('div');
  l3Menu.setAttribute('role', 'menu');
  l3Menu.className = 'agy-overlay';
  l3Menu.setAttribute('data-testid', 'orchestrator-picker-effort');
  for (const label of ['Off', 'Low', 'Medium', 'High', 'XHigh']) {
    const opt = doc.createElement('div');
    opt.setAttribute('role', 'menuitemradio');
    opt.textContent = label;
    l3Menu.appendChild(opt);
  }
  l3Pos.appendChild(l3Menu);

  const noTestIdL3 = doc.createElement('div');
  noTestIdL3.setAttribute('role', 'menu');
  for (const label of ['低', '中等', '高', '超高']) {
    const opt = doc.createElement('div');
    opt.setAttribute('role', 'menuitemradio');
    opt.textContent = label;
    noTestIdL3.appendChild(opt);
  }

  l2Menu.appendChild(rowNeon);
  l2Menu.appendChild(rowOpus);
  l2Menu.appendChild(l3Pos);
  l2Menu.appendChild(noTestIdL3);
  l2Pos.appendChild(l2Menu);
  doc.body.appendChild(l2Pos);

  const obs = upstreamSlider.installAntigravityObserver({ document: doc, window: win });
  try {
    const styleEl = doc.head.querySelector('#ag-codex-effort-slider-styles');
    assert.ok(styleEl, 'SLIDER_CSS style element must be installed');
    assert.ok(
      styleEl.textContent.includes(
        "html[data-ces-slider-ready='1'] [role='menu']:has([data-testid='orchestrator-picker-effort']):not(:has([data-testid='model-selector-panel'])):not(:has([data-testid='orchestrator-picker-row'])):not([data-ag-cs-orch-l2='1'])"
      )
    );
    assert.ok(
      styleEl.textContent.includes(
        "html[data-ces-slider-ready='1'] div[role='presentation']:has([data-testid='orchestrator-picker-effort']):not(:has([data-testid='model-selector-panel'])):not(:has([data-testid='orchestrator-picker-row'])):not(:has([data-ag-cs-orch-l2='1']))"
      )
    );
    assert.ok(
      styleEl.textContent.includes(
        "html[data-ces-slider-ready='1'] [data-testid='orchestrator-picker-effort']:not(:has([data-testid='model-selector-panel'])):not(:has([data-testid='orchestrator-picker-row']))"
      )
    );

    obs.rescan();

    assert.equal(l2Menu.getAttribute('data-ag-cs-orch-l2'), '1');
    assert.equal(l2Menu.getAttribute('data-ag-cs-model-submenu'), '1');
    assert.equal(l2Pos.getAttribute('data-ag-cs-model-submenu'), '1');
    assert.equal(l2Menu.hasAttribute('data-ag-cs-orch-l3'), false);
    assert.equal(l2Pos.hasAttribute('data-ag-cs-orch-l3'), false);
    assert.equal(l3Menu.getAttribute('data-ag-cs-orch-l3'), '1');
    assert.equal(l3Pos.getAttribute('data-ag-cs-orch-l3'), '1');
    assert.equal(noTestIdL3.getAttribute('data-ag-cs-orch-l3'), '1');
    assert.equal(rowNeon.getAttribute('data-ces-orch-row'), '1');
    assert.equal(rowOpus.getAttribute('data-ces-orch-row'), '1');

    const ck = { type: 'click', target: rowOpus, bubbles: true };
    rowOpus.dispatchEvent(ck);
    assert.equal(ck.defaultPrevented, true);
    assert.equal(committedOrch[committedOrch.length - 1], opusMed.value);
  } finally {
    obs.stop();
  }

  assert.equal(l2Menu.hasAttribute('data-ag-cs-model-submenu'), false);
  assert.equal(l2Menu.hasAttribute('data-ag-cs-orch-l2'), false);
  assert.equal(l2Pos.hasAttribute('data-ag-cs-model-submenu'), false);
  assert.equal(l3Menu.hasAttribute('data-ag-cs-orch-l3'), false);
  assert.equal(l3Pos.hasAttribute('data-ag-cs-orch-l3'), false);
});

test('Issue #80: style.css elevates nested submenu z-index to 6010, disables scale jitter, guards frame-0 row height, keeps Ch1 budget, and host-i18n skips Orchestrator picker boundaries', () => {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  assert.equal(/:has\(/.test(css), false, 'style.css must strictly maintain 0 :has()');
  assert.equal(/[^\x00-\x7F]/.test(css), false, 'style.css must remain 100% ASCII');
  assert.ok(
    css.includes('html[data-ag-cs-model-menu="1"] :is([role="presentation"],[data-nested],[data-side]):is([data-ag-cs-model-submenu="1"],[data-testid="context-menu-submenu-popup"]){z-index:6010 !important;}')
  );
  assert.ok(
    css.includes(':not([data-ces-orch-row="1"]):not([data-testid="orchestrator-picker-row"]){font-size:13px !important;')
  );
  assert.ok(
    css.includes('html[data-ag-cs-style][data-ag-cs-model-menu="1"]:not([data-ag-cs-motion="off"]) :is([data-ag-cs-model-submenu="1"],[data-nested],[data-testid="context-menu-submenu-popup"]){transition:opacity 120ms var(--ag-ease-out) !important;animation:none !important;&[data-starting-style],&[data-ending-style]{transform:none !important;}}')
  );

  const autoBytes = Buffer.byteLength(cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: 'auto' }, { bundleCachePath: '' }), 'utf8');
  assert.ok(autoBytes < 547500, `Channel 1 auto must remain < 547,500 B, got ${autoBytes}`);

  const { doc, win } = createFakeDom();
  const makeLabeled = (attrs, txt) => {
    const el = doc.createElement('div');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    const sp = doc.createElement('span');
    const tn = doc.createTextNode(txt);
    sp.appendChild(tn);
    el.appendChild(sp);
    doc.body.appendChild(el);
    return tn;
  };
  const protectedNodes = [
    makeLabeled({ 'data-testid': 'orchestrator-picker-row' }, 'Medium'),
    makeLabeled({ 'data-testid': 'orchestrator-picker-effort' }, 'High'),
    makeLabeled({ 'data-ag-cs-orch-l2': '1' }, 'Auto'),
    makeLabeled({ 'data-ag-cs-orch-l3': '1' }, 'Low'),
    makeLabeled({ 'data-ces-orch-row': '1' }, 'High'),
  ];
  const normalNode = makeLabeled({ 'data-testid': 'unrelated-chrome' }, 'Settings');

  const inst = hostI18n.mountHostI18n({
    root: win,
    doc,
    mode: 'on',
    dict: { exact: { Low: '低', Medium: '中等', High: '高', Auto: '自动', Settings: '设置' } },
  });
  try {
    assert.deepEqual(protectedNodes.map((n) => n.nodeValue), ['Medium', 'High', 'Auto', 'Low', 'High']);
    assert.equal(normalNode.nodeValue, '设置');
  } finally {
    inst.destroy();
  }
});
