import type { ConnectionMode, VlessConfig } from '@/shared/types';
import type { ProxyPorts } from './connectionStrategies';

/**
 * Input to a connection operation. Stage 1 carries server + mode + ports;
 * Xray config, network plan, and validation plan stay compiled downstream.
 */
export interface ConnectionSpec {
  server: VlessConfig;
  mode: ConnectionMode;
  ports: ProxyPorts;
}
