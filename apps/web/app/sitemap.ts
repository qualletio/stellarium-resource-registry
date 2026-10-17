import type { MetadataRoute } from 'next';
import { searchResources } from '@/lib/api';
import { SITE_URL } from '@/lib/site';

// Built per request so builds don't need the API. Fetches are still cached for a few seconds (lib/api.ts).
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;
/** The sitemap protocol's limit per file. */
const MAX_URLS = 50_000;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'hourly', priority: 1 },
    { url: `${SITE_URL}/search`, changeFrequency: 'hourly', priority: 0.5 },
  ];

  // Search lists only live resources, so removed ones drop out of the sitemap.
  let offset: number | null = 0;
  while (offset !== null && entries.length < MAX_URLS) {
    const page = await searchResources({ offset, limit: PAGE_SIZE });
    for (const resource of page.items) {
      entries.push({
        // No lastModified: lastSeenAt moves on every sync, whether or not the resource changed.
        url: `${SITE_URL}/resources/${encodeURIComponent(resource.fqn)}`,
        changeFrequency: 'daily',
        priority: 0.8,
      });
    }
    offset = page.nextOffset;
  }

  return entries.slice(0, MAX_URLS);
}
