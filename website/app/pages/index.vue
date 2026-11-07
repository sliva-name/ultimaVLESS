<script setup lang="ts">
useLandingSeo();
</script>

<template>
  <div class="isolate min-h-screen bg-canvas text-fg">
    <a
      class="sr-only z-50 rounded-lg bg-acc-fill px-4 py-2 text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      href="#content"
    >
      Перейти к содержимому
    </a>
    <SiteHeader />

    <main id="content">
      <HeroSection />
      <FeatureSection />
      <StartSection />
      <ScreensSection />
      <DownloadSection />
      <FaqSection />
      <StarSection />
    </main>

    <SiteFooter />
  </div>
</template>
