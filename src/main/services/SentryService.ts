import * as Sentry from '@sentry/electron/main';
import { app } from 'electron';
import { logger } from './LoggerService';
import { sanitizeDiagnosticPayload } from '../../shared/sanitizeDiagnostics';

let sentryInitialized = false;
const DEFAULT_ENVIRONMENT = process.env.NODE_ENV || (app.isPackaged ? 'production' : 'development');

function getReleaseName(): string {
  return `ultima-vless-client@${app.getVersion()}`;
}

export function initMainSentry(): boolean {
  if (sentryInitialized) {
    return true;
  }

  const dsn = process.env.SENTRY_DSN || process.env.VITE_SENTRY_DSN;
  if (!dsn) {
    logger.info('Sentry', 'Main Sentry init skipped: DSN is not configured');
    return false;
  }

  Sentry.init({
    dsn,
    enabled: true,
    environment: DEFAULT_ENVIRONMENT,
    release: getReleaseName(),
    initialScope: {
      tags: {
        process: 'main',
        platform: process.platform,
      },
    },
    beforeSend(event) {
      return sanitizeDiagnosticPayload(event);
    },
    beforeBreadcrumb(breadcrumb) {
      return sanitizeDiagnosticPayload(breadcrumb);
    },
  });

  sentryInitialized = true;
  logger.info('Sentry', 'Main Sentry initialized');
  return true;
}
