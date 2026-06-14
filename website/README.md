# UltimaVLESS Website

Nuxt landing page for UltimaVLESS.

## Commands

```bash
npm --prefix website run dev
npm --prefix website run generate
npm --prefix website run preview
```

The root package also exposes shortcuts:

```bash
npm run site:dev
npm run site:generate
npm run site:preview
```

## SEO and Deployment

By default the site is prepared for GitHub Pages at:

```bash
https://sliva-name.github.io/ultimaVLESS
```

Override these values for a custom domain or another subpath:

```bash
NUXT_PUBLIC_SITE_URL=https://example.com
NUXT_APP_BASE_URL=/
```

Static output is generated into `website/.output/public`.
