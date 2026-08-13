import type { ConnectionMode, VlessConfig } from '@/shared/types';
import type { RuntimePorts } from '@/shared/constants';

/**
 * Input to a connection operation. Ports identify which Xray slot the
 * data plane should bind (primary vs staging).
 */
export interface ConnectionSpec {
  server: VlessConfig;
  mode: ConnectionMode;
  ports: RuntimePorts;
}
