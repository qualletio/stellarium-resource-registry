import type { Metadata } from 'next';
import { JetBrains_Mono } from 'next/font/google';
import { Header } from '@/components/Header';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from '@/lib/site';
import { THEME_STORAGE_KEY } from '@/lib/theme';
import './globals.css';
import styles from './layout.module.css';

const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_NAME, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
};

// Runs before first paint, so a saved or system theme never flashes the other one.
const themeScript = `(function(){try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'}document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme='dark'}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={mono.variable} suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static theme bootstrap, no user input */}
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <div className={styles.shell}>
          <Header />
          <main className={styles.main}>{children}</main>
          <footer className={styles.footer}>
            <span>stellarium-registry</span>
            <span className={styles.sep}>│</span>
            <a href="https://stellarium.sh" target="_blank" rel="noreferrer">stellarium.sh</a>
            <span className={styles.sep}>│</span>
            <a href="https://docs.stellarium.sh" target="_blank" rel="noreferrer">docs.stellarium.sh</a>
          </footer>
        </div>
      </body>
    </html>
  );
}
