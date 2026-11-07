<script setup lang="ts">
const {
  app: { baseURL },
} = useRuntimeConfig();
const shot = (name: string) => `${baseURL}screenshots/${name}`;
</script>

<template>
  <!--
    The phone stands to the right of the window and covers only the window's
    right edge, never the connection ring (it ends at ~85% of the shot width).
  -->
  <div class="relative mx-auto max-w-5xl pt-6 pb-6 sm:pt-0 sm:pb-12">
    <div
      class="w-[80%] overflow-hidden rounded-xl border border-line bg-shot shadow-frame sm:w-[88%] sm:rounded-2xl"
    >
      <picture>
        <source :srcset="shot('desktop-home-light.png')" media="(prefers-color-scheme: light)" />
        <img
          class="block aspect-[1800/1240] w-full object-cover object-top"
          :src="shot('desktop-home.png')"
          alt="UltimaVLESS на компьютере: список серверов с задержкой, кольцо подключения и статистика сессии"
          width="1800"
          height="1400"
          fetchpriority="high"
        />
      </picture>
    </div>

    <div
      class="absolute right-0 bottom-0 w-[30%] max-w-[232px] overflow-hidden sm:w-[24%] rounded-[0.9rem] border-[3px] border-s3 bg-shot shadow-phone sm:rounded-[1.9rem] sm:border-[6px]"
    >
      <img
        class="block w-full"
        :src="shot('android-home.png')"
        alt="UltimaVLESS на Android: подключено, режим VPN"
        width="824"
        height="1830"
      />
    </div>
  </div>
</template>
