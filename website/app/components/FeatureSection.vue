<script setup lang="ts">
import { features } from '~/data/landing';
</script>

<template>
  <section id="features" class="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
    <SectionHeading
      eyebrow="Возможности"
      title="Все, что нужно для удобного VLESS/Xray подключения"
      description="UltimaVLESS закрывает базовый сценарий скачивания, импорта конфигов и подключения, но оставляет продвинутые настройки для пользователей, которым нужен больший контроль."
    />

    <div class="mt-8 grid gap-3 sm:mt-10 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
      <article
        v-for="feature in features"
        :key="feature.title"
        class="rounded-[1.35rem] border border-white/10 bg-white/[0.04] p-5 transition hover:-translate-y-1 hover:border-emerald-300/40 hover:bg-white/[0.06] sm:rounded-[1.75rem] sm:p-6"
      >
        <span class="text-sm font-semibold text-emerald-300">
          {{ feature.label }}
        </span>
        <h3 class="mt-3 text-lg font-bold text-white sm:mt-4 sm:text-xl">{{ feature.title }}</h3>
        <p class="mt-3 text-sm leading-6 text-slate-300 sm:text-base sm:leading-7">{{ feature.text }}</p>
      </article>
    </div>
  </section>
</template>
