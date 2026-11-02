# Four You Consultants: social analytics

Static single-page app. Data lives in Supabase; nothing is stored in the browser except a short-lived sign-in session.

**Security model**
- The page ships only the public Supabase URL and publishable key. They grant no access by themselves.
- Every table has row-level security: only the owner account, signed in with a password **and** a verified authenticator code, can read or write.
- No service-role key and no custom API exist in this repo or the page.
- Sign-in ends when the tab closes or after 20 minutes of inactivity.

`vendor/supabase.js` is `@supabase/supabase-js` 2.117.3 (UMD build, MIT), served from this site instead of a CDN.
