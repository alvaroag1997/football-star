import './globals.css';

export const metadata = {
  title: 'Equilibrio FC',
  description: 'Partidos de fútbol amateur con equipos equilibrados',
  icons: { icon: '/icon-192.png', apple: '/icon-180.png' },
  appleWebApp: { capable: true, title: 'Equilibrio FC', statusBarStyle: 'black-translucent' as const },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#080d0a',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Tema elegido (Perfil → Apariencia) antes de pintar, para que no parpadee */}
        <script
          dangerouslySetInnerHTML={{
            __html: "try{if(localStorage.getItem('eqfc-theme')==='light'){document.documentElement.dataset.theme='light'}}catch(e){}",
          }}
        />
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
