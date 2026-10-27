/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `android` in the mobile build (`mobile/vite.config.mts`); unset on desktop. */
  readonly VITE_TARGET?: 'android';
}

declare module '*.svg' {
  const content: string;
  export default content;
}
