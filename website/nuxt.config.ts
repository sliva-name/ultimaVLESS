import tailwindcss from '@tailwindcss/vite';

const siteUrl =
  process.env.NUXT_PUBLIC_SITE_URL ?? 'https://sliva-name.github.io/ultimaVLESS';
const sitePath = new URL(siteUrl).pathname;
const baseURL =
  process.env.NUXT_APP_BASE_URL ??
  (sitePath === '/' ? '/' : `${sitePath.replace(/\/$/, '')}/`);

export default defineNuxtConfig({
  compatibilityDate: '2026-06-14',
  devtools: { enabled: true },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
  },
  runtimeConfig: {
    public: {
      siteUrl,
    },
  },
  app: {
    baseURL,
    head: {
      htmlAttrs: {
        lang: 'ru',
      },
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1',
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: `${baseURL}brand/logo.svg` },
        { rel: 'apple-touch-icon', href: `${baseURL}brand/logo.svg` },
      ],
      meta: [
        { name: 'theme-color', content: '#020617' },
        { name: 'color-scheme', content: 'dark light' },
      ],
    },
  },
  nitro: {
    prerender: {
      routes: ['/', '/robots.txt', '/sitemap.xml'],
    },
  },
  routeRules: {
    '/': { prerender: true },
    '/robots.txt': { prerender: true },
    '/sitemap.xml': { prerender: true },
  },
});
