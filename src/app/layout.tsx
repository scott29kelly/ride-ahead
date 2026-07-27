import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'RideAhead — see the ride before you ride it',
  description:
    'Enter a few destinations and get a photo preview of each route, with the highlights you would actually ride past.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
