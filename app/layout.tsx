import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin', 'cyrillic'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin', 'cyrillic'] });
const repository = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'rh-portfolio';
const publicPath = process.env.GITHUB_ACTIONS === 'true' ? `/${repository}` : '';

export const metadata: Metadata = {
  title: 'RH Portfolio',
  description: 'Актуальные позиции кошелька в сети Robinhood Chain',
  icons: {
    icon: [{ url: `${publicPath}/favicon.svg`, type: 'image/svg+xml' }],
    shortcut: `${publicPath}/favicon.svg`,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
