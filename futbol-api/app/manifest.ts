import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Equilibrio FC',
    short_name: 'Equilibrio',
    description: 'Partidos de fútbol amateur con equipos equilibrados',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#080d0a',
    theme_color: '#080d0a',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
