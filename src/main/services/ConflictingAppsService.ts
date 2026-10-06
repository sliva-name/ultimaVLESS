import { EventEmitter } from 'events';
import type {
  CloseConflictingAppResult,
  ConflictingAppProcess,
  ConflictingAppView,
  ConflictingAppsScan,
  TunConflictCheck,
} from '@/shared/views/tunEnvironment';
import { logger } from './LoggerService';
import {
  runProcessWithOutput,
  type CommandOutput,
} from './platform/commandRunner';
import {
  CONFLICTING_APPS,
  type ConflictingAppDefinition,
} from './conflictingApps/catalog';
import { getOwnedXrayPids } from './xray/ownedProcesses';

export interface RunningProcess {
  image: string;
  pid: number;
}

type CommandRunner = (
  command: string,
  args: string[],
) => Promise<CommandOutput>;

export interface ConflictingAppsServiceOptions {
  platform?: NodeJS.Platform;
  run?: CommandRunner;
  /** PIDs of the Xray processes UltimaVLESS itself spawned. */
  ownProcessIds?: () => number[];
  selfPid?: number;
  sleep?: (ms: number) => Promise<void>;
  catalog?: readonly ConflictingAppDefinition[];
}

const TASKLIST_TIMEOUT_MS = 8000;
const GRACEFUL_CLOSE_WAIT_MS = 1500;
const FORCED_CLOSE_WAIT_MS = 500;
const CLOSE_POLL_INTERVAL_MS = 250;

/**
 * Reads `tasklist /FO CSV /NH`: `"Image Name","PID","Session Name",...`.
 * Only the first two columns matter, and neither is localized.
 */
export function parseTasklistCsv(output: string): RunningProcess[] {
  const processes: RunningProcess[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*"((?:[^"]|"")*)","(\d+)"/.exec(line);
    if (!match) continue;
    const pid = Number(match[2]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    processes.push({ image: match[1].replace(/""/g, '"'), pid });
  }
  return processes;
}

/** Groups running processes by the catalog entry they belong to. */
export function matchConflictingApps(
  processes: readonly RunningProcess[],
  catalog: readonly ConflictingAppDefinition[],
  excludedPids: ReadonlySet<number>,
): ConflictingAppView[] {
  const apps: ConflictingAppView[] = [];
  for (const definition of catalog) {
    const images = new Set(definition.images.map((name) => name.toLowerCase()));
    const services = new Set(
      (definition.services ?? []).map((name) => name.toLowerCase()),
    );
    const view: ConflictingAppView = {
      id: definition.id,
      name: definition.name,
      category: definition.category,
      processes: [],
      services: [],
    };
    for (const proc of processes) {
      if (excludedPids.has(proc.pid)) continue;
      const image = proc.image.toLowerCase();
      if (images.has(image)) {
        view.processes.push({ pid: proc.pid, image: proc.image });
      } else if (services.has(image)) {
        view.services.push({ pid: proc.pid, image: proc.image });
      }
    }
    if (view.processes.length > 0 || view.services.length > 0) {
      apps.push(view);
    }
  }
  return apps;
}

/**
 * Finds VPN clients, proxy clients, WinDivert DPI tools and stray proxy cores
 * that fight UltimaVLESS's TUN for routes and sockets, and closes them on the
 * user's request. Windows only: that is where the conflicts were reported and
 * where `tasklist`/`taskkill` give a cheap, locale-independent view.
 *
 * The check that accompanies a TUN connect lives here rather than in the
 * renderer: main sees every session phase change, while the renderer only
 * gets coalesced snapshots (a fast connect → failed collapses into one) and a
 * window opened by the elevated relaunch may first see `connected`. Results
 * reach the UI through {@link getTunCheck} in the app snapshot.
 *
 * Emits `tun-check-changed` whenever that state moves.
 */
export class ConflictingAppsService extends EventEmitter {
  private readonly platform: NodeJS.Platform;
  private readonly run: CommandRunner;
  private readonly ownProcessIds: () => number[];
  private readonly selfPid: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly catalog: readonly ConflictingAppDefinition[];
  private tunCheck: TunConflictCheck | null = null;
  private tunCheckCount = 0;
  /** Start order of scans; an older scan never overwrites a newer result. */
  private scanSeq = 0;
  private appliedScanSeq = 0;

  constructor(options: ConflictingAppsServiceOptions = {}) {
    super();
    this.platform = options.platform ?? process.platform;
    this.run =
      options.run ??
      ((command, args) =>
        runProcessWithOutput(command, args, {
          timeoutMs: TASKLIST_TIMEOUT_MS,
          windowsHide: true,
        }));
    this.ownProcessIds = options.ownProcessIds ?? getOwnedXrayPids;
    this.selfPid = options.selfPid ?? process.pid;
    this.sleep =
      options.sleep ??
      ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.catalog = options.catalog ?? CONFLICTING_APPS;
  }

  public getTunCheck(): TunConflictCheck | null {
    return this.tunCheck;
  }

  /**
   * Starts a fresh check for a TUN connect attempt (or its failure): forgets
   * what the previous attempt found and scans in the background, so the
   * connect itself is never delayed.
   */
  public startTunCheck(): void {
    if (this.platform !== 'win32') return;
    this.tunCheckCount += 1;
    this.tunCheck = { id: this.tunCheckCount, scan: null, resolved: false };
    this.emit('tun-check-changed');
    void this.scan().catch((error) => {
      logger.warn('ConflictingApps', 'TUN conflict scan failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /** Every scan — including the diagnostics tab's — refreshes the TUN check. */
  public async scan(): Promise<ConflictingAppsScan> {
    if (this.platform !== 'win32') {
      return { supported: false, apps: [] };
    }
    const seq = ++this.scanSeq;
    const processes = await this.listProcesses();
    const excluded = new Set<number>([this.selfPid, ...this.ownProcessIds()]);
    const apps = matchConflictingApps(processes, this.catalog, excluded);
    if (apps.length > 0) {
      logger.info('ConflictingApps', 'Found software that may break TUN', {
        apps: apps.map((app) => ({
          id: app.id,
          processes: app.processes.map((proc) => proc.image),
          services: app.services.map((proc) => proc.image),
        })),
      });
    }
    const result: ConflictingAppsScan = { supported: true, apps };
    if (this.tunCheck && seq > this.appliedScanSeq) {
      this.appliedScanSeq = seq;
      this.tunCheck = { ...this.tunCheck, scan: result };
      this.emit('tun-check-changed');
    }
    return result;
  }

  /**
   * Terminates the user-level processes of one catalog entry. PIDs come from a
   * fresh scan, never from the caller, so the renderer cannot aim this at an
   * arbitrary process. A polite `taskkill` goes first (lets a client restore
   * the proxy settings it changed); survivors are then killed with `/F`.
   */
  public async close(appId: string): Promise<CloseConflictingAppResult> {
    const definition = this.catalog.find((app) => app.id === appId);
    if (!definition) {
      throw new Error(`Unknown application: ${appId}`);
    }

    let scan = await this.scan();
    let remaining = this.closableProcesses(scan, appId);
    if (remaining.length === 0) {
      return { closed: true, remaining, scan };
    }

    logger.info('ConflictingApps', 'Closing application', {
      id: appId,
      processes: remaining.map((proc) => proc.image),
    });
    await this.taskkill(remaining, false);
    ({ scan, remaining } = await this.waitForExit(
      appId,
      GRACEFUL_CLOSE_WAIT_MS,
    ));

    if (remaining.length > 0) {
      await this.taskkill(remaining, true);
      ({ scan, remaining } = await this.waitForExit(
        appId,
        FORCED_CLOSE_WAIT_MS,
      ));
    }

    if (remaining.length > 0) {
      logger.warn('ConflictingApps', 'Application is still running', {
        id: appId,
        remaining,
      });
    } else if (this.tunCheck) {
      this.tunCheck = { ...this.tunCheck, resolved: true };
      this.emit('tun-check-changed');
    }
    return { closed: remaining.length === 0, remaining, scan };
  }

  private closableProcesses(
    scan: ConflictingAppsScan,
    appId: string,
  ): ConflictingAppProcess[] {
    return scan.apps.find((app) => app.id === appId)?.processes ?? [];
  }

  private async waitForExit(
    appId: string,
    timeoutMs: number,
  ): Promise<{
    scan: ConflictingAppsScan;
    remaining: ConflictingAppProcess[];
  }> {
    // Counted polls rather than a wall-clock deadline: each scan itself takes
    // a while, and the wait stays deterministic under a fake `sleep`.
    const polls = Math.max(1, Math.ceil(timeoutMs / CLOSE_POLL_INTERVAL_MS));
    let scan: ConflictingAppsScan = { supported: true, apps: [] };
    let remaining: ConflictingAppProcess[] = [];
    for (let poll = 0; poll < polls; poll += 1) {
      await this.sleep(CLOSE_POLL_INTERVAL_MS);
      scan = await this.scan();
      remaining = this.closableProcesses(scan, appId);
      if (remaining.length === 0) break;
    }
    return { scan, remaining };
  }

  private async taskkill(
    processes: ConflictingAppProcess[],
    force: boolean,
  ): Promise<void> {
    const args = [
      ...(force ? ['/F'] : []),
      '/T',
      ...processes.flatMap((proc) => ['/PID', String(proc.pid)]),
    ];
    try {
      // The exit code is not trusted: the follow-up scan decides.
      await this.run('taskkill', args);
    } catch (error) {
      logger.warn('ConflictingApps', 'taskkill failed', {
        force,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async listProcesses(): Promise<RunningProcess[]> {
    const output = await this.run('tasklist', ['/FO', 'CSV', '/NH']);
    return parseTasklistCsv(output.stdout);
  }
}

export const conflictingAppsService = new ConflictingAppsService();
