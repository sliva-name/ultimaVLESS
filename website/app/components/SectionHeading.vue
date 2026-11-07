<script setup lang="ts">
withDefaults(
  defineProps<{
    eyebrow: string;
    title: string;
    description?: string;
    center?: boolean;
  }>(),
  { description: undefined, center: false },
);
</script>

<template>
  <div class="max-w-2xl" :class="center && 'mx-auto text-center'">
    <p class="text-sm font-medium text-acc">{{ eyebrow }}</p>
    <h2 class="mt-3 text-3xl font-semibold tracking-[-0.02em] text-balance text-fg sm:text-4xl">
      {{ title }}
    </h2>
    <p v-if="description" class="mt-4 text-base leading-7 text-pretty text-fg2 sm:text-lg sm:leading-8">
      {{ description }}
    </p>
    <slot />
  </div>
</template>
