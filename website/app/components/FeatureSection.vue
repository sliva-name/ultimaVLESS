<script setup lang="ts">
import { Activity, Gauge, Layers, Power, RefreshCw, Repeat, Route } from '@lucide/vue';
import { features, protocols } from '~/data/landing';

const icons = {
  latency: Gauge,
  modes: Power,
  routing: Route,
  failover: Repeat,
  updates: RefreshCw,
  diagnostics: Activity,
  protocols: Layers,
} as const;

const wide = new Set(['latency', 'protocols']);

/** Seven cards: on two columns «modes» takes a whole row so no cell stays empty. */
const span: Record<string, string> = {
  latency: 'md:col-span-2',
  modes: 'md:col-span-2 lg:col-span-1',
  protocols: 'md:col-span-2',
};

/** Same rows and latency tones as the server list in the app. */
const servers = [
  { name: 'Germany · Frankfurt', detail: 'VLESS · REALITY', ms: 38, tone: 1 },
  { name: 'Netherlands · Amsterdam', detail: 'VLESS · XHTTP', ms: 46, tone: 1 },
  { name: 'United States · New York', detail: 'VLESS · REALITY', ms: 117, tone: 2 },
  { name: 'Japan · Tokyo', detail: 'Shadowsocks', ms: 212, tone: 3 },
  { name: 'Turkey · Istanbul', detail: 'Не ответил при проверке', ms: null, tone: 0 },
];

const toneClass: Record<number, string> = {
  0: 'bg-s3 text-fg3',
  1: 'bg-lat1-soft text-lat1',
  2: 'bg-lat2-soft text-lat2',
  3: 'bg-lat3-soft text-lat3',
};
</script>

<template>
  <section id="features" class="border-t border-line">
    <div class="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <SectionHeading
        eyebrow="Возможности"
        title="Всё для подключения через Xray — без ручной настройки ядра"
        description="Подписки, проверка серверов, маршрутизация и тонкая настройка Xray — в одном окне на Windows, macOS, Linux и Android."
      />

      <div class="mt-12 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <article
          v-for="feature in features"
          :key="feature.id"
          class="flex flex-col rounded-2xl border border-line bg-s1 p-6 sm:p-7"
          :class="span[feature.id]"
        >
          <div
            :class="
              wide.has(feature.id) &&
              'lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-8 ' +
                (feature.id === 'latency' ? 'lg:items-start' : 'lg:items-center')
            "
          >
            <div>
              <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-acc-soft text-acc">
                <component :is="icons[feature.id as keyof typeof icons]" class="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 class="mt-5 text-lg font-semibold tracking-tight text-fg">{{ feature.title }}</h3>
              <p class="mt-2 text-[15px] leading-6 text-pretty text-fg2">{{ feature.text }}</p>
            </div>

            <ul
              v-if="feature.id === 'latency'"
              class="mt-6 divide-y divide-line overflow-hidden rounded-xl border border-line bg-s2 lg:mt-0"
              aria-label="Пример списка серверов с задержкой"
            >
              <li
                v-for="server in servers"
                :key="server.name"
                class="flex items-center justify-between gap-3 px-4 py-2.5"
              >
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium text-fg">{{ server.name }}</span>
                  <span class="block truncate text-xs text-fg3">{{ server.detail }}</span>
                </span>
                <span
                  class="shrink-0 rounded-md px-2 py-1 font-mono text-xs font-semibold tabular-nums"
                  :class="toneClass[server.tone]"
                >
                  {{ server.ms === null ? '—' : `${server.ms} мс` }}
                </span>
              </li>
            </ul>

            <ul
              v-else-if="feature.id === 'protocols'"
              class="mt-6 flex flex-wrap gap-2 lg:mt-0"
              aria-label="Протоколы и варианты VLESS"
            >
              <li
                v-for="protocol in protocols"
                :key="protocol"
                class="rounded-lg border border-line bg-s2 px-3 py-1.5 font-mono text-[13px] text-fg2"
              >
                {{ protocol }}
              </li>
            </ul>
          </div>

          <div v-if="feature.id === 'modes'" class="mt-auto pt-6" aria-hidden="true">
            <div class="flex rounded-xl border border-line bg-s2 p-1 text-sm">
              <span class="flex-1 rounded-lg py-1.5 text-center text-fg2">Прокси</span>
              <span class="flex-1 rounded-lg bg-s3 py-1.5 text-center font-medium text-fg shadow-sm">TUN</span>
            </div>
            <p class="mt-2.5 text-center text-xs text-fg3">На Android: VPN или «Только прокси»</p>
          </div>
        </article>
      </div>
    </div>
  </section>
</template>
