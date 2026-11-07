<script setup lang="ts">
import { Star } from '@lucide/vue';
import { siteLinks } from '~/data/landing';

const { stars } = useRelease();
</script>

<template>
  <section class="border-t border-line">
    <div class="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
      <div
        class="flex flex-col items-start gap-6 rounded-2xl border border-line bg-s1 p-6 sm:p-10 md:flex-row md:items-center md:justify-between"
      >
        <div class="flex gap-5">
          <span
            class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-warn-soft text-warn"
          >
            <Star class="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <h2 class="text-xl font-semibold tracking-tight text-balance text-fg sm:text-2xl">
              Пригодился UltimaVLESS? Поставьте звезду на GitHub
            </h2>
            <p class="mt-2 max-w-xl text-[15px] leading-6 text-pretty text-fg2">
              Звёзды поднимают проект в поиске GitHub — так клиент быстрее найдут те, кому он нужен.
              Это бесплатно и занимает пару секунд.
            </p>
          </div>
        </div>
        <a
          class="inline-flex h-11 shrink-0 items-center gap-2.5 rounded-xl border border-line2 bg-s2 px-5 text-sm font-semibold text-fg transition-colors hover:border-warn-line hover:bg-warn-soft"
          :href="siteLinks.repository"
          rel="noopener"
          target="_blank"
        >
          <GithubMark class="h-4 w-4" />
          Поставить звезду
          <span
            v-if="stars !== null"
            class="rounded-md bg-s3 px-1.5 py-0.5 font-mono text-xs text-fg2 tabular-nums"
          >
            {{ stars }}
          </span>
        </a>
      </div>
    </div>
  </section>
</template>
