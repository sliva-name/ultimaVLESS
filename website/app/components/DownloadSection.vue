<script setup lang="ts">
import { ArrowRight, Download, Laptop, Monitor, Smartphone, Terminal } from '@lucide/vue';
import { platforms, siteLinks, type PlatformId } from '~/data/landing';

const icons: Record<PlatformId, typeof Monitor> = {
  windows: Monitor,
  macos: Laptop,
  linux: Terminal,
  android: Smartphone,
};

const { release, platform, findAsset } = useRelease();

/**
 * The recommended file of the visitor's system gets the only filled button;
 * other recommended files are tinted. While the system is unknown, every
 * recommended file is filled.
 */
const variants = {
  filled: {
    link: 'border-transparent bg-acc-fill text-white hover:bg-acc-fill-hover',
    muted: 'text-white/75',
    icon: '',
  },
  tinted: {
    link: 'border-acc-line bg-acc-soft text-fg hover:border-acc',
    muted: 'text-fg3',
    icon: 'text-acc',
  },
  plain: {
    link: 'border-line bg-s2 text-fg hover:border-line2',
    muted: 'text-fg3',
    icon: 'text-fg3',
  },
};

const variant = (id: PlatformId, index: number) => {
  if (index > 0) return variants.plain;
  return !platform.value || platform.value.id === id ? variants.filled : variants.tinted;
};

const subtitle = computed(() =>
  release.value
    ? `Версия ${release.value.version} от ${formatDate(release.value.publishedAt)}. Файлы скачиваются с GitHub, контрольные суммы SHA256 лежат в том же релизе.`
    : 'Файлы скачиваются из последнего релиза на GitHub, контрольные суммы SHA256 лежат там же.',
);
</script>

<template>
  <section id="download" class="border-t border-line bg-s1/40">
    <div class="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <SectionHeading eyebrow="Скачать" title="Выберите свою систему" :description="subtitle" />

      <div class="mt-12 grid gap-4 md:grid-cols-2">
        <article
          v-for="item in platforms"
          :key="item.id"
          class="relative flex flex-col rounded-2xl border bg-s1 p-6"
          :class="platform?.id === item.id ? 'border-acc-line ring-1 ring-acc-line' : 'border-line'"
        >
          <span
            v-if="platform?.id === item.id"
            class="absolute top-5 right-5 rounded-full bg-acc-soft px-2.5 py-1 text-xs font-medium text-acc"
          >
            Ваша система
          </span>
          <span class="flex h-10 w-10 items-center justify-center rounded-xl bg-s3 text-fg">
            <component :is="icons[item.id]" class="h-5 w-5" aria-hidden="true" />
          </span>
          <h3 class="mt-5 text-lg font-semibold tracking-tight text-fg">{{ item.name }}</h3>
          <p class="mt-1 text-sm text-fg3">{{ item.requirement }}</p>

          <ul class="mt-6 flex flex-1 flex-col gap-2">
            <li v-for="(file, index) in item.files" :key="file.label">
              <a
                class="flex items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors"
                :class="variant(item.id, index).link"
                :href="findAsset(file)?.url ?? siteLinks.download"
                rel="noopener"
                :target="findAsset(file) ? undefined : '_blank'"
              >
                <span class="min-w-0 flex-1">
                  <span class="block text-sm font-semibold">{{ file.label }}</span>
                  <span class="block text-xs" :class="variant(item.id, index).muted">
                    {{ file.hint }}
                  </span>
                </span>
                <span
                  v-if="findAsset(file)"
                  class="shrink-0 font-mono text-xs tabular-nums"
                  :class="variant(item.id, index).muted"
                >
                  {{ formatSize(findAsset(file)!.size) }}
                </span>
                <Download
                  class="h-4 w-4 shrink-0"
                  :class="variant(item.id, index).icon"
                  aria-hidden="true"
                />
              </a>
            </li>
          </ul>
          <p v-if="item.note" class="mt-4 text-xs leading-5 text-fg3">{{ item.note }}</p>
        </article>
      </div>

      <a
        class="mt-8 inline-flex items-center gap-2 text-sm font-medium text-acc hover:underline"
        :href="siteLinks.releases"
        rel="noopener"
        target="_blank"
      >
        Все файлы и история версий на GitHub
        <ArrowRight class="h-4 w-4" aria-hidden="true" />
      </a>
    </div>
  </section>
</template>
