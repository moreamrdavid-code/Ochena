import { createClient, SupabaseClient } from '@supabase/supabase-js';

let supabaseInstance: SupabaseClient | null = null;

export const getSupabase = (): SupabaseClient => {
  if (!supabaseInstance) {
    const env = (import.meta as any).env || {};
    const supabaseUrl = env.VITE_SUPABASE_URL;
    const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
      // অ্যাপ ক্র্যাশ হওয়া থেকে বাঁচাতে একটি এরর থ্রো করছি যা আমরা UI-তে হ্যান্ডেল করতে পারবো
      throw new Error('SUPABASE_CONFIG_MISSING');
    }
    
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey);
  }
  return supabaseInstance;
};
