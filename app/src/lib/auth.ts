import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { supabase } from './sync'

export function useAuth() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(!!supabase)

  useEffect(() => {
    if (!supabase) return
    supabase.auth.getSession().then(({ data }) => { setUser(data.session?.user ?? null); setLoading(false) })
    const { data } = supabase.auth.onAuthStateChange((_e, session) => setUser(session?.user ?? null))
    return () => data.subscription.unsubscribe()
  }, [])

  return {
    user, loading, enabled: !!supabase,
    /** Emails a one-time sign-in link (no password). */
    sendLink: async (email: string) => {
      const { error } = await supabase!.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })
      return error?.message ?? null
    },
    signOut: () => supabase!.auth.signOut(),
  }
}
