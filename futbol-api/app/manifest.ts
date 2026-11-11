import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Fútbol',
    short_name: 'Fútbol',
    description: 'Partidos de fútbol amateur con equipos equilibrados',
    start_url: '/',
    display: 'standalone',
    background_color: '#f4f6f4',
    theme_color: '#1f9d55',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  };
}
