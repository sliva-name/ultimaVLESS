<script setup lang="ts">
defineProps<{
  downloadUrl: string;
}>();

const trustItems = ['Open source', 'Windows Setup и Portable', 'VLESS Reality/Vision'];
</script>

<template>
  <section class="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-14 pt-10 sm:px-6 sm:pb-20 sm:pt-14 lg:grid-cols-[minmax(0,1fr)_minmax(26rem,0.95fr)] lg:gap-12 lg:px-8 lg:pb-28 lg:pt-20">
    <div class="min-w-0">
      <p class="max-w-[19rem] text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300 sm:max-w-none sm:text-sm sm:tracking-[0.28em]">
        Бесплатный Xray/VLESS VPN-клиент
      </p>
      <h1 class="mt-4 max-w-4xl text-4xl font-black tracking-tight text-white sm:mt-5 sm:text-6xl lg:text-7xl">
        UltimaVLESS с готовыми бесплатными конфигами внутри
      </h1>
      <p class="mt-5 max-w-2xl text-base leading-7 text-slate-300 sm:mt-6 sm:text-xl sm:leading-8">
        Скачайте настольный VPN-клиент для Windows, macOS и Linux. Он умеет
        импортировать подписки, работать через системный прокси или TUN и сразу
        предлагает бесплатный список конфигов для быстрого старта.
      </p>

      <div class="mt-8 flex flex-col gap-3 sm:mt-9 sm:flex-row">
        <a
          class="inline-flex w-full items-center justify-center rounded-full bg-emerald-400 px-5 py-3 text-center text-base font-bold text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-300 sm:w-auto sm:px-6"
          :href="downloadUrl"
          rel="noopener"
          target="_blank"
        >
          Скачать последнюю версию
        </a>
        <a
          class="inline-flex w-full items-center justify-center rounded-full border border-white/15 bg-white/5 px-5 py-3 text-center text-base font-bold text-white transition hover:border-cyan-300/60 hover:bg-cyan-300/10 sm:w-auto sm:px-6"
          href="#free-configs"
        >
          Как получить конфиги
        </a>
      </div>

      <ul class="mt-7 flex flex-wrap gap-2 text-sm text-slate-300 sm:mt-8 sm:gap-3" aria-label="Ключевые преимущества">
        <li
          v-for="item in trustItems"
          :key="item"
          class="rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 sm:px-4"
        >
          {{ item }}
        </li>
      </ul>
    </div>

    <AppPreview />
  </section>
</template>
