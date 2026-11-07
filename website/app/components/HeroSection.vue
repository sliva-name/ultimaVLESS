<script setup lang="ts">
import { ArrowRight, Check, Download } from '@lucide/vue';
import { heroHighlights, siteLinks } from '~/data/landing';

const { release, platform, findAsset } = useRelease();

/** Before hydration (and on iOS or unknown systems) the button leads to the platform list. */
const primary = computed(() => {
  if (!platform.value) {
    return { href: '#download', label: 'Скачать бесплатно', external: false };
  }
  const file = platform.value.files[0]!;
  const asset = findAsset(file);
  return {
    href: asset?.url ?? siteLinks.download,
    label: `Скачать для ${platform.value.name}`,
    external: !asset,
  };
});

const caption = computed(() => {
  if (!platform.value) return 'Windows · macOS · Linux · Android';
  const file = platform.value.files[0]!;
  const asset = findAsset(file);
  if (!release.value || !asset) return `${file.label} · последняя версия на GitHub`;
  return `${file.label} · ${formatSize(asset.size)} · версия ${release.value.version}`;
});
</script>

<template>
  <section
    id="top"
    class="relative overflow-hidden bg-[radial-gradient(70%_55%_at_50%_0%,var(--color-acc-soft),transparent)]"
  >
    <div class="mx-auto max-w-6xl px-4 pt-14 pb-20 sm:px-6 sm:pt-20 sm:pb-28 lg:px-8">
      <div class="mx-auto max-w-4xl text-center">
        <ul
          class="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[13px] font-medium text-fg2"
          aria-label="Коротко о клиенте"
        >
          <li v-for="item in heroHighlights" :key="item" class="flex items-center gap-1.5">
            <Check class="h-4 w-4 text-ok" aria-hidden="true" />
            {{ item }}
          </li>
        </ul>

        <h1
          class="mt-7 text-4xl leading-[1.08] font-semibold tracking-[-0.035em] text-balance text-fg sm:text-6xl"
        >
          Бесплатный <span class="whitespace-nowrap">VPN-клиент</span> на&nbsp;Xray с&nbsp;конфигами внутри
        </h1>
        <p class="mx-auto mt-6 max-w-2xl text-base leading-7 text-pretty text-fg2 sm:text-lg sm:leading-8">
          UltimaVLESS принимает подписки и ссылки vless://, trojan://, ss://, hy2://, честно
          проверяет серверы и работает через прокси или TUN. Своих серверов нет — импортируйте
          бесплатный список прямо в приложении.
        </p>

        <div class="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            class="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-acc-fill px-6 text-base font-semibold text-white transition-colors hover:bg-acc-fill-hover sm:w-auto"
            :href="primary.href"
            :rel="primary.external ? 'noopener' : undefined"
            :target="primary.external ? '_blank' : undefined"
          >
            <Download class="h-5 w-5" aria-hidden="true" />
            {{ primary.label }}
          </a>
          <a
            v-if="platform"
            class="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-line bg-s1 px-6 text-base font-medium text-fg transition-colors hover:border-line2 hover:bg-s2 sm:w-auto"
            href="#download"
          >
            Все платформы
            <ArrowRight class="h-4 w-4 text-fg3" aria-hidden="true" />
          </a>
          <a
            v-else
            class="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-line bg-s1 px-6 text-base font-medium text-fg transition-colors hover:border-line2 hover:bg-s2 sm:w-auto"
            :href="siteLinks.repository"
            rel="noopener"
            target="_blank"
          >
            <GithubMark class="h-4 w-4" />
            Исходный код
          </a>
        </div>
        <p class="mt-4 text-[13px] text-fg3">{{ caption }}</p>
      </div>

      <ProductShowcase class="mt-14 sm:mt-20" />
    </div>
  </section>
</template>
