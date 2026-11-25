import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';

import { PrismDaemon } from '../sidecars/daemon/main.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const cdp = require(path.join(ROOT, 'cdp.js'));
const settingsPanel = require(path.join(ROOT, 'settings-panel.js'));
const i18nLocales = require(path.join(ROOT, 'i18n-locales.js'));
const i18nCore = require(path.join(ROOT, 'i18n-core.js'));

function createMiniDom() {
  const matches = (n, selList) =>
    selList.split(',').some((raw) => {
      const s = raw.trim();
      if (!s) return false;
      if (s.startsWith('#')) return n.id === s.slice(1);
      let rest = s;
      const tm = rest.match(/^[a-zA-Z0-9-]+/);
      if (tm) {
        if (n.tagName !== tm[0].toUpperCase()) return false;
        rest = rest.slice(tm[0].length);
      }
      for (const m of rest.matchAll(/\.([a-zA-Z0-9_-]+)/g)) {
        if (!n.classList.contains(m[1])) return false;
      }
      for (const m of rest.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)) {
        if (!n.hasAttribute(m[1])) return false;
        if (m[2] !== undefined && n.getAttribute(m[1]) !== m[2]) return false;
      }
      return true;
    });

  const makeEl = (tag, doc) => {
    const attrs = new Map();
    const listeners = new Map();
    const el = {
      tagName: String(tag).toUpperCase(),
      nodeType: 1,
      id: '',
      innerHTML: '',
      ownerDocument: doc,
      parentElement: null,
      parentNode: null,
      children: [],
      hidden: false,
      disabled: false,
      open: false,
      value: '',
      className: '',
      _text: '',
      style: { setProperty() {}, removeProperty() {} },
      classList: {
        add(c) {
          if (!el.className.split(/\s+/).includes(c)) el.className = `${el.className} ${c}`.trim();
        },
        remove(c) {
          el.className = el.className.split(/\s+/).filter((x) => x !== c).join(' ');
        },
        contains(c) {
          return el.className.split(/\s+/).includes(c);
        },
      },
      get isConnected() {
        let p = el;
        while (p) {
          if (p === doc.documentElement) return true;
          p = p.parentElement;
        }
        return false;
      },
      get textContent() {
        return el.children.length ? el._text + el.children.map((c) => c.textContent).join('') : el._text;
      },
      set textContent(v) {
        el._text = String(v ?? '');
        el.children.length = 0;
      },
      get firstChild() {
        return el.children[0] || null;
      },
      setAttribute(k, v) {
        attrs.set(k, String(v));
        if (k === 'id') el.id = String(v);
        if (k === 'hidden') el.hidden = true;
      },
      getAttribute(k) {
        return attrs.has(k) ? attrs.get(k) : null;
      },
      hasAttribute(k) {
        return attrs.has(k);
      },
      removeAttribute(k) {
        attrs.delete(k);
        if (k === 'hidden') el.hidden = false;
      },
      toggleAttribute(k, f) {
        const on = f === undefined ? !attrs.has(k) : Boolean(f);
        if (on) attrs.set(k, '');
        else attrs.delete(k);
        return on;
      },
      appendChild(c) {
        c.parentElement = el;
        c.parentNode = el;
        el.children.push(c);
        if (el.tagName === 'SELECT' && c.tagName === 'OPTION' && !el.value) el.value = c.value;
        return c;
      },
      removeChild(c) {
        el.children = el.children.filter((x) => x !== c);
        c.parentElement = null;
        c.parentNode = null;
        return c;
      },
      remove() {
        if (el.parentElement) el.parentElement.removeChild(el);
      },
      closest(sel) {
        let cur = el;
        while (cur) {
          if (matches(cur, sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      addEventListener(ev, fn) {
        if (!listeners.has(ev)) listeners.set(ev, []);
        listeners.get(ev).push(fn);
      },
      removeEventListener() {},
      dispatchEvent(ev) {
        for (const fn of listeners.get(ev.type) || []) fn(ev);
      },
      click() {
        if (el.disabled) return;
        for (const fn of listeners.get('click') || []) fn({ preventDefault() {}, stopPropagation() {} });
      },
      querySelector(sel) {
        return el.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        const out = [];
        const walk = (n) => {
          for (const c of n.children || []) {
            if (matches(c, sel)) out.push(c);
            walk(c);
          }
        };
        walk(el);
        return out;
      },
    };
    return el;
  };

  const doc = {
    body: null,
    head: null,
    documentElement: null,
    createElement(tag) {
      return makeEl(tag, doc);
    },
    getElementById(id) {
      return doc.documentElement.querySelector('#' + id);
    },
    querySelectorAll(s) {
      return doc.documentElement.querySelectorAll(s);
    },
    querySelector(s) {
      return doc.documentElement.querySelector(s);
    },
  };
  doc.documentElement = makeEl('html', doc);
  doc.head = makeEl('head', doc);
  doc.body = makeEl('body', doc);
  doc.documentElement.appendChild(doc.head);
  doc.documentElement.appendChild(doc.body);

  const dialog = makeEl('div', doc);
  dialog.setAttribute('role', 'dialog');
  const panel = makeEl('div', doc);
  const h2 = makeEl('h2', doc);
  h2.textContent = 'Appearance';
  const anchor = makeEl('div', doc);
  anchor.className = 'space-y-2';
  panel.appendChild(h2);
  panel.appendChild(anchor);
  dialog.appendChild(panel);
  doc.body.appendChild(dialog);

  return { doc, dialog, panel, makeEl };
}

test('style.css fixes dark/light markdown-alert title contrast, step-plan done contrast, 2-line credit cards, button hierarchy, and 280px storage workbench pre within Channel 1 budget', () => {
  const rawBuf = fs.readFileSync(path.join(ROOT, 'style.css'));
  assert.equal(rawBuf[0] === 0xef && rawBuf[1] === 0xbb && rawBuf[2] === 0xbf, false, 'style.css must have 0 BOM');
  const css = rawBuf.toString('utf8');
  assert.equal(css.includes('\r'), false, 'style.css must have 0 CRLF');
  assert.equal(/[^\x00-\x7F]/.test(css), false, 'style.css must remain pure ASCII');
  assert.equal(/:has\(/.test(css), false, 'style.css must have 0 :has() selectors');

  const lightIdx = css.indexOf('html[data-ag-cs-style][data-ag-cs-theme="light"]');
  assert.ok(lightIdx > 0, 'style.css must have light-theme override section');
  const baseSection = css.slice(0, lightIdx);
  const lightSection = css.slice(lightIdx);

  // 1) Markdown Alert title contrast in dark & light themes
  const alertLine = baseSection.split('\n').find((l) => l.includes('& .markdown-alert{')) || '';
  assert.ok(alertLine.includes('&>.markdown-alert-title{color:var(--_ma) !important;}'), 'markdown-alert must color its title with theme-aware --_ma');
  assert.ok(lightSection.includes('.markdown-alert{--_ma:#1D4ED8;') && lightSection.includes('&.markdown-alert-tip{--_ma:#15803D;') && lightSection.includes('&.markdown-alert-warning{--_ma:#B45309;'), 'light theme must override --_ma to WCAG AA dark tokens for markdown alerts');

  // 2) Step-plan done text contrast (without opacity)
  const spLine = baseSection.split('\n').find((l) => l.includes('[data-testid="step-plan-item"]{')) || '';
  assert.ok(spLine.includes('&[data-status="done"]{--_sc:var(--success);--_st:color-mix(in srgb,var(--foreground) '), 'done step-plan item must raise text contrast above muted-foreground');
  assert.equal(spLine.includes('opacity:'), false, 'step-plan-item must not use opacity dimming');

  // 3) Two-line credits card & storage detail pre height & button hierarchy tones
  assert.ok(baseSection.includes('.ag-cs-credit-top{') && baseSection.includes('.ag-cs-credit-repo{') && baseSection.includes('.ag-cs-credit-meta{'), 'style.css must define 2-line credit card classes');
  assert.ok(baseSection.includes('pre[data-ag-cs-storage-detail="1"]{') && baseSection.includes('max-height:280px;'), 'storage detail pre must expand max-height to 280px');
  assert.ok(baseSection.includes('&[data-tone="secondary"]{') && baseSection.includes('&[data-tone="amber"]{') && baseSection.includes('&[data-active="1"]{'), 'about action buttons must style secondary, amber, and active states');

  // 4) Balanced braces & Channel 1 byte budget < 549,500 B across all 9 locales
  let depth = 0;
  for (const ch of css) {
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    assert.ok(depth >= 0, 'style.css must never close an unopened brace');
  }
  assert.equal(depth, 0, 'style.css braces must be balanced');

  for (const lang of ['auto', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'es', 'fr', 'de']) {
    const ch1Bytes = Buffer.byteLength(cdp.buildInjectExpression({ ...cdp.DEFAULT_CONFIG, language: lang }, { bundleCachePath: '' }), 'utf8');
    assert.ok(ch1Bytes < 549500, `Channel 1 (${lang}) bundle (${ch1Bytes} B) must stay < 549,500 B`);
  }
});

test('settings-panel renders 2-line credit cards without crushing repo names, clear update/archive button hierarchy, and unified maintenance action row', async () => {
  const prevDoc = globalThis.document;
  const prevWin = globalThis.window;
  const prevStorage = globalThis.localStorage;
  try {
    const { doc } = createMiniDom();
    const storeMap = new Map([['ag-prism:settings-open', '1'], ['ag-prism:settings-subtab', 'about']]);
    const storage = {
      getItem: (k) => (storeMap.has(k) ? storeMap.get(k) : null),
      setItem: (k, v) => storeMap.set(k, String(v)),
      removeItem: (k) => storeMap.delete(k),
    };
    globalThis.document = doc;
    globalThis.window = {
      document: doc,
      localStorage: storage,
      __agPrismRepoBridge: () => ({ ok: true, noRemote: true, branch: 'local' }),
    };
    globalThis.localStorage = storage;

    const state = { ...settingsPanel.getDefaultSettingsPatch(), language: 'zh-CN' };
    settingsPanel.mountOrSyncSettingsSection({
      version: '1.0.8-beta.2',
      getLang: () => state.language,
      uiText: (l) => i18nLocales.getUiStrings(l),
      isZh: () => true,
      i18nCore,
      formatSettingsSummary: () => 'summary',
      resolveSettingRowActiveValue: (k) => state[k],
      isSettingButtonMatch: (_k, valJson, cur) => JSON.parse(valJson) === cur,
      saveSetting: (k, v) => { state[k] = v; },
      saveSettingsBatch: (p) => Object.assign(state, p),
      getThoughtTranslateMode: () => state.thoughtTranslate,
      handledGroupClicks: new WeakSet(),
      runSettingsGroupGlide: () => {},
      runGuardedMut: (fn) => fn(),
    });
    await new Promise((r) => setTimeout(r, 15));

    const sec = doc.getElementById('ag-cs-settings-sec');
    assert.ok(sec, 'settings section must mount');

    // 1) Credits cards use 2-line structure so long meta never crushes repo name
    const creditCard = sec.querySelector('[data-ag-cs-credit="claudenoshujin/claude-web"]');
    assert.ok(creditCard, 'claudenoshujin/claude-web credit card must exist');
    const topEl = creditCard.querySelector('.ag-cs-credit-top');
    const repoEl = creditCard.querySelector('.ag-cs-credit-repo');
    const extEl = creditCard.querySelector('.ag-cs-credit-ext');
    const metaEl = creditCard.querySelector('.ag-cs-credit-meta');
    assert.ok(topEl && repoEl && extEl && metaEl, 'credit card must render 2-line .ag-cs-credit-top (.ag-cs-credit-repo + .ag-cs-credit-ext) and .ag-cs-credit-meta');
    assert.equal(repoEl.textContent, 'claudenoshujin/claude-web');
    assert.equal(extEl.textContent, '↗');
    assert.ok(metaEl.textContent.includes('Mascot Pile'));
    assert.equal(creditCard.querySelector('.shrink-0'), null, 'credit card meta must not use single-row shrink-0 that crushes repo name');

    // 2) Clear button hierarchy: Git sync secondary, Check Update primary, Archive & Restart amber
    const syncBtn = sec.querySelector('[data-ag-cs-repo-sync="1"]');
    const checkUpdBtn = sec.querySelector('[data-ag-cs-update-check="1"]');
    const archRestartBtn = sec.querySelector('[data-ag-cs-archive-restart="1"]');
    const restoreBtn = sec.querySelector('[data-ag-cs-storage-restore="1"]');
    const archiveBtn = sec.querySelector('[data-ag-cs-storage-archive="1"]');
    assert.equal(syncBtn.getAttribute('data-tone'), 'secondary', 'Git sync button must be secondary so it does not compete with Check Update');
    assert.notEqual(checkUpdBtn.getAttribute('data-tone'), 'secondary', 'Check Update must stay primary');
    assert.equal(archRestartBtn.getAttribute('data-tone'), 'amber', 'Archive & Restart must use amber primary emphasis');
    assert.equal(restoreBtn.getAttribute('data-tone'), 'secondary', 'Restore Archive must use secondary tone');
    assert.equal(archiveBtn.getAttribute('data-tone'), 'secondary', 'Generate Offline Script must use secondary tone');

    // 3) Unified maintenance action row groups archRestartBtn, restoreBtn, and archiveBtn together before auto-exit row
    assert.equal(archRestartBtn.parentElement, restoreBtn.parentElement, 'Archive & Restart and Restore Archive must share action button group');
    assert.equal(archRestartBtn.parentElement, archiveBtn.parentElement, 'Generate Offline Script must be grouped in the same maintenance action row');
    const aboutBox = sec.querySelector('[data-ag-cs-about="1"]');
    const actionRow = archRestartBtn.closest('.ag-cs-about-repo-row');
    const autoExitRow = sec.querySelector('[data-ag-cs-auto-archive-exit="off"]').closest('.ag-cs-about-repo-row');
    const actionIdx = aboutBox.children.indexOf(actionRow);
    const autoExitIdx = aboutBox.children.indexOf(autoExitRow);
    assert.ok(actionIdx > -1 && autoExitIdx > -1 && actionIdx < autoExitIdx, 'Unified maintenance action row must appear directly under DB health and before auto-exit toggle');
  } finally {
    globalThis.document = prevDoc;
    globalThis.window = prevWin;
    globalThis.localStorage = prevStorage;
  }
});

test('wallpaper-client CSS spaces the 3 sliders cleanly (gap >= 18px) with tabular value badges', () => {
  const src = fs.readFileSync(path.join(ROOT, 'vendor', 'wallpaper', 'wallpaper-client.js'), 'utf8');
  assert.equal(src.includes('\r'), false, 'wallpaper-client.js must have 0 CRLF');
  assert.ok(src.includes('.ag-prism-wp-sliders{') && src.includes('gap:12px 18px;'), 'wallpaper sliders grid must provide 18px horizontal column gap');
  assert.ok(src.includes('.ag-prism-wp-slider-val{') && src.includes('border-radius:5px;') && src.includes('font-variant-numeric:tabular-nums;'), 'wallpaper slider values must render as tabular badges');
});

test('Channel 9 hot-reload self-heals stale settingsCodeHash and rebuilds mounted #ag-cs-settings-sec', async () => {
  // 1) buildSettingsChannelExpression removes stale #ag-cs-settings-sec on codeHash mismatch and remounts wallpaper/thought/suggester slots
  const ch9Expr = cdp.buildSettingsChannelExpression();
  const hashMatch = /const targetHash = "([^"]+)"/.exec(ch9Expr);
  assert.ok(hashMatch && hashMatch[1], 'Channel 9 expression must embed targetHash');
  const expectedHash = hashMatch[1];

  const { doc, panel } = createMiniDom();
  const staleSec = doc.createElement('div');
  staleSec.id = 'ag-cs-settings-sec';
  let mascotDisposed = false;
  let wpDestroyed = false;
  let sgDestroyed = false;
  staleSec.__agMascotStageApi = { dispose() { mascotDisposed = true; } };
  const wpSlot = doc.createElement('div');
  wpSlot.setAttribute('data-testid', 'prism-wallpaper-slot');
  wpSlot.__agPrismWpUiHandle = { destroy() { wpDestroyed = true; } };
  const sgSlot = doc.createElement('div');
  sgSlot.setAttribute('data-testid', 'prism-suggester-slot');
  sgSlot.__agPrismSgUiHandle = { destroy() { sgDestroyed = true; } };
  staleSec.appendChild(wpSlot);
  staleSec.appendChild(sgSlot);
  panel.appendChild(staleSec);

  let syncCalled = false;
  let remountedWp = false;
  let remountedThought = false;
  let remountedSg = false;

  const sandbox = {
    document: doc,
    window: null,
    globalThis: null,
    setTimeout,
    clearTimeout,
    console,
    Map,
    Set,
    WeakMap,
    WeakSet,
    JSON,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Math,
    Date,
    Promise,
    Error,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.top = sandbox;
  sandbox.__agPrismSettingsPanel = { __prismCodeHash: 'stale-old-hash-1286lph' };
  sandbox.__agCsLocales = { __isFullLocales: true };
  sandbox.__agPrism = {
    sync() {
      syncCalled = true;
      // Simulate Channel 1 rebuilding fresh #ag-cs-settings-sec after stale node was removed
      assert.equal(doc.getElementById('ag-cs-settings-sec'), null, 'stale #ag-cs-settings-sec must be removed before sync() rebuilds it');
      const freshSec = doc.createElement('div');
      freshSec.id = 'ag-cs-settings-sec';
      freshSec.__prismMountThoughtUi = () => { remountedThought = true; };
      freshSec.__prismMountWp = () => { remountedWp = true; };
      freshSec.__prismMountSg = () => { remountedSg = true; };
      panel.appendChild(freshSec);
    },
  };

  const res = vm.runInNewContext(ch9Expr, sandbox);
  assert.equal(res.ok, true);
  assert.equal(res.codeHash, expectedHash);
  assert.equal(res.reused, undefined, 'stale settingsCodeHash must not be reused');
  assert.equal(mascotDisposed, true, 'stale mascot stage must be disposed before removing #ag-cs-settings-sec');
  assert.equal(wpDestroyed, true, 'stale wallpaper UI handle must be destroyed');
  assert.equal(sgDestroyed, true, 'stale suggester UI handle must be destroyed');
  assert.equal(syncCalled, true, 'sync() must rebuild settings section with upgraded Channel 9 module');
  assert.equal(remountedThought, true);
  assert.equal(remountedWp, true, 'Channel 9 hot-reload must call #ag-cs-settings-sec.__prismMountWp()');
  assert.equal(remountedSg, true);

  // 2) PrismDaemon.verifyAndHeal keeps fresh sessions lazy, but self-heals stale settingsCodeHash even when dialog is closed
  const daemon = new PrismDaemon({
    rootDir: ROOT,
    enableStorageGuardTimer: false,
    enableAutoUpdateTimer: false,
    silent: true,
  });
  daemon.cdp = {
    ...cdp,
    PLUGIN_VERSION: cdp.PLUGIN_VERSION,
    readConfig: () => ({ ...cdp.DEFAULT_CONFIG, mascot: 'off', homeLayout: 'off', periodicModelPicker: 'off', telemetryModule: 'off', omniModule: 'off', sidebarStudio: 'off', hostLocalization: 'off', thoughtTranslate: 'off' }),
  };
  daemon.codeHash = 'ch1-same-hash';
  daemon.injectExpr = '(() => ({ status: "ok" }))()';

  const makeEntry = (probeResult) => {
    const delivered = [];
    const entry = {
      wsUrl: 'ws://127.0.0.1/page/1',
      pageId: 'p1',
      title: 'Antigravity',
      url: 'https://127.0.0.1:13605/c/1',
      sidebarHostVerified: true,
      inlineDiffSkipped: true,
      wallpaperSkipped: true,
      suggesterSkipped: true,
      session: {
        closed: false,
        evaluate: async () => probeResult,
        send: async (method, params) => {
          if (method === 'Runtime.evaluate' && params?.expression?.includes('__agPrismSettingsPanel')) {
            delivered.push(params.expression);
            return { result: { value: { ok: true, codeHash: expectedHash } } };
          }
          return { result: { value: null } };
        },
      },
    };
    return { entry, delivered };
  };

  // Case A: Fresh page (settings never opened) -> MUST stay lazy (0 Channel 9 delivery)
  const fresh = makeEntry({
    ready: true,
    isHostDom: true,
    prismAttr: cdp.PLUGIN_VERSION,
    hasPrism: true,
    hasRepoBridge: true,
    hasThoughtBridge: true,
    hasUsageBridge: true,
    hasLegacyCss: false,
    codeHash: 'ch1-same-hash',
    hasSettingsPanel: false,
    hasSettingsDialog: false,
    settingsCodeHash: '',
    needsSettingsChannel: false,
  });
  await daemon.verifyAndHealEntry(fresh.entry, true);
  assert.equal(fresh.delivered.length, 0, 'Fresh session without settings panel/dialog must NOT eagerly load Channel 9');

  // Case B: Previously opened settings (now closed), stale settingsCodeHash after daemon hot-reload -> MUST self-heal
  const staleClosed = makeEntry({
    ready: true,
    isHostDom: true,
    prismAttr: cdp.PLUGIN_VERSION,
    hasPrism: true,
    hasRepoBridge: true,
    hasThoughtBridge: true,
    hasUsageBridge: true,
    hasLegacyCss: false,
    codeHash: 'ch1-same-hash',
    hasSettingsPanel: true,
    hasSettingsDialog: false,
    settingsCodeHash: '1286lph',
    needsSettingsChannel: false,
  });
  await daemon.verifyAndHealEntry(staleClosed.entry, true);
  assert.equal(staleClosed.delivered.length, 1, 'Stale settingsCodeHash in memory must trigger Channel 9 self-heal even when settings dialog is closed');

  // Case C: Already up-to-date settingsCodeHash -> MUST NOT re-deliver
  const upToDate = makeEntry({
    ready: true,
    isHostDom: true,
    prismAttr: cdp.PLUGIN_VERSION,
    hasPrism: true,
    hasRepoBridge: true,
    hasThoughtBridge: true,
    hasUsageBridge: true,
    hasLegacyCss: false,
    codeHash: 'ch1-same-hash',
    hasSettingsPanel: true,
    hasSettingsDialog: true,
    settingsCodeHash: expectedHash,
    needsSettingsChannel: false,
  });
  await daemon.verifyAndHealEntry(upToDate.entry, true);
  assert.equal(upToDate.delivered.length, 0, 'Up-to-date settingsCodeHash must not trigger redundant Channel 9 delivery');

  await daemon.stop(false, { skipAutoArchive: true });
});
