import { faq, features, seo, siteLinks } from '~/data/landing';

export const useLandingSeo = () => {
  const config = useRuntimeConfig();
  const siteUrl = config.public.siteUrl.replace(/\/$/, '');
  const pageUrl = `${siteUrl}/`;
  const ogImage = `${siteUrl}/og.svg`;

  if (import.meta.server) {
    useSeoMeta({
      title: seo.title,
      ogTitle: seo.title,
      description: seo.description,
      ogDescription: seo.description,
      keywords: seo.keywords.join(', '),
      robots: 'index, follow, max-image-preview:large',
      author: 'UltimaVPN',
      ogType: 'website',
      ogUrl: pageUrl,
      ogSiteName: 'UltimaVLESS',
      ogLocale: 'ru_RU',
      ogImage,
      twitterCard: 'summary_large_image',
      twitterTitle: seo.title,
      twitterDescription: seo.description,
      twitterImage: ogImage,
    });
  }

  useHead({
    link: [{ rel: 'canonical', href: pageUrl }],
    script: [
      {
        type: 'application/ld+json',
        innerHTML: JSON.stringify([
          {
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'UltimaVLESS',
            applicationCategory: 'SecurityApplication',
            operatingSystem: 'Windows, macOS, Linux',
            description: seo.description,
            softwareVersion: '7.4.1',
            offers: {
              '@type': 'Offer',
              price: '0',
              priceCurrency: 'USD',
            },
            downloadUrl: siteLinks.download,
            codeRepository: siteLinks.repository,
            license: `${siteLinks.repository}/blob/main/LICENSE`,
            featureList: features.map((feature) => feature.title),
          },
          {
            '@context': 'https://schema.org',
            '@type': 'FAQPage',
            mainEntity: faq.map((item) => ({
              '@type': 'Question',
              name: item.question,
              acceptedAnswer: {
                '@type': 'Answer',
                text: item.answer,
              },
            })),
          },
        ]),
      },
    ],
  });
};
