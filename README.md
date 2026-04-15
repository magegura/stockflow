# StockFlow

Portfolio-ready full-stack demo for inventory, warehouse operations and sales.

StockFlow is designed to look credible in a recruiter review: it is not just a CRUD toy. The project includes authentication, role-based access, inventory adjustments, multi-item sales, analytics, Docker setup, CI, PostgreSQL support and deployment configs for Render + Vercel.

## Live demo

> Add your real links after the first deploy:
>
> - Frontend demo: `https://YOUR-FRONTEND.vercel.app`
> - API base URL: `https://YOUR-API.onrender.com/api`
> - API docs: `https://YOUR-API.onrender.com/docs`

## Highlights

- JWT authentication
- Roles: `admin` and `employee`
- Product management with create, edit and delete flows
- Stock movements: `purchase`, `writeoff`, `adjustment`, `sale`
- Multi-item sales with automatic stock deduction
- Dashboard with revenue trend, top products and low-stock watchlist
- Seeded demo data for a stronger first impression
- Docker Compose with PostgreSQL
- Render Blueprint for backend + managed Postgres
- Vercel config for the frontend
- GitHub Actions for backend tests and frontend build

## Tech stack

- **Frontend:** React + TypeScript + Vite
- **Backend:** FastAPI + SQLAlchemy
- **Database:** PostgreSQL (production) / SQLite (test fallback)
- **Auth:** JWT
- **Infra:** Docker + Docker Compose + Render + Vercel
- **CI:** GitHub Actions

## Demo accounts

Seed data is created automatically on first startup.

- **Admin**
  - email: `admin@stockflow.app`
  - password: `Admin123!`
- **Employee**
  - email: `employee@stockflow.app`
  - password: `Employee123!`

## What the demo contains

- 6 seeded products
- seeded sales history across several days
- seeded warehouse movements
- low-stock and out-of-stock examples for dashboard widgets

## Quick start

### Option 1 — Docker

```bash
docker compose up --build
```

After startup:

- frontend: `http://localhost:5173`
- backend docs: `http://localhost:8000/docs`
- PostgreSQL: `localhost:5432`

### Option 2 — Local development

#### PostgreSQL

Run a local PostgreSQL instance and set:

```bash
DATABASE_URL=postgresql+psycopg://stockflow:stockflow@localhost:5432/stockflow
JWT_SECRET=change-me
CORS_ORIGINS=http://localhost:5173
```

#### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Windows PowerShell:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app.main:app --reload
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Deploy

### Backend + database on Render

This repo already contains `render.yaml`.

What it does:

- provisions a managed PostgreSQL database
- deploys the FastAPI backend as a Render web service
- injects `DATABASE_URL` automatically from the Render database
- generates `JWT_SECRET`
- uses `/api/health` as the health check path

Steps:

1. Push this repo to GitHub.
2. In Render, create a new **Blueprint** deployment from the repo.
3. Render will detect `render.yaml` and provision:
   - `stockflow-db`
   - `stockflow-api`
4. In the backend service, set `CORS_ORIGINS` to your future Vercel URL, for example:
   - `https://your-frontend.vercel.app`
5. After deploy, copy your backend URL, for example:
   - `https://stockflow-api.onrender.com`

### Frontend on Vercel

The frontend already contains `frontend/vercel.json`.

Suggested Vercel settings:

- **Root Directory:** `frontend`
- **Framework Preset:** Vite
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Environment Variable:**
  - `VITE_API_URL=https://YOUR-API.onrender.com/api`

After deploy, you will get a URL like:

- `https://stockflow-demo.vercel.app`

### Final production wiring

After both services are live:

1. Copy the Vercel frontend URL.
2. Put that URL into Render backend env var:
   - `CORS_ORIGINS=https://YOUR-FRONTEND.vercel.app`
3. Redeploy the backend.
4. Update the **Live demo** section at the top of this README with your real links.

## Project structure

```text
stockflow/
├── backend/
│   ├── app/
│   │   ├── auth.py
│   │   ├── db.py
│   │   ├── main.py
│   │   └── security.py
│   ├── tests/
│   │   └── test_api_smoke.py
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── App.tsx
│   │   ├── index.css
│   │   ├── main.tsx
│   │   └── types.ts
│   ├── Dockerfile
│   ├── nginx.conf
│   ├── package.json
│   └── vercel.json
├── .github/workflows/ci.yml
├── .env.example
├── .gitignore
├── docker-compose.yml
├── render.yaml
└── README.md
```

## Main business flows

### Admin

- create and edit products
- delete products without sales history
- manage stock movements
- see dashboard analytics

### Employee

- sign in
- create sales
- view catalog, sales and movements

## API examples

### Login

```http
POST /api/auth/login
```

```json
{
  "email": "admin@stockflow.app",
  "password": "Admin123!"
}
```

### Create a sale

```http
POST /api/sales
Authorization: Bearer <token>
```

```json
{
  "items": [
    { "product_id": 1, "quantity": 2 },
    { "product_id": 3, "quantity": 1 }
  ]
}
```

## Why this is a strong portfolio project

This repository shows more than syntax knowledge:

- a realistic business domain
- access control and authentication
- state changes with side effects
- analytics from transactional data
- PostgreSQL-ready production configuration
- Dockerized local environment
- automated checks in CI
- cloud deployment path with Render and Vercel

## Suggested next commits

- add Alembic migrations
- add audit log / soft delete
- add CSV export
- add e2e tests
- add charts library with richer analytics
- add optimistic UI updates

## License

MIT
