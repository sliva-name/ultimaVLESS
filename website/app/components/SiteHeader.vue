<script setup lang="ts">
defineProps<{
  downloadUrl: string;
}>();

const navItems = [
  { label: 'Возможности', href: '#features' },
  { label: 'Конфиги', href: '#free-configs' },
  { label: 'Скачать', href: '#download' },
];

const {
  app: { baseURL },
} = useRuntimeConfig();
const logoUrl = `${baseURL}brand/logo.svg`;
</script>

<template>
  <header
    class="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:flex-nowrap lg:px-8"
    aria-label="Главная навигация"
  >
    <NuxtLink class="group flex items-center gap-3" to="/" aria-label="UltimaVLESS">
      <img
        class="h-9 w-9 rounded-2xl shadow-lg shadow-emerald-500/20 transition-transform group-hover:scale-105 sm:h-10 sm:w-10"
        :src="logoUrl"
        alt=""
        width="40"
        height="40"
      />
      <span class="text-base font-semibold tracking-tight text-white sm:text-lg">
        UltimaVLESS
      </span>
    </NuxtLink>

    <nav
      class="order-3 -mx-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 pb-1 text-sm text-slate-300 sm:-mx-6 sm:w-[calc(100%+3rem)] sm:px-6 md:order-none md:mx-0 md:w-auto md:items-center md:gap-7 md:overflow-visible md:px-0 md:pb-0"
      aria-label="Разделы сайта"
    >
      <a
        v-for="item in navItems"
        :key="item.href"
        class="shrink-0 rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 transition-colors hover:text-white md:border-0 md:bg-transparent md:px-0 md:py-0"
        :href="item.href"
      >
        {{ item.label }}
      </a>
    </nav>

    <a
      class="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-4 py-2 text-sm font-semibold text-emerald-100 transition hover:border-emerald-300 hover:bg-emerald-400/20"
      :href="downloadUrl"
      rel="noopener"
      target="_blank"
    >
      Скачать
    </a>
  </header>
</template>
