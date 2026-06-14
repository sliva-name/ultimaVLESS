<script setup lang="ts">
defineProps<{
  repositoryUrl: string;
}>();
</script>

<template>
  <footer class="mx-auto flex max-w-7xl flex-col gap-4 border-t border-white/10 px-4 py-8 text-sm leading-6 text-slate-400 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
    <p class="max-w-xl">UltimaVLESS - бесплатный open-source VPN-клиент на базе Xray.</p>
    <a
      class="font-semibold text-slate-200 transition hover:text-emerald-300"
      :href="repositoryUrl"
      rel="noopener"
      target="_blank"
    >
      GitHub
    </a>
  </footer>
</template>
