<script setup lang="ts">
import { startSteps } from '~/data/landing';

const {
  app: { baseURL },
} = useRuntimeConfig();
</script>

<template>
  <section id="start" class="border-t border-line bg-s1/40">
    <div
      class="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 sm:py-28 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16 lg:px-8"
    >
      <div>
        <SectionHeading
          eyebrow="Как начать"
          title="Своих серверов нет? Бесплатный список уже внутри"
          description="В клиент встроен импорт публичного «Мобильного белого списка»: одна кнопка — и можно подключаться. Подписки и ссылки своего провайдера добавите потом."
        />

        <ol class="mt-10 space-y-0">
          <li
            v-for="(step, index) in startSteps"
            :key="step.title"
            class="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-4 pb-8 last:pb-0"
          >
            <span
              v-if="index < startSteps.length - 1"
              class="absolute top-9 bottom-1 left-4 w-px -translate-x-1/2 bg-line"
              aria-hidden="true"
            />
            <span
              class="relative flex h-8 w-8 items-center justify-center rounded-full border border-acc-line bg-acc-soft font-mono text-sm font-semibold text-acc"
              aria-hidden="true"
            >
              {{ index + 1 }}
            </span>
            <div class="pt-0.5">
              <h3 class="text-base font-semibold text-fg">{{ step.title }}</h3>
              <p class="mt-1.5 text-[15px] leading-6 text-pretty text-fg2">{{ step.text }}</p>
            </div>
          </li>
        </ol>
      </div>

      <div class="overflow-hidden rounded-xl border border-line bg-shot shadow-frame sm:rounded-2xl">
        <img
          class="block aspect-[1800/1300] w-full object-cover object-top"
          :src="`${baseURL}screenshots/desktop-subscriptions.png`"
          alt="Раздел «Подписки и импорт»: подписка провайдера, Mobile White List и ручные ссылки"
          width="1800"
          height="1400"
          loading="lazy"
        />
      </div>
    </div>
  </section>
</template>
