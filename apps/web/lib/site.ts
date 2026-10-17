import 'server-only';
import type { Metadata } from 'next';

/**
 * The public origin, for canonical links, the sitemap and robots.txt. Railway sets RAILWAY_PUBLIC_DOMAIN
 * for services with a public domain, so SITE_URL is only needed elsewhere or for a custom domain.
 */
export const SITE_URL = (
  process.env.SITE_URL ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : 'http://localhost:3000')
).replace(/\/+$/, '');

export const SITE_NAME = 'Stellarium Registry';

export const SITE_DESCRIPTION =
  'Search the resources on the Stellarium network. See every function a resource offers, what each call costs, and whether callers need a grant.';

/**
 * Title, description, canonical link and social cards for one page. Next.js replaces `openGraph` and `twitter`
 * wholesale rather than merging them with the layout's, so every page builds its own.
 */
export function pageMetadata({ title, description = SITE_DESCRIPTION, path }: { title?: string; description?: string; path: string }): Metadata {
  const socialTitle = title ? `${title} · ${SITE_NAME}` : SITE_NAME;
  return {
    ...(title && { title }),
    description,
    alternates: { canonical: path },
    openGraph: { type: 'website', siteName: SITE_NAME, locale: 'en_US', url: path, title: socialTitle, description },
    twitter: { card: 'summary', title: socialTitle, description },
  };
}
