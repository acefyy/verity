import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { autoHealSwitchWatchers, isPidAlive } from '../src/switch/switchWatchdog.js';

describe('Switch Watchdog & Self-Healing Specifications', () => {
  let tempBaseDir: string;

  before(() => {
    tempBaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'switch-watchdog-test-'));
  });

  after(() => {
    try {
      fs.rmSync(tempBaseDir, { recursive: true, force: true });
    } catch {}
  });

  test('isPidAlive accurately detects process existence', () => {
    assert.equal(isPidAlive(process.pid), true);
    assert.equal(isPidAlive(0), false);
    assert.equal(isPidAlive(-1), false);
    assert.equal(isPidAlive(9999999), false);
  });

  test('autoHealSwitchWatchers removes stale failure.json and dead shared-owner.lock', () => {
    const serverDir = path.join(tempBaseDir, 'test-server', 'watchers', 'test-watcher-1');
    const supervisorDir = path.join(serverDir, 'supervisor');
    fs.mkdirSync(supervisorDir, { recursive: true });

    const failureFile = path.join(supervisorDir, 'failure.json');
    fs.writeFileSync(failureFile, JSON.stringify({ message: 'The shared SDK watcher is already running.' }));

    const deadLockFile = path.join(serverDir, 'shared-owner.lock');
    fs.writeFileSync(deadLockFile, JSON.stringify({ pid: 9999999, token: 'fake-token' }));

    const result = autoHealSwitchWatchers({ baseDir: tempBaseDir, silent: true });

    assert.equal(fs.existsSync(failureFile), false, 'failure.json should be removed');
    assert.equal(fs.existsSync(deadLockFile), false, 'stale lockfile with dead PID should be removed');
    assert.ok(result.repairedFiles.includes(failureFile));
    assert.ok(result.repairedFiles.includes(deadLockFile));
  });

  test('autoHealSwitchWatchers preserves shared-owner.lock with a live PID', () => {
    const serverDir = path.join(tempBaseDir, 'test-server', 'watchers', 'test-watcher-live');
    fs.mkdirSync(serverDir, { recursive: true });

    const liveLockFile = path.join(serverDir, 'shared-owner.lock');
    fs.writeFileSync(liveLockFile, JSON.stringify({ pid: process.pid, token: 'live-token' }));

    autoHealSwitchWatchers({ baseDir: tempBaseDir, silent: true });

    assert.equal(fs.existsSync(liveLockFile), true, 'live lockfile must be preserved');
  });

  test('autoHealSwitchWatchers repairs corrupted health.json containing null bytes or invalid PID', () => {
    const serverDir = path.join(tempBaseDir, 'test-server', 'watchers', 'test-watcher-corrupt');
    fs.mkdirSync(serverDir, { recursive: true });

    const healthFile = path.join(serverDir, 'health.json');
    // Write corrupted content containing null bytes
    fs.writeFileSync(healthFile, '\u0000\u0000\u0000corrupted');

    const result = autoHealSwitchWatchers({ baseDir: tempBaseDir, silent: true });

    assert.ok(result.repairedFiles.includes(healthFile));
    const repaired = JSON.parse(fs.readFileSync(healthFile, 'utf8'));
    assert.equal(repaired.state, 'not-running');
    assert.equal(typeof repaired.pid, 'number');
    assert.ok(repaired.pid > 0);
  });

  test('handles nonexistent directory gracefully without error', () => {
    const result = autoHealSwitchWatchers({ baseDir: path.join(tempBaseDir, 'nonexistent'), silent: true });
    assert.deepEqual(result.repairedFiles, []);
  });
});
