import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
const hasRealProjectUrl = Boolean(
  supabaseUrl && /^https?:\/\//.test(supabaseUrl) && !/your-project|placeholder/i.test(supabaseUrl),
)
const hasRealPublicKey = Boolean(
  supabaseAnonKey && supabaseAnonKey.length > 20 && !/your-anon-key|placeholder/i.test(supabaseAnonKey),
)

export const missingSupabaseSettings = [
  ...(!hasRealProjectUrl ? ['VITE_SUPABASE_URL'] : []),
  ...(!hasRealPublicKey ? ['VITE_SUPABASE_ANON_KEY'] : []),
]

export const supabase = hasRealProjectUrl && hasRealPublicKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
      },
    })
  : null

export const isSupabaseConfigured = supabase !== null