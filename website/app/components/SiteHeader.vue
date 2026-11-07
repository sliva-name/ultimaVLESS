<script setup lang="ts">
import { Star } from '@lucide/vue';
import { siteLinks } from '~/data/landing';

const navItems = [
  { label: 'Возможности', href: '#features' },
  { label: 'Как начать', href: '#start' },
  { label: 'Скриншоты', href: '#screens' },
  { label: 'Скачать', href: '#download' },
  { label: 'Вопросы', href: '#faq' },
];

const {
  app: { baseURL },
} = useRuntimeConfig();
const logoUrl = `${baseURL}brand/logo.svg`;

const { stars } = useRelease();
</script>

<template>
  <header class="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
    <div class="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4 sm:px-6 lg:px-8">
      <a class="flex shrink-0 items-center gap-2.5" href="#top" aria-label="UltimaVLESS — в начало">
        <img class="h-8 w-8" :src="logoUrl" alt="" width="32" height="32" />
        <span class="text-[15px] font-semibold tracking-tight text-fg">UltimaVLESS</span>
      </a>

      <nav class="hidden flex-1 items-center justify-center gap-1 lg:flex" aria-label="Разделы сайта">
        <a
          v-for="item in navItems"
          :key="item.href"
          class="rounded-md px-3 py-2 text-sm text-fg2 transition-colors hover:bg-s2 hover:text-fg"
          :href="item.href"
        >
          {{ item.label }}
        </a>
      </nav>

      <div class="ml-auto flex items-center gap-2 lg:ml-0">
        <a
          class="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-s1 px-3 text-sm font-medium text-fg2 transition-colors hover:border-line2 hover:text-fg"
          :href="siteLinks.repository"
          rel="noopener"
          target="_blank"
          :aria-label="stars === null ? 'UltimaVLESS на GitHub' : `UltimaVLESS на GitHub, звёзд: ${stars}`"
        >
          <GithubMark class="h-4 w-4" />
          <Star class="hidden h-3.5 w-3.5 sm:block" aria-hidden="true" />
          <span v-if="stars !== null" class="font-mono text-[13px] tabular-nums">{{ stars }}</span>
          <span v-else class="hidden sm:inline">GitHub</span>
        </a>
        <a
          class="inline-flex h-9 items-center rounded-lg bg-acc-fill px-4 text-sm font-semibold text-white transition-colors hover:bg-acc-fill-hover"
          href="#download"
        >
          Скачать
        </a>
      </div>
    </div>
  </header>
</template>
