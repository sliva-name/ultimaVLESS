import * as Sentry from '@sentry/electron/renderer';
import { sanitizeDiagnosticPayload } from '../shared/sanitizeDiagnostics';

let sentryInitialized = false;

function getReleaseName(): string {
  return `ultima-vless-client@${import.meta.env.VITE_APP_VERSION}`;
}

export function initRendererSentry(): boolean {
  if (sentryInitialized) {
    return true;
  }

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    return false;
  }

  Sentry.init({
    dsn,
    enabled: true,
    environment: import.meta.env.MODE,
    release: getReleaseName(),
    initialScope: {
      tags: {
        process: 'renderer',
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
  return true;
}
