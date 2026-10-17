import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// SITE_URL is read at request time, so one image serves any domain.
export const dynamic = 'force-dynamic';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
