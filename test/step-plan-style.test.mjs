import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cdp = require('../cdp.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('step-plan checklist card and all item states share Obsidian Prism jewel styling across light and dark themes', () => {
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const lightBlockIdx = css.indexOf('html[data-ag-cs-style][data-ag-cs-theme="light"]');
  assert.ok(lightBlockIdx > 0, 'style.css must contain light-theme override block');

  const baseSection = css.slice(0, lightBlockIdx);
  const lightSection = css.slice(lightBlockIdx);

  const itemLine = css.split('\n').find((l) => l.includes('[data-testid="step-plan-item"]{')) || '';

  // Base surface + chip + all 5 item states (in_progress paused svg, done, pending, failed, skipped)
  assert.ok(baseSection.includes('& [data-testid="step-plan"]{'), 'must style step-plan card');
  assert.ok(itemLine.length > 0, 'must style step-plan-item');
  assert.ok(baseSection.includes('& [data-testid="step-plan-chip"]{'), 'must style step-plan-chip');
  assert.ok(itemLine.includes('&[data-status="in_progress"]{--_sc:var(--warning);') && itemLine.includes('&>svg{'), 'must differentiate paused in_progress svg with static amber ring');
  assert.ok(itemLine.includes('&[data-status="done"]{'), 'must style done state');
  assert.ok(itemLine.includes('&[data-status="pending"]{'), 'must style pending state');
  assert.ok(itemLine.includes('&[data-status="failed"]{'), 'must style failed state');
  assert.ok(itemLine.includes('&[data-status="skipped"]{'), 'must style skipped state');
  assert.equal(itemLine.includes('opacity:'), false, 'step-plan-item text must not stack low opacity over --muted-foreground');

  // State transition keyframe, reduced-motion (--_sa:none), and Windows High Contrast fallback
  const kfLine = css.split('\n').find((l) => l.includes('@keyframes ag-sp-in{')) || '';
  assert.ok(kfLine.length > 0, 'must define restrained ag-sp-in transition keyframe');
  assert.equal(kfLine.includes('scale(1.08)'), false, 'step-plan transition must use restrained ease-out deceleration without bounce overshoot');
  assert.ok(baseSection.includes('@media (forced-colors:active){[data-testid="step-plan-item"]>:first-child{&>svg{display:block !important;}'), 'forced-colors must restore native SVG icons');
  assert.ok(baseSection.includes('--ag-spring-sidebar:linear;--_sa:none;'), 'motion="off" must disable step-plan state animations via --_sa:none');
  assert.ok(baseSection.includes('@media (prefers-reduced-motion:reduce){html[data-ag-cs-style]{--_sa:none;}'), 'prefers-reduced-motion must disable step-plan state animations via --_sa:none');

  // Light theme polarity token (surface/border/semantic tokens auto-adapt across all 4 palettes)
  assert.ok(baseSection.includes('--ag-cs-run-core:#FFFFFF;--_si:#000;'), 'light theme must flip inner glyph tint polarity via --_si:#000');

  // CSS hygiene & full DEFAULT_CONFIG Channel 1 budget gate
  assert.equal(/:has\(/.test(css), false, 'style.css must have 0 :has() selectors');
  assert.equal(/[^\x00-\x7F]/.test(css), false, 'style.css must remain pure ASCII');
  const minified = cdp.minifyCss(css);
  assert.ok(minified.includes('[data-testid="step-plan"]'), 'minified CSS must retain step-plan rules');
  assert.ok(minified.includes('[data-testid="step-plan-item"]'), 'minified CSS must retain step-plan-item rules');
  const ch1Bytes = Buffer.byteLength(cdp.buildInjectExpression(cdp.DEFAULT_CONFIG), 'utf8');
  assert.ok(ch1Bytes < 685000, `Channel 1 DEFAULT_CONFIG bundle (${ch1Bytes} B) must stay < 685,000 B`);
});
