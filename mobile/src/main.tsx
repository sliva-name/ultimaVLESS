import './polyfills';
import { bootBackend } from './backend/boot';

function showFatalError(error: unknown): void {
  console.error('UltimaVLESS failed to start', error);
  const root = document.getElementById('root');
  if (!root) return;
  const message = error instanceof Error ? error.message : String(error);
  root.innerHTML = '';
  const box = document.createElement('pre');
  box.style.cssText =
    'margin:0;padding:48px 20px;color:#fca5a5;font:13px/1.5 monospace;white-space:pre-wrap;';
  box.textContent = `UltimaVLESS failed to start\n\n${message}`;
  root.appendChild(box);
}

/**
 * The backend comes first: the renderer's modules read `window.electronAPI`
 * as soon as they load.
 */
async function start(): Promise<void> {
  const backend = await bootBackend();
  const { renderApp } = await import('./ui/renderApp');
  renderApp();
  backend.startDeferredWork();
}

start().catch(showFatalError);
