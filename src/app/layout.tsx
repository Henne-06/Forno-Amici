import type { Metadata } from 'next';
import { BRAND } from '@/lib/config';
import './globals.css';
export const metadata: Metadata = {
  title: `${BRAND.name} · Deine Pizza-Party`,
  description: 'Gemeinsam genießen. Stelle deine Pizza zusammen und wir kümmern uns um den Rest.',
  icons: { icon: '/icon.svg' },
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
