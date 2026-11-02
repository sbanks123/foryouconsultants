# Four You Consultants – Analytics Platform

Single-page app (`index.html`) hosted on Netlify, data stored in Supabase.

Security: sign-in is Supabase Auth password + authenticator-app code (TOTP).
Row Level Security allows only the owner account at assurance level aal2, so the
public Supabase key in the page cannot read or change anything on its own.
