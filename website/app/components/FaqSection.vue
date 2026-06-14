<script setup lang="ts">
import { faq } from '~/data/landing';
</script>

<template>
  <section class="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
    <SectionHeading eyebrow="FAQ" title="Частые вопросы" />

    <div class="mt-8 space-y-3 sm:mt-10">
      <details
        v-for="item in faq"
        :key="item.question"
        class="group rounded-[1.25rem] border border-white/10 bg-white/[0.04] p-4 sm:rounded-[1.5rem] sm:p-5"
      >
        <summary class="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-bold text-white sm:text-lg">
          {{ item.question }}
          <span class="shrink-0 text-emerald-300 transition group-open:rotate-45">+</span>
        </summary>
        <p class="mt-4 max-w-3xl text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">
          {{ item.answer }}
        </p>
      </details>
    </div>
  </section>
</template>
