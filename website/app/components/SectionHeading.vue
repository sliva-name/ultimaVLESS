<script setup lang="ts">
defineProps<{
  eyebrow: string;
  title: string;
  description?: string;
}>();
</script>

<template>
  <div class="max-w-3xl">
    <p class="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300 sm:text-sm sm:tracking-[0.28em]">
      {{ eyebrow }}
    </p>
    <h2 class="mt-3 text-2xl font-bold tracking-tight text-white sm:mt-4 sm:text-4xl">
      {{ title }}
    </h2>
    <p v-if="description" class="mt-4 text-base leading-7 text-slate-300 sm:text-lg sm:leading-8">
      {{ description }}
    </p>
  </div>
</template>
