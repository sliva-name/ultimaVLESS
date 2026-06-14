export default defineEventHandler((event) => {
  const config = useRuntimeConfig();
  const siteUrl = config.public.siteUrl.replace(/\/$/, '');

  setHeader(event, 'content-type', 'text/plain; charset=utf-8');

  return [
    'User-agent: *',
    'Allow: /',
    '',
    `Sitemap: ${siteUrl}/sitemap.xml`,
  ].join('\n');
});
