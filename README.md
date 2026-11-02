# Four You Consultants – Analytics Platform

Single-page app (`index.html`) hosted on Netlify, data stored in Supabase.

No login screen: each browser gets a private Supabase device account. Row Level
Security (owner_id = auth.uid()) keeps every account's data invisible to others.

The password + authenticator-code version is saved as git tag `secure-login`.
