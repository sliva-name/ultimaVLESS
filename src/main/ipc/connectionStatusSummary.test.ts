import { describe, expect, it } from 'vitest';
import { buildConnectionMonitorStatusSummary } from './connectionStatusSummary';
import { makeMonitorStatus } from '@/test/factories';

describe('buildConnectionMonitorStatusSummary', () => {
  it('merges connection, xray, and recovery state into the IPC summary', () => {
    const summary = buildConnectionMonitorStatusSummary(
      makeMonitorStatus({
        isConnected: true,
        lastHealthCheckAt: 123,
      }),
      false,
      {
        state: 'failed',
        ready: false,
        xrayRunning: false,
        lastStartAt: 100,
        lastReadyAt: 110,
        lastReadinessCheckAt: 119,
        localProxyReachable: false,
        lastFailureAt: 120,
        lastFailureReason: 'startup failed',
        lastReadinessError: 'local proxy listeners are not reachable',
      },
      {
        recoveryInProgress: true,
        recoveryAttemptCount: 2,
        recoveryBlocked: false,
        lastRecoveryAt: 121,
        lastRecoveryTrigger: 'render-process-gone',
        lastRecoveryOutcome: 'recreated',
        lastRecoveryReason: 'render-process-gone:killed:1',
        lastFatalReason: null,
      },
    );

    expect(summary).toMatchObject({
      isConnected: true,
      autoSwitchingEnabled: false,
      lastHealthCheckAt: 123,
      lastHealthState: 'idle',
      localProxyReachable: null,
      xrayState: 'failed',
      xrayReady: false,
      xrayRunning: false,
      xrayLastStartAt: 100,
      xrayLastReadyAt: 110,
      xrayLastReadinessCheckAt: 119,
      xrayLocalProxyReachable: false,
      xrayLastFailureAt: 120,
      xrayLastFailureReason: 'startup failed',
      xrayLastReadinessError: 'local proxy listeners are not reachable',
      recoveryInProgress: true,
      recoveryAttemptCount: 2,
      recoveryBlocked: false,
      lastRecoveryAt: 121,
      lastRecoveryTrigger: 'render-process-gone',
      lastRecoveryOutcome: 'recreated',
      lastRecoveryReason: 'render-process-gone:killed:1',
    });
  });
});
