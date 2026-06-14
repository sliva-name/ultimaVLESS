<script setup lang="ts">
import { downloads } from '~/data/landing';

defineProps<{
  downloadUrl: string;
}>();
</script>

<template>
  <section id="download" class="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
    <div
      class="rounded-[1.5rem] border border-cyan-300/20 bg-cyan-300/[0.05] p-5 sm:rounded-[2rem] sm:p-10"
    >
      <SectionHeading
        eyebrow="Скачать UltimaVLESS"
        title="Выберите сборку для своей системы"
        description="Все актуальные файлы лежат в последнем релизе GitHub. Для Windows доступны установщик и portable-версия."
      />

      <div class="mt-8 grid gap-3 sm:mt-10 sm:gap-4 md:grid-cols-3">
        <article
          v-for="item in downloads"
          :key="item.os"
          class="rounded-[1.25rem] border border-white/10 bg-slate-950/50 p-5 sm:rounded-[1.5rem] sm:p-6"
        >
          <span class="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200 sm:text-sm sm:tracking-[0.22em]">
            {{ item.os }}
          </span>
          <h3 class="mt-3 text-lg font-bold text-white sm:mt-4 sm:text-xl">{{ item.title }}</h3>
          <p class="mt-3 text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">{{ item.text }}</p>
        </article>
      </div>

      <a
        class="mt-8 inline-flex w-full items-center justify-center rounded-full bg-emerald-400 px-5 py-3 text-center text-base font-bold text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-300 sm:mt-10 sm:w-auto sm:px-6"
        :href="downloadUrl"
        rel="noopener"
        target="_blank"
      >
        Открыть страницу скачивания
      </a>
    </div>
  </section>
</template>
