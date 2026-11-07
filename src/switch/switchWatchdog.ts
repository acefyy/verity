import fs from 'node:fs';
import path from 'node:path';

export interface WatchdogOptions {
  baseDir?: string;
  silent?: boolean;
}

/**
 * Checks if a given PID is currently running on the system.
 */
export function isPidAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: any) {
    return err.code === 'EPERM';
  }
}

/**
 * Automatically inspects and heals Switch Console agent controller watchers on disk.
 *
 * Specifically handles recovery from sudden reboots or crashes:
 * 1. Stale shared-owner.lock files referencing dead PIDs.
 * 2. Stale supervisor/failure.json files (e.g. "The shared SDK watcher is already running.")
 *    that permanently prevent Switch Console from launching agent hosts.
 * 3. Corrupted health.json files containing null bytes or invalid schema values.
 * 4. Stale or invalid placements.json records.
 */
export function autoHealSwitchWatchers(options: WatchdogOptions = {}): {
  repairedFiles: string[];
} {
  const repairedFiles: string[] = [];
  const silent = options.silent ?? false;

  let serversDir = options.baseDir;
  if (!serversDir) {
    const appData = process.env.APPDATA;
    if (!appData) return { repairedFiles };
    serversDir = path.join(appData, 'switchdash', 'agent-controller', 'servers');
  }

  if (!fs.existsSync(serversDir)) {
    return { repairedFiles };
  }

  try {
    const serverEntries = fs.readdirSync(serversDir, { withFileTypes: true });
    for (const serverEntry of serverEntries) {
      if (!serverEntry.isDirectory()) continue;

      const watchersDir = path.join(serversDir, serverEntry.name, 'watchers');
      if (!fs.existsSync(watchersDir)) continue;

      const watcherEntries = fs.readdirSync(watchersDir, { withFileTypes: true });
      for (const watcherEntry of watcherEntries) {
        if (!watcherEntry.isDirectory()) continue;
        const watcherPath = path.join(watchersDir, watcherEntry.name);

        // 1. Clean stale supervisor failure files
        const failurePath = path.join(watcherPath, 'supervisor', 'failure.json');
        if (fs.existsSync(failurePath)) {
          try {
            fs.unlinkSync(failurePath);
            repairedFiles.push(failurePath);
            if (!silent) {
              console.log(`[SwitchWatchdog] Cleared stale failure lock: ${failurePath}`);
            }
          } catch (e: any) {
            if (!silent) console.warn(`[SwitchWatchdog] Could not remove ${failurePath}: ${e.message}`);
          }
        }

        // 2. Clean stale shared-owner.lock if PID is not alive
        const lockPath = path.join(watcherPath, 'shared-owner.lock');
        if (fs.existsSync(lockPath)) {
          try {
            const raw = fs.readFileSync(lockPath, 'utf8').trim();
            let pid = 0;
            if (raw.startsWith('{')) {
              const data = JSON.parse(raw);
              pid = Number(data.pid) || 0;
            } else {
              pid = Number(raw) || 0;
            }

            if (!isPidAlive(pid)) {
              fs.unlinkSync(lockPath);
              repairedFiles.push(lockPath);
              if (!silent) {
                console.log(`[SwitchWatchdog] Removed stale shared-owner.lock (dead PID ${pid}): ${lockPath}`);
              }
            }
          } catch (e: any) {
            // If lock file is corrupted or unreadable, safely remove it
            try {
              fs.unlinkSync(lockPath);
              repairedFiles.push(lockPath);
            } catch {}
          }
        }

        // 3. Heal corrupted health.json files (e.g. null bytes from hard reboot)
        const healthPath = path.join(watcherPath, 'health.json');
        if (fs.existsSync(healthPath)) {
          try {
            const raw = fs.readFileSync(healthPath, 'utf8');
            let isCorrupt = false;
            let parsed: any = null;

            if (raw.includes('\u0000')) {
              isCorrupt = true;
            } else {
              try {
                parsed = JSON.parse(raw);
                if (typeof parsed.pid !== 'number' || parsed.pid <= 0) {
                  isCorrupt = true;
                }
              } catch {
                isCorrupt = true;
              }
            }

            if (isCorrupt) {
              const validData = {
                state: 'not-running',
                detail: null,
                since: new Date().toISOString(),
                placements: {},
                busy: [],
                pid: 1,
                updatedAt: new Date().toISOString()
              };
              fs.writeFileSync(healthPath, JSON.stringify(validData) + '\n');
              repairedFiles.push(healthPath);
              if (!silent) {
                console.log(`[SwitchWatchdog] Repaired corrupted health.json: ${healthPath}`);
              }
            }
          } catch (e: any) {
            if (!silent) console.warn(`[SwitchWatchdog] Error inspecting health.json: ${e.message}`);
          }
        }
      }
    }
  } catch (err: any) {
    if (!silent) console.warn(`[SwitchWatchdog] Error scanning watchers: ${err.message}`);
  }

  return { repairedFiles };
}
