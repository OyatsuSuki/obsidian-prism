import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const cdp = require(path.join(ROOT, 'cdp.js'));

test('buildWinWmiRelaunchCommand avoids nested -EncodedCommand and blocks metacharacter injection', () => {
  assert.equal(typeof cdp.buildWinWmiRelaunchCommand, 'function', 'cdp.js must export buildWinWmiRelaunchCommand');

  const cmd = cdp.buildWinWmiRelaunchCommand({
    helperScriptPath: 'C:\\Users\\Demo User\\.gemini\\config\\plugins\\obsidian-prism\\.relaunch-helper.ps1',
    taskFile: 'C:\\Users\\Demo User\\.gemini\\config\\plugins\\obsidian-prism\\.relaunch-task.json',
  });
  assert.ok(!/-EncodedCommand/i.test(cmd), 'WMI relaunch command must never pass -EncodedCommand under WmiPrvSE');
  assert.ok(/-File\s+"/i.test(cmd), 'WMI relaunch command must invoke static .ps1 helper via -File');
  assert.ok(/-TaskFile\s+"/i.test(cmd), 'WMI relaunch command must forward task file via -TaskFile');

  for (const bad of [
    'C:\\Users\\a;calc.exe\\h.ps1',
    'C:\\Users\\a$(whoami)\\h.ps1',
    'C:\\Users\\a"b\\h.ps1',
    'C:\\Users\\a`b\\h.ps1',
    'C:\\Users\\a&b\\h.ps1',
    'C:\\Users\\a|b\\h.ps1',
  ]) {
    assert.throws(
      () => cdp.buildWinWmiRelaunchCommand({ helperScriptPath: bad, taskFile: 'C:\\ok\\task.json' }),
      /Unsafe|Invalid/i,
      `Must reject unsafe helper path: ${bad}`
    );
    assert.throws(
      () => cdp.buildWinWmiRelaunchCommand({ helperScriptPath: 'C:\\ok\\h.ps1', taskFile: bad }),
      /Unsafe|Invalid/i,
      `Must reject unsafe task path: ${bad}`
    );
  }
});

test('spawnDetachedHostRelaunchHelper on win32 uses -File WMI breakaway (0 nested -EncodedCommand) and fallback without -EncodedCommand', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-cdp-relaunch-'));
  try {
    let capturedEnv = null;
    const wmiRes = cdp.spawnDetachedHostRelaunchHelper(
      { hostPid: 43210, exePath: 'C:\\Apps\\Antigravity\\Antigravity.exe' },
      {
        platformOverride: 'win32',
        privateStateDir: tmpDir,
        wmiExecSync: (_bin, _args, execOpts) => {
          capturedEnv = execOpts?.env || null;
          return '77889\n';
        },
      }
    );
    assert.equal(wmiRes.spawned, true);
    assert.equal(wmiRes.method, 'wmi-breakaway');
    assert.equal(wmiRes.pid, 77889);
    assert.ok(capturedEnv && typeof capturedEnv.AG_PRISM_WMI_CMD === 'string', 'Must pass AG_PRISM_WMI_CMD to WMI Create');
    assert.ok(!/-EncodedCommand/i.test(capturedEnv.AG_PRISM_WMI_CMD), 'AG_PRISM_WMI_CMD must never contain -EncodedCommand');
    assert.ok(capturedEnv.AG_PRISM_WMI_CMD.includes('.relaunch-helper.ps1'), 'WMI command must run .relaunch-helper.ps1');
    assert.ok(capturedEnv.AG_PRISM_WMI_CWD && path.isAbsolute(capturedEnv.AG_PRISM_WMI_CWD), 'Must set CurrentDirectory to absolute temp dir');

    const helperFile = path.join(tmpDir, '.relaunch-helper.ps1');
    const taskFile = path.join(tmpDir, '.relaunch-task.json');
    assert.ok(fs.existsSync(helperFile), '.relaunch-helper.ps1 must be written atomically');
    assert.ok(fs.existsSync(taskFile), '.relaunch-task.json must be written atomically');

    // Fallback path (disableWmiBreakaway: true) must also invoke -File with 0 -EncodedCommand
    let fallbackBin = '';
    let fallbackArgs = [];
    const fbRes = cdp.spawnDetachedHostRelaunchHelper(
      { hostPid: 43211, exePath: 'C:\\Apps\\Antigravity\\Antigravity.exe' },
      {
        platformOverride: 'win32',
        privateStateDir: tmpDir,
        disableWmiBreakaway: true,
        spawnFn: (bin, args) => {
          fallbackBin = bin;
          fallbackArgs = args;
          return { pid: 55123, unref() {} };
        },
      }
    );
    assert.equal(fbRes.spawned, true);
    assert.equal(fbRes.method, 'detached-spawn');
    assert.equal(fbRes.pid, 55123);
    assert.match(fallbackBin, /powershell\.exe$/i);
    assert.equal(fallbackArgs.some((a) => /-EncodedCommand/i.test(a)), false, 'Fallback detached-spawn must not use -EncodedCommand');
    assert.ok(fallbackArgs.includes('-File'), 'Fallback detached-spawn must invoke -File');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('WIN_DETACHED_RELAUNCH_PS handles Windows runInBackground=true tray trap with ReparsePoint guard, finally lossless restore, and valid PowerShell syntax', () => {
  assert.equal(typeof cdp.WIN_DETACHED_RELAUNCH_PS, 'string', 'cdp.js must export WIN_DETACHED_RELAUNCH_PS');
  const ps = cdp.WIN_DETACHED_RELAUNCH_PS;
  assert.ok(ps.includes('app_storage.json'), 'Relaunch helper must inspect Antigravity app_storage.json');
  assert.ok(ps.includes('runInBackground'), 'Relaunch helper must temporarily suspend runInBackground="true" during CloseMainWindow');
  assert.ok(ps.includes('ReparsePoint'), 'Relaunch helper must reject symlink/reparse point app_storage.json');
  assert.ok(/\btry\s*\{[\s\S]*\bfinally\s*\{/.test(ps), 'Relaunch helper must restore runInBackground inside a finally block');

  // Ensure restore runs BEFORE Start-Process relaunches Antigravity
  const finallyIdx = ps.indexOf('finally');
  const startProcIdx = ps.indexOf('Start-Process');
  assert.ok(finallyIdx > 0 && startProcIdx > finallyIdx, 'runInBackground restore in finally must complete before Start-Process relaunches host');

  if (process.platform === 'win32') {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ag-cdp-ps-parse-'));
    try {
      const psFile = path.join(tmpDir, 'check.ps1');
      fs.writeFileSync(psFile, ps, 'utf8');
      const parseCmd = [
        '$tokens = $null; $errs = $null',
        `[void][System.Management.Automation.Language.Parser]::ParseFile('${psFile.replace(/'/g, "''")}', [ref]$tokens, [ref]$errs)`,
        'if ($errs -and $errs.Count -gt 0) { $errs | ForEach-Object { $_.Message }; exit 1 }',
        'Write-Output "PARSE_OK"',
      ].join('; ');
      const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', parseCmd], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 10000,
      });
      assert.ok(out.includes('PARSE_OK'), `PowerShell parser check failed: ${out}`);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }
});
