<script setup lang="ts">
import { quickStartSteps } from '~/data/landing';
</script>

<template>
  <section class="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[0.8fr_1fr] lg:gap-10 lg:px-8">
    <div>
      <SectionHeading
        eyebrow="Быстрый старт"
        title="Подключение занимает несколько минут"
        description="Сценарий рассчитан на пользователя, который хочет быстро скачать VPN-клиент, получить рабочие бесплатные конфиги и уже потом разбираться с расширенными настройками."
      />
    </div>

    <ol class="space-y-3 sm:space-y-4">
      <li
        v-for="(step, index) in quickStartSteps"
        :key="step"
        class="flex gap-3 rounded-[1.35rem] border border-white/10 bg-slate-900/70 p-4 sm:gap-4 sm:rounded-[1.5rem] sm:p-5"
      >
        <span
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-cyan-300 text-sm font-black text-slate-950 sm:h-10 sm:w-10"
        >
          {{ index + 1 }}
        </span>
        <p class="pt-1.5 text-base leading-7 text-slate-200 sm:pt-2 sm:text-lg">{{ step }}</p>
      </li>
    </ol>
  </section>
</template>
