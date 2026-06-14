<script setup lang="ts">
import { siteLinks } from '~/data/landing';

useLandingSeo();
</script>

<template>
  <div class="isolate min-h-screen overflow-hidden bg-slate-950 text-white">
    <div
      class="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.16),transparent_22rem),radial-gradient(circle_at_top_right,rgba(6,182,212,0.14),transparent_24rem)] sm:bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.18),transparent_32rem),radial-gradient(circle_at_top_right,rgba(6,182,212,0.16),transparent_28rem)]"
    />

    <SiteHeader :download-url="siteLinks.download" />

    <main>
      <HeroSection :download-url="siteLinks.download" />
      <FreeConfigsSection />
      <FeatureSection />
      <QuickStartSection />
      <DownloadSection :download-url="siteLinks.download" />
      <FaqSection />
    </main>

    <SiteFooter :repository-url="siteLinks.repository" />
  </div>
</template>
