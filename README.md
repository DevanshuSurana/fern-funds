# Fern & Funds — Personal Finance Planner

A responsive personal-finance planner with optional Supabase sign-in and cross-device cloud sync. The website is static HTML/CSS/JavaScript; Supabase provides authentication and the private cloud database.

## What syncs

The app syncs financial settings, cards, goals, monthly plans, and transactions as one private data record per authenticated user. Changes are saved locally immediately and sent to the cloud shortly afterward. When the app regains focus, it checks for newer cloud data. Use **Data & settings → Sync now** to force a refresh.

This is a single-user planner, not a collaborative multi-user ledger. Avoid editing the same records on two devices at the exact same time; the latest full-document save can replace another device's changes. JSON backups are still recommended.

## 1. Create and configure Supabase

1. Create a project at [Supabase](https://supabase.com/).
2. In the project dashboard, open **SQL Editor**, create a query, paste all of `supabase-schema.sql`, and run it. This creates the cloud table and Row Level Security policies.
3. Open **Project Settings → API** (or **Connect**, depending on dashboard layout) and copy the **Project URL** and the public **publishable key** or legacy **anon key**.
4. Open `config.js` and replace the two placeholder strings:

   ```js
   window.FERN_FUNDS_SUPABASE = {
     url: "https://YOUR-PROJECT.supabase.co",
     anonKey: "YOUR_PUBLIC_PUBLISHABLE_OR_ANON_KEY"
   };
   ```

   Use only the public publishable/anon key in this browser app. **Never use the `service_role` key or any secret key in `config.js`, HTML, JavaScript, or a public repository.**
5. In Supabase **Authentication → URL Configuration**, set the Site URL to your deployed GitHub Pages URL, such as `https://YOUR-USERNAME.github.io/fern-funds/`. Add that URL to the Redirect URLs list as well.
6. For simplest setup, use email/password sign-in. If email confirmation is enabled, confirm the message Supabase sends before signing in. Configure SMTP if you need reliable production email delivery; Supabase's default email service has limits.

## 2. Publish on GitHub Pages

1. Create a GitHub repository named `fern-funds`. GitHub Pages on the free plan typically requires a public repository.
2. Upload `index.html`, `styles.css`, `app.js`, `config.js`, `supabase-schema.sql`, `.nojekyll`, and `README.md` to the repository root.
3. Do **not** upload JSON backups or private financial records. The project URL and public publishable/anon key are intended for browser clients; database access is restricted by the row-level security policies in `supabase-schema.sql`.
4. Open **Settings → Pages**, select **Deploy from a branch**, choose `main` and `/(root)`, and save.
5. Visit the published site, open **Data & settings → Sync across your devices**, create an account or sign in, and follow any email-confirmation instructions.
6. Open the same published URL on your phone and sign in with the same account.

## 3. First sync and migration of existing data

The previous version saved data in this browser's `localStorage`. Keep a JSON backup before migrating. After you sign in:

- If your cloud account has no saved record, the app uploads this browser's current planner data to the cloud.
- If the cloud already contains data and this browser also has data, the app asks whether to load the cloud copy or replace it with this device's copy. Choose carefully: replacing cloud data overwrites the account's current planner document.
- Other devices load the same cloud record after sign-in. The app refreshes from the cloud when you return to the tab and also provides **Sync now**.

## Privacy and security notes

- Supabase stores the planner document in its database. Anyone with access to your Supabase account or app login may be able to access that data.
- The table has Row Level Security enabled and policies limit each signed-in user to rows whose `user_id` matches their authenticated user ID.
- The browser key is public by design; security depends on authentication and database policies, not on hiding that key.
- Use a unique password and keep offline JSON backups in a private location. Do not enter bank login credentials, full card numbers, or other secrets into the planner.
- This is not a bank connection, financial institution, or financial advice service. Confirm balances and deadlines against official statements.

## Local use

Open `index.html` in a modern browser or run `python -m http.server 8000` in this folder and visit `http://localhost:8000`. Cloud sync requires a configured Supabase project and a URL allowed in Supabase Authentication settings.

## Files

- `index.html` — app UI
- `styles.css` — responsive styling
- `app.js` — planner logic and sync behavior
- `config.js` — Supabase project URL and public client key placeholders
- `supabase-schema.sql` — database table and Row Level Security policies
