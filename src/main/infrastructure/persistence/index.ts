export {
  configService,
  ConfigService,
} from '@/main/services/ConfigService';
export type { ServerRepository } from '@/main/domain/server/ServerRepository';
export {
  createServerRepository,
  getServerRepository,
} from '@/main/infrastructure/persistence/ElectronServerRepository';
export type { SubscriptionRepository } from '@/main/domain/subscription/SubscriptionRepository';
export {
  createSubscriptionRepository,
  getSubscriptionRepository,
} from '@/main/infrastructure/persistence/ElectronSubscriptionRepository';
export { getAppStore } from '@/main/infrastructure/persistence/appStore';
