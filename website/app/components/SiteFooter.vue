<script setup lang="ts">
import { siteLinks } from '~/data/landing';

const {
  app: { baseURL },
} = useRuntimeConfig();

const groups = [
  {
    title: 'Проект',
    links: [
      { label: 'GitHub', href: siteLinks.repository },
      { label: 'Релизы', href: siteLinks.releases },
      { label: 'Сообщить о проблеме', href: siteLinks.issues },
    ],
  },
  {
    title: 'Документация',
    links: [
      { label: 'README', href: siteLinks.readme },
      { label: 'Правила маршрутизации', href: siteLinks.routingDocs },
      { label: 'Сборка из исходников', href: siteLinks.buildDocs },
    ],
  },
];
</script>

<template>
  <footer class="border-t border-line">
    <div
      class="mx-auto grid max-w-6xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[minmax(0,1fr)_auto_auto] md:gap-16 lg:px-8"
    >
      <div>
        <div class="flex items-center gap-2.5">
          <img class="h-7 w-7" :src="`${baseURL}brand/logo.svg`" alt="" width="28" height="28" />
          <span class="text-[15px] font-semibold tracking-tight text-fg">UltimaVLESS</span>
        </div>
        <p class="mt-4 max-w-sm text-sm leading-6 text-fg3">
          Бесплатный VPN-клиент с открытым исходным кодом на ядре Xray-core для Windows, macOS,
          Linux и Android.
        </p>
        <p class="mt-4 text-xs text-fg3">
          <a class="hover:text-fg2" :href="siteLinks.license" rel="noopener" target="_blank">
            Лицензия MIT
          </a>
          · © 2024–2026 UltimaVPN
        </p>
      </div>

      <nav v-for="group in groups" :key="group.title" :aria-label="group.title">
        <h2 class="text-sm font-semibold text-fg">{{ group.title }}</h2>
        <ul class="mt-4 space-y-2.5">
          <li v-for="link in group.links" :key="link.href">
            <a
              class="text-sm text-fg2 transition-colors hover:text-fg"
              :href="link.href"
              rel="noopener"
              target="_blank"
            >
              {{ link.label }}
            </a>
          </li>
        </ul>
      </nav>
    </div>
  </footer>
</template>
