# HIT.GUESS. — Railway deployment playbook

This guide deploys the **FastAPI backend** (`backend/`), the **Next.js frontend** (`frontend/`), and uses **Railway’s native PostgreSQL and Redis plugins** (not self-hosted DB containers).

**Why Dockerfiles (not Nixpacks alone):** This repo pins **Python 3.13** and **Node 22**, uses **Alembic** migrations, and ships the frontend as **Next.js `output: "standalone"`**. Dockerfiles give reproducible builds and explicit `$PORT` handling on Railway.

---

## 0. Prerequisites

- A [Railway](https://railway.app) account and a new **empty project** (or an existing one).
- This repository pushed to **GitHub / GitLab / Bitbucket** (Railway connects to git).
- **TIDAL API credentials** (`TIDAL_CLIENT_ID`, `TIDAL_CLIENT_SECRET`) from your TIDAL developer setup (same as local).

---

## 1. Infrastructure: PostgreSQL and Redis (Railway UI)

1. Open your Railway project.
2. Click **“New”** → **“Database”** → **“Add PostgreSQL”**.  
   - Wait until it shows **Running**.  
   - Open the Postgres service → **Variables** → copy **`DATABASE_URL`** (you will reference it on the backend service).
3. Click **“New”** → **“Database”** → **“Add Redis”**.  
   - Open the Redis service → **Variables** → copy **`REDIS_URL`** (reference on the backend service).

Do **not** add Postgres/Redis as custom Docker images in this project; use these plugins for backups and managed ops.

---

## 2. Backend service (`backend/`)

### 2.1 Create the service

1. **“New”** → **“GitHub Repo”** (or your provider) → select **this repository**.
2. After the service is created, open **Settings**:
   - **Root Directory:** `backend`
   - **Builder:** **Dockerfile** (not Nixpacks auto-detect if Railway offers a choice)
   - **Dockerfile path:** `Dockerfile` — **no leading slash.** Do not use `/Dockerfile`: Railway resolves that from the **git repository root**, so the file is missing (`Dockerfile` lives under `backend/`).

### 2.2 Public networking (API URL)

1. Open the backend service → **Settings** → **Networking**.
2. Click **Generate Domain** (or attach a custom domain).  
3. Note the public URL, e.g. `https://hit-guess-api-production.up.railway.app` — **no trailing slash**.  
   This value becomes:
   - **`NEXT_PUBLIC_API_URL`** on the frontend (build-time).
   - An entry in **`CORS_ALLOW_ORIGINS`** on the backend.

### 2.3 Environment variables (backend)

In the backend service → **Variables**, add:

| Variable | Source / value |
|----------|----------------|
| `DATABASE_URL` | **Reference** the variable from the **PostgreSQL** plugin service (Railway “Variable Reference” to `${{Postgres.DATABASE_URL}}` or UI equivalent). |
| `REDIS_URL` | **Reference** `${{Redis.REDIS_URL}}` from the **Redis** plugin. |
| `TIDAL_CLIENT_ID` | Your TIDAL client id (plain string). |
| `TIDAL_CLIENT_SECRET` | Your TIDAL client secret (mark as **secret** in Railway). |
| `CORS_ALLOW_ORIGINS` | Comma-separated **exact** origins allowed to call the API from the browser, **no spaces**. Include **every** frontend URL you use, e.g. `https://your-frontend.up.railway.app` and later `https://hitguess.com`. |

Optional:

| Variable | Purpose |
|----------|---------|
| `DEBUG` | `false` in production. |
| `ADMIN_TOKEN` | Protects `/api/v1/admin/*` and the hidden admin UI. |
| `STRICT_CATEGORY_LOGIC` | `true` / `false` per product rules. |
| `SCHEDULER_TIMEZONE` | e.g. `Europe/Warsaw`. |

**Note:** Railway often provides `DATABASE_URL` as `postgres://` or `postgresql://` without `+asyncpg`. The backend **normalizes** these to `postgresql+asyncpg://` automatically in `app/core/config.py`.

### 2.4 Start command and migrations

The **`backend/Dockerfile`** already runs:

```text
alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

So each new deployment applies migrations before the API listens.  
If you later run **multiple replicas** and prefer migrations only once, remove `alembic upgrade head` from the image and use a **one-off Railway shell** or **Release / Deploy Command** instead (Railway product UI varies; use “Run command” / shell: `alembic upgrade head` from `/app`).

### 2.5 Deploy and verify

1. Trigger a deploy (git push or **“Redeploy”**).
2. Open `https://<your-backend-domain>/health` — expect JSON like `{"status":"ok"}`.
3. Open `https://<your-backend-domain>/docs` — FastAPI Swagger.

---

## 3. Frontend service (`frontend/`)

### 3.1 Create the service

1. **“New”** → **“GitHub Repo”** → same repository (second service).
2. **Settings**:
   - **Root Directory:** `frontend`
   - **Builder:** **Dockerfile**
   - **Dockerfile path:** `Dockerfile` (not `/Dockerfile` — see backend section above)

### 3.2 Build-time: `NEXT_PUBLIC_API_URL`

Next.js inlines `NEXT_PUBLIC_*` at **build** time. In Railway:

1. Frontend service → **Variables**.
2. Add **`NEXT_PUBLIC_API_URL`** = your **backend public URL** (same as §2.2), **https**, no trailing slash.
3. In **Docker** settings, add a **Docker Build Argument** with the **same** name and value:  
   **`NEXT_PUBLIC_API_URL`** = `https://<your-backend-domain>`  
   (Railway maps build args into `ARG` during `docker build`.)

If you change the API URL later, **rebuild** the frontend (Redeploy) so the client bundle picks up the new value.

### 3.3 Public networking (site URL)

1. Frontend service → **Settings** → **Networking** → **Generate Domain**.
2. Add this origin (and any custom domain) to backend **`CORS_ALLOW_ORIGINS`** (comma-separated, no spaces).

### 3.4 Deploy and verify

1. Deploy the frontend.
2. Visit the frontend public URL; play a daily game and confirm network calls go to your backend host (browser DevTools → Network).

---

## 4. Networking summary

| Service | Railway action | Result |
|---------|----------------|--------|
| Backend | **Generate Domain** on the API service | `https://…` for `NEXT_PUBLIC_API_URL` and for CORS |
| Frontend | **Generate Domain** on the web service | Origin string for `CORS_ALLOW_ORIGINS` |

**CORS:** The app reads **`CORS_ALLOW_ORIGINS`** in `backend/app/core/config.py` and applies it in `backend/app/main.py`. There is **no** wildcard `*` with credentials; list each real `https://` origin.

---

## 5. Local vs production (reference)

| Concern | Local (`docker-compose.yml`) | Railway |
|---------|------------------------------|---------|
| Postgres | Compose service `postgres` | **PostgreSQL** plugin |
| Redis | Compose service `redis` | **Redis** plugin |
| API URL | `http://localhost:8000` in `frontend/.env.local` | `NEXT_PUBLIC_API_URL=https://…` |
| CORS | Defaults include `http://localhost:3000` | Set `CORS_ALLOW_ORIGINS` to your frontend `https://…` |

The repo root **`docker-compose.yml`** only defines **Postgres + Redis** for local dev; it does **not** build app containers — production uses the **per-folder Dockerfiles** above.

---

## 6. Troubleshooting (short)

- **`Dockerfile` does not exist` with Root Directory `backend` or `frontend`:** Set **Dockerfile path** to `Dockerfile` (no leading slash). `/Dockerfile` points at the **repository root**, not inside `backend/` or `frontend/`.
- **CORS errors in the browser:** Backend `CORS_ALLOW_ORIGINS` must include the **exact** frontend origin (scheme + host + port if any). No trailing slash on origins.
- **`Missing NEXT_PUBLIC_API_URL` in production bundle:** Set the variable **and** the Docker **build arg**, then redeploy the frontend.
- **DB connection errors:** Confirm `DATABASE_URL` is referenced from the Postgres plugin; check backend logs for SSL/host issues (Railway internal hostnames are correct when using references).
- **Migrations not applied:** Check backend deploy logs for `alembic upgrade head` errors; fix forward in Alembic revisions if a migration fails.

---

## 7. Files added or changed for Railway

| Path | Role |
|------|------|
| `backend/Dockerfile` | Production API image: Alembic + Uvicorn on `$PORT`. |
| `backend/.dockerignore` | Smaller, safer build context. |
| `backend/.env.example` | Variable checklist for operators. |
| `backend/app/core/config.py` | Normalizes Railway `postgres://` / `postgresql://` to `postgresql+asyncpg://`. |
| `frontend/Dockerfile` | Multi-stage Next **standalone** image; `HOSTNAME=0.0.0.0`; listens on `$PORT`. |
| `frontend/.dockerignore` | Smaller build context. |
| `frontend/next.config.mjs` | `output: "standalone"`; localhost image remote pattern only in non-production builds. |
