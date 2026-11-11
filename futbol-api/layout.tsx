import './globals.css';

export const metadata = {
  title: 'Equilibrio FC',
  description: 'Partidos de fútbol amateur con equipos equilibrados',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#080d0a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Inter:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
