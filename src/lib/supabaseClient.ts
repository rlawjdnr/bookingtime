import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://ohwvtwywwjbwlkknwjxe.supabase.co";
const defaultSupabasePublishableKey = "sb_publishable_6swY_ToC6e4UqgpxKkop-g_OvmS2wSS";
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || defaultSupabasePublishableKey;

export const hasSupabaseConfig = Boolean(supabaseUrl && supabaseAnonKey);

export const supabase = hasSupabaseConfig
  ? createClient(supabaseUrl, supabaseAnonKey, {
      realtime: {
        params: {
          eventsPerSecond: 5,
        },
      },
    })
  : null;
