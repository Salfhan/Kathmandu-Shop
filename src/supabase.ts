import { createClient } from '@supabase/supabase-js';

// Keep environment variables as the preferred configuration. The public
// project URL and publishable key below are safe for browser-side use and
// allow Cloudflare branch previews to work if Preview variables are absent.
const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)
  || 'https://hwvdglxhqfgrowkyctuo.supabase.co';
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)
  || 'sb_publishable_-3a7Xx5_hY4UiuD9jostiw_KjnQpdEH';

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

export function raise(error: any): never {
  const message = error?.message || error?.error_description || 'The request could not be completed.';
  throw { response: { data: { error: message, message } } };
}

export const auth = {
  async getUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error && error.name !== 'AuthSessionMissingError') raise(error);
    const u = data.user;
    return u ? {
      userId: u.id,
      email: u.email,
      name: u.user_metadata?.full_name || u.user_metadata?.name || u.email,
    } : null;
  },
  async signInWithRedirect() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
        queryParams: { access_type: 'offline', prompt: 'select_account' },
      },
    });
    if (error) raise(error);
  },
  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) raise(error);
  },
};
