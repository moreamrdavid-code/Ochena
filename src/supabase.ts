import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;

export const getSupabase = (): SupabaseClient => {
  if (!supabaseInstance) {
    const env = (import.meta as any).env || {};
    
    // Vite standard
    let supabaseUrl = env.VITE_SUPABASE_URL;
    let supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

    // Fallback check (some environments might not require VITE_ prefix if configured)
    if (!supabaseUrl) supabaseUrl = env.SUPABASE_URL;
    if (!supabaseAnonKey) supabaseAnonKey = env.SUPABASE_ANON_KEY;

    console.log('Supabase Config Check:', {
      urlPresent: !!supabaseUrl,
      keyPresent: !!supabaseAnonKey
    });

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('SUPABASE_CONFIG_MISSING');
    }
    
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
  }
  return supabaseInstance;
};
