## Roadmap

(done) Fix voice (0 only) + dédoublonnage

Export JSONL par morceau (events triés, accords triés)

Baseline DP/Viterbi + metrics

Définir score jouabilité (même simple)

Ensuite seulement : modèle ML/NN + reranking jouabilité

## Convert gp5 to midi

```bash
python gp_to_midi.py --input ../sf.gp5 --output ../sf.mid
```

## Launch web server

### Dev

Frontend:
```bash
cd frontend
npm run dev
```

Backend:
```bash
cd python
python server.py --dev
```

The frontend dev server runs on port **10201** and proxies `/api` requests to the backend on port **8000**.

### Prod

Build the frontend:
```bash
cd frontend
npm run build   # outputs to frontend/dist/
```

Run via Docker:
```bash
docker build -t fretflow .
docker run -p 8000:8000 \
  -e GOOGLE_CLIENT_ID=xxx \
  -e GOOGLE_CLIENT_SECRET=yyy \
  -e SECRET_KEY=long-random-string \
  -e APP_BASE_URL=https://yourdomain.com \
  fretflow
```

## Frontend

The frontend is a **React + Vite + TypeScript** SPA located in `frontend/`.

```
frontend/
  index.html
  vite.config.ts
  src/
    main.tsx              # app entry point
    App.tsx               # auth gate + React Router routes
    api.ts                # fetch wrapper (GET / POST / binary)
    contexts/
      AuthContext.tsx      # user auth state, checkAuth, logout
    components/
      Navigation.tsx       # sidebar nav + user badge
    pages/
      Login.tsx            # Google OAuth + email/password login
      Fretflow.tsx         # MIDI → GP5 converter with AlphaTab player
      Account.tsx          # user info + subscription
      Me.tsx               # data / sessions tabs, edit + delete modals
    assets/               # alphatab, favicon, images
    scss/                 # global styles
```

### Environment — `python/.env`

| Variable              | Description                                         |
|-----------------------|-----------------------------------------------------|
| `APP_BASE_URL`        | Base URL of the app (e.g. `http://localhost:8000`)  |
| `ADMIN_EMAIL`         | Fallback admin login email (no DB required)         |
| `ADMIN_PASSWORD`      | Fallback admin login password                       |
| `GOOGLE_CLIENT_ID`    | Google OAuth client ID                              |
| `GOOGLE_CLIENT_SECRET`| Google OAuth client secret                          |
| `SECRET_KEY`          | Session signing key                                 |
| `DATABASE_URL`        | Postgres connection string (optional, enables DB)   |
| `ALLOWED_EMAILS`      | Comma-separated list of allowed emails (empty = all)|

### Auth

- **Google OAuth**: click "Sign in with Google" → redirects to `/api/auth/google`
- **Admin fallback**: set `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env` to enable email+password login without a database. The email field must match `ADMIN_EMAIL` exactly (use a valid email format, e.g. `user@local.dev`).
- Sessions are cookie-based (httponly, signed).

---

## TODO — Paywall (after auth)

Model: **freemium** — N free conversions/month, then paid subscription via Stripe.

### Implementation order
1. Add **Supabase** (managed Postgres) — create project at supabase.com, copy connection string into `DATABASE_URL` env var. Minimum schema: `users(email, plan, conversions_used, stripe_customer_id)`
2. Stripe integration

### Backend to build
- `POST /api/checkout` — create Stripe Checkout session → return redirect URL
- `POST /api/stripe/webhook` — handle payment success / cancellation / renewal
- Paywall middleware on `/api/fretflow` and `/api/suggest-params` (check plan + conversions_used)

### Frontend to build
- Usage counter display (e.g. "3/5 conversions used this month")
- Upgrade prompt when limit is hit
- "Upgrade" button → calls `/api/checkout` → redirects to Stripe
