<script setup lang="ts">
import { ChevronDown } from '@lucide/vue';
import { faq, siteLinks } from '~/data/landing';
</script>

<template>
  <section id="faq" class="border-t border-line">
    <div
      class="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16 lg:px-8"
    >
      <SectionHeading
        eyebrow="Вопросы"
        title="Частые вопросы"
        description="Не нашли ответ — загляните в README или задайте вопрос в issues на GitHub."
      >
        <div class="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
          <a class="text-acc hover:underline" :href="siteLinks.readme" rel="noopener" target="_blank">
            README
          </a>
          <a class="text-acc hover:underline" :href="siteLinks.issues" rel="noopener" target="_blank">
            Issues на GitHub
          </a>
        </div>
      </SectionHeading>

      <div class="divide-y divide-line border-y border-line">
        <details v-for="item in faq" :key="item.question" class="group">
          <summary
            class="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-base font-medium text-fg transition-colors hover:text-acc sm:text-[17px]"
          >
            {{ item.question }}
            <ChevronDown
              class="h-5 w-5 shrink-0 text-fg3 transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <p class="-mt-1 pb-5 text-[15px] leading-7 text-pretty text-fg2">{{ item.answer }}</p>
        </details>
      </div>
    </div>
  </section>
</template>
