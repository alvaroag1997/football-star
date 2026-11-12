import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Cliente de Supabase para el NAVEGADOR (login y chat en tiempo real).
// Usa la clave pública "anon": las tablas están protegidas con RLS y todo lo demás pasa por /api.
let client: SupabaseClient | null = null;

export function sb(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error('Faltan NEXT_PUBLIC_SUPABASE_URL o NEXT_PUBLIC_SUPABASE_ANON_KEY');
    client = createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
  }
  return client;
}
