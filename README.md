# Four You Consultants – Analytics Platform

Single-page app (`index.html`) hosted on Netlify, data stored in Supabase.
No login screen: each browser gets a private Supabase device account; Row Level
Security (owner_id = auth.uid()) keeps every account's data separate.

## Deep learning (TensorFlow.js, runs in the browser)
Supabase cannot run Python (its server functions are TypeScript), so the
models run in the visitor's browser with TensorFlow.js.

| Segment | File | Model | Output activation |
|---|---|---|---|
| 1 | `js/dl-activations.js` | Activation policy + model audit | — |
| 2 | `js/dl-cnn.js` | CNN – post images | softmax (content class) / sigmoid (high vs low) / linear (ER) |
| 3 | `js/dl-rnn.js` | RNN (LSTM) – weekly sequences | linear (next-week ER) / sigmoid (up or down) |
| 4 | `js/dl-gan.js` | GAN – synthetic weeks | generator sigmoid (0..1 scaled data), discriminator sigmoid |
| 5 | `js/client-backup.js` | Per-client backup & restore | — |
| 6 | `js/dl-lab.js` | Wires 1-5 into the page | — |

Hidden layers: ReLU or Leaky ReLU, uniform within each network (GAN uses Leaky ReLU).

## Run the unit tests (VS Code)
```
npm install
npm test
```
Or one segment at a time: `node --test test/dl-cnn.test.js`

## Backup & restore
Settings → Back up a client / Back up all clients saves a `fy-backup_*.json`
file (all rows from clients, metrics_weekly, posts, profile_snapshots,
documents, credentials + SHA-256 checksum). Settings → Restore from backup
upserts it back into Supabase. Safe to run more than once.

The password + authenticator version of the page is saved as git tag `secure-login`.
