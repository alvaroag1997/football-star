import './globals.css';

export const metadata = {
  title: 'Fútbol',
  description: 'Partidos de fútbol amateur con equipos equilibrados',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0b3d2e',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
