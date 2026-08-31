import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'NEST Acoustic | 鳥類音声解析',
  description: '長時間録音から鳥の鳴き声を抽出し、候補種と声紋を確認する音声解析アプリ。',
  openGraph: {
    title: 'NEST Acoustic | 鳥類音声解析',
    description: '長時間録音から鳥の鳴き声を抽出し、夜間の検出と候補種を確認。',
    images: [{ url: '/og.png', width: 1536, height: 1024, alt: 'NEST Acoustic 鳥類音声解析' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'NEST Acoustic | 鳥類音声解析',
    description: '長時間録音から鳥の鳴き声を抽出し、夜間の検出と候補種を確認。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body></html>;
}
