<script setup lang="ts">
import { screens } from '~/data/landing';

const {
  app: { baseURL },
} = useRuntimeConfig();

const activeId = ref(screens[0]!.id);
const active = computed(() => screens.find((screen) => screen.id === activeId.value)!);
const tabs = useTemplateRef<HTMLButtonElement[]>('tabs');

/** Arrow keys move between tabs, as in the WAI-ARIA tabs pattern. */
const onKeydown = (event: KeyboardEvent, index: number) => {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
  if (!step) return;
  event.preventDefault();
  const next = (index + step + screens.length) % screens.length;
  activeId.value = screens[next]!.id;
  tabs.value?.[next]?.focus();
};
</script>

<template>
  <section id="screens" class="border-t border-line">
    <div class="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28 lg:px-8">
      <SectionHeading
        center
        eyebrow="Скриншоты"
        title="Так выглядит UltimaVLESS"
        description="Тёмная и светлая тема, шесть языков интерфейса. Android-версия устроена так же, как настольная."
      />

      <div
        class="mx-auto mt-10 flex w-fit max-w-full flex-wrap justify-center gap-1 rounded-xl border border-line bg-s1 p-1"
        role="tablist"
        aria-label="Разделы приложения"
      >
        <button
          v-for="(screen, index) in screens"
          :id="`screen-tab-${screen.id}`"
          ref="tabs"
          :key="screen.id"
          type="button"
          role="tab"
          class="shrink-0 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors"
          :class="screen.id === activeId ? 'bg-s3 text-fg shadow-sm' : 'text-fg2 hover:text-fg'"
          :aria-selected="screen.id === activeId"
          :aria-controls="`screen-panel-${screen.id}`"
          :tabindex="screen.id === activeId ? 0 : -1"
          @click="activeId = screen.id"
          @keydown="onKeydown($event, index)"
        >
          {{ screen.label }}
        </button>
      </div>

      <div
        :id="`screen-panel-${active.id}`"
        class="mt-8"
        role="tabpanel"
        :aria-labelledby="`screen-tab-${active.id}`"
      >
        <div
          v-if="active.images.length > 1"
          class="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:justify-center sm:gap-6 sm:px-0"
        >
          <img
            v-for="image in active.images"
            :key="image.src"
            class="w-[62%] max-w-[260px] shrink-0 snap-center rounded-[1.2rem] border-[5px] border-s3 bg-shot shadow-phone sm:w-[30%] sm:rounded-[1.75rem]"
            :src="`${baseURL}screenshots/${image.src}`"
            :alt="image.alt"
            :width="image.width"
            :height="image.height"
            loading="lazy"
          />
        </div>
        <div
          v-else
          class="mx-auto max-w-5xl overflow-hidden rounded-xl border border-line bg-shot shadow-frame sm:rounded-2xl"
        >
          <img
            v-for="image in active.images"
            :key="image.src"
            class="block w-full"
            :src="`${baseURL}screenshots/${image.src}`"
            :alt="image.alt"
            :width="image.width"
            :height="image.height"
            loading="lazy"
          />
        </div>
      </div>
    </div>
  </section>
</template>
