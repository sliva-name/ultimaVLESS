<template>
  <div class="relative mx-auto w-full max-w-xl lg:max-w-none" aria-label="Превью интерфейса UltimaVLESS">
    <div class="absolute -inset-4 rounded-[2rem] bg-cyan-400/10 blur-2xl sm:-inset-8 sm:rounded-[3rem] sm:blur-3xl" />
    <div
      class="relative overflow-hidden rounded-[1.5rem] border border-white/10 bg-slate-900/80 shadow-2xl shadow-cyan-950/60 backdrop-blur sm:rounded-[2rem]"
    >
      <div class="flex items-center gap-2 border-b border-white/10 bg-white/5 px-4 py-3 sm:px-5 sm:py-4">
        <span class="h-2.5 w-2.5 rounded-full bg-red-400/80 sm:h-3 sm:w-3" />
        <span class="h-2.5 w-2.5 rounded-full bg-amber-300/80 sm:h-3 sm:w-3" />
        <span class="h-2.5 w-2.5 rounded-full bg-emerald-400/80 sm:h-3 sm:w-3" />
      </div>

      <div class="grid gap-0 md:min-h-[24rem] md:grid-cols-[15rem_1fr]">
        <aside class="flex gap-3 overflow-x-auto border-b border-white/10 bg-slate-950/70 p-4 md:block md:space-y-3 md:overflow-visible md:border-b-0 md:border-r">
          <div class="min-w-44 rounded-2xl border border-emerald-400/40 bg-emerald-400/10 p-4 md:min-w-0">
            <strong class="block text-sm text-white">Mobile White List</strong>
            <small class="mt-1 block text-emerald-200">34 мс - VLESS</small>
          </div>
          <div class="min-w-44 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:min-w-0">
            <strong class="block text-sm text-white">Subscription</strong>
            <small class="mt-1 block text-slate-400">58 мс - Trojan</small>
          </div>
          <div class="min-w-44 rounded-2xl border border-white/10 bg-white/[0.03] p-4 md:min-w-0">
            <strong class="block text-sm text-white">Manual configs</strong>
            <small class="mt-1 block text-slate-400">ss://, vless://</small>
          </div>
        </aside>

        <div class="flex flex-col justify-center p-5 sm:p-8">
          <span
            class="mb-4 inline-flex w-fit rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.18em] text-emerald-200 sm:mb-5 sm:tracking-[0.2em]"
          >
            Защищено
          </span>
          <h2 class="text-xl font-bold tracking-tight text-white sm:text-3xl">
            Подключено к Mobile White List
          </h2>
          <p class="mt-4 max-w-sm text-sm leading-6 text-slate-300">
            Proxy/TUN, пинг, статистика сессии и автопереключение сервера при
            сбоях подключения.
          </p>
          <div class="mt-6 grid gap-3 text-sm min-[420px]:grid-cols-2 sm:mt-8">
            <div class="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <span class="block text-slate-400">Загружено</span>
              <strong class="mt-1 block text-xl text-white">128 МБ</strong>
            </div>
            <div class="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
              <span class="block text-slate-400">Отправлено</span>
              <strong class="mt-1 block text-xl text-white">24 МБ</strong>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
