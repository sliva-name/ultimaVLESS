import { platforms, siteLinks, type PlatformFile, type PlatformId } from '~/data/landing';

interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
}

interface ReleaseInfo {
  version: string;
  publishedAt: string;
  assets: ReleaseAsset[];
}

interface CachedInfo {
  savedAt: number;
  release: ReleaseInfo | null;
  stars: number | null;
}

const CACHE_KEY = 'ultimavless:release';
const CACHE_TTL = 10 * 60 * 1000;

let loading: Promise<void> | null = null;

const readCache = (): CachedInfo | null => {
  try {
    const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) ?? 'null') as CachedInfo | null;
    return cached && Date.now() - cached.savedAt < CACHE_TTL ? cached : null;
  } catch {
    return null;
  }
};

const writeCache = (info: CachedInfo) => {
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify(info));
  } catch {
    // Storage can be unavailable (private mode); the page works without it.
  }
};

const fetchJson = async <T>(url: string): Promise<T | null> => {
  try {
    const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
};

const detectPlatform = (): PlatformId | null => {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const ua = nav.userAgent;
  const platform = nav.userAgentData?.platform ?? nav.platform ?? '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return null;
  if (/win/i.test(platform) || /windows/i.test(ua)) return 'windows';
  // iPadOS reports itself as a Mac; a touch screen gives it away.
  if (/mac/i.test(platform) || /mac os x/i.test(ua)) return nav.maxTouchPoints > 1 ? null : 'macos';
  if (/linux|x11|cros/i.test(platform) || /linux|x11/i.test(ua)) return 'linux';
  return null;
};

/**
 * The latest GitHub release, the star count and the visitor's platform. All
 * three are filled in the browser after hydration; the prerendered page links
 * to the release page instead, so it works without them.
 */
export const useRelease = () => {
  const release = useState<ReleaseInfo | null>('release', () => null);
  const stars = useState<number | null>('stars', () => null);
  const platformId = useState<PlatformId | null>('platform', () => null);

  onMounted(() => {
    platformId.value ??= detectPlatform();
    if (release.value || loading) return;

    const cached = readCache();
    if (cached) {
      release.value = cached.release;
      stars.value = cached.stars;
      return;
    }

    loading = (async () => {
      const [latest, repo] = await Promise.all([
        fetchJson<{
          tag_name: string;
          published_at: string;
          assets: { name: string; browser_download_url: string; size: number }[];
        }>(siteLinks.api.latestRelease),
        fetchJson<{ stargazers_count: number }>(siteLinks.api.repository),
      ]);
      release.value = latest
        ? {
            version: latest.tag_name.replace(/^v/, ''),
            publishedAt: latest.published_at,
            assets: latest.assets.map((asset) => ({
              name: asset.name,
              url: asset.browser_download_url,
              size: asset.size,
            })),
          }
        : null;
      stars.value = repo?.stargazers_count ?? null;
      if (latest || repo) writeCache({ savedAt: Date.now(), release: release.value, stars: stars.value });
    })();
  });

  const findAsset = (file: PlatformFile) =>
    release.value?.assets.find((asset) => file.pattern.test(asset.name)) ?? null;

  const platform = computed(() => platforms.find((item) => item.id === platformId.value) ?? null);

  return { release, stars, platform, findAsset };
};

export const formatSize = (bytes: number) => `${Math.round(bytes / 1024 / 1024)} МБ`;

/** «6 ноября 2026», without the «г.» that Intl appends. */
export const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date(iso))
    .replace(/\s*г\.$/, '');
