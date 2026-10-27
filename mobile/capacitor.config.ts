import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  // Same id as the desktop build (`build.appId`).
  appId: 'com.ultima.vless',
  appName: 'UltimaVLESS',
  webDir: 'dist',
  android: {
    // The WebView only ever loads the bundled UI; subscription and update
    // requests go through the native plugin, not the WebView's network stack.
    allowMixedContent: false,
    captureInput: true,
  },
  plugins: {
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
      style: 'DARK',
    },
  },
};

export default config;
