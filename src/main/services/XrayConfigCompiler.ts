import {
  ConnectionMode,
  DEFAULT_PERFORMANCE_SETTINGS,
  PerformanceSettings,
  VlessConfig,
} from '@/shared/types';
import { XrayConfig } from '@/shared/xray-types';
import { XrayConfigPipeline } from './XrayConfigPipeline';

export interface XrayRuntimeContext {
  logPath: string;
  connectionMode: ConnectionMode;
  sendThrough?: string;
  tunAutoRoute?: boolean;
  performanceSettings?: PerformanceSettings;
}

export class XrayConfigCompiler {
  public static compile(
    profile: VlessConfig,
    runtime: XrayRuntimeContext,
  ): XrayConfig {
    const context = this.withDefaults(runtime);
    const baseConfig = this.createBaseConfig(profile, context);
    return this.validateXrayConfig(baseConfig);
  }

  private static withDefaults(runtime: XrayRuntimeContext): XrayRuntimeContext {
    return {
      ...runtime,
      performanceSettings:
        runtime.performanceSettings ?? DEFAULT_PERFORMANCE_SETTINGS,
    };
  }

  private static createBaseConfig(
    profile: VlessConfig,
    runtime: XrayRuntimeContext,
  ): XrayConfig {
    return XrayConfigPipeline.generate(
      profile,
      runtime.logPath,
      runtime.connectionMode,
      {
        sendThrough: runtime.sendThrough,
        tunAutoRoute: runtime.tunAutoRoute,
        performanceSettings: runtime.performanceSettings,
      },
    );
  }

  private static validateXrayConfig(config: XrayConfig): XrayConfig {
    if (!Array.isArray(config.inbounds)) {
      throw new Error('Compiled Xray config must include inbounds');
    }
    if (!Array.isArray(config.outbounds) || config.outbounds.length === 0) {
      throw new Error('Compiled Xray config must include outbounds');
    }
    return config;
  }
}
