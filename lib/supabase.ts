import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/**
 * True when real Supabase credentials are present in the environment.
 * False during build, in tests, or when .env.local has not been created yet.
 *
 * The client is always created (with placeholder values if needed) so that
 * importing this module never throws — this keeps `next build` and test
 * imports working without env vars. Queries will fail at runtime if the
 * client is a placeholder, which is the desired loud failure.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)

if (!isSupabaseConfigured && process.env.NODE_ENV !== 'production') {
  console.warn(
    '[supabase] Not configured. Copy .env.local.example to .env.local and fill in your project credentials. Data read/write will fail until then.',
  )
}

export const supabase = createClient<Database>(
  supabaseUrl ?? 'https://placeholder.supabase.co',
  supabaseAnonKey ?? 'placeholder-anon-key',
)
