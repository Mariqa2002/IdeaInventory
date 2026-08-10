/* ==========================================================================
   Connection defaults.

   Fill these in and commit the file, and every device you open the app on
   picks the connection up automatically — you only have to log in. Leave them
   empty and the app asks for them on first run instead, storing the answers on
   that device.

   Both values are safe to commit. The anon key is designed to ship inside
   client apps: on its own it can do nothing, because every table is guarded by
   Row Level Security policies that only let a signed-in person touch their own
   rows (see supabase/schema.sql). Never put the *service_role* key here — that
   one bypasses those policies entirely.

   Find them in Supabase → Project Settings → API:
     url     → "Project URL",  e.g. https://abcdefghijkl.supabase.co
     anonKey → "anon public" key
   ========================================================================== */

export const SUPABASE_DEFAULTS = {
  url: '',
  anonKey: '',
};

/** How often the app checks the server for changes made on your other devices. */
export const SYNC_INTERVAL_MS = 20000;
