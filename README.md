# StockFlow

Portfolio-ready full-stack demo for inventory, warehouse operations and sales.

StockFlow is designed to look credible in a recruiter review: it is not just a CRUD toy. The project includes authentication, role-based access, inventory adjustments, multi-item sales, analytics, audit logs, technical documentation, responsive UI, Docker setup, CI, PostgreSQL support and deployment configs for Vercel / Render-style workflows.

## Live demo

> Add your real links after the first deploy:
>
> - Frontend demo: `https://YOUR-FRONTEND.vercel.app`
> - API base URL: `https://YOUR-BACKEND.vercel.app/api`
> - API docs: `https://YOUR-BACKEND.vercel.app/docs`

## Highlights

- JWT authentication
- Roles: `admin` and `employee`
- Product management with create, edit and delete flows
- Personnel profiles with admin staff management and employee self-service updates
- Stock movements: `purchase`, `writeoff`, `adjustment`, `sale`
- Multi-item sales with automatic stock deduction
- Compact dashboard with revenue trend, top products and low-stock watchlist
- Audit logs stored in the database and visible in the UI
- Technical documentation in `docs/`
- Responsive layout with collapsible sidebar and mobile burger menu
- Seeded demo data for a stronger first impression
- Docker Compose with PostgreSQL
- Vercel / PostgreSQL-ready environment configuration
- GitHub Actions for backend tests and frontend build

## Tech stack

- **Frontend:** React + TypeScript + Vite
- **Backend:** FastAPI + SQLAlchemy
- **Database:** PostgreSQL (production) / SQLite (tests and local fallback)
- **Auth:** JWT
- **Infra:** Docker + Docker Compose + Vercel-ready setup
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

- enriched seeded product catalog
- seeded sales history across several days
- seeded warehouse movements
- seeded staff directory with roles, titles, statuses and hierarchy
- low-stock and out-of-stock examples for dashboard widgets
- audit log entries for sign-ins and write operations

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

### Backend

Set these environment variables:

```bash
DATABASE_URL=postgresql+psycopg://...
JWT_SECRET=change-me
CORS_ORIGINS=https://YOUR-FRONTEND.vercel.app
```

### Frontend

Suggested Vercel settings:

- **Root Directory:** `frontend`
- **Framework Preset:** Vite
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Environment Variable:**
  - `VITE_API_URL=https://YOUR-BACKEND.vercel.app/api`

### Final production wiring

1. Deploy the backend.
2. Deploy the frontend.
3. Set backend `CORS_ORIGINS` to the exact frontend domain.
4. Redeploy backend.
5. Update the **Live demo** section in this README.

## Project structure

```text
stockflow/
├── backend/
│   ├── app/
│   │   ├── auth.py
│   │   ├── db.py
│   │   ├── index.py
│   │   ├── main.py
│   │   └── security.py
│   ├── tests/
│   │   └── test_api_smoke.py
│   ├── Dockerfile
│   └── requirements.txt
├── docs/
│   ├── DEPLOYMENT_NOTES.md
│   └── TECHNICAL_DOCUMENTATION.md
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
└── README.md
```

## Main business flows

### Admin

- create, edit and delete products
- manage stock movements
- manage staff directory, roles, titles and statuses
- sync demo data
- inspect audit logs
- review dashboard analytics

### Employee

- sign in
- update personal profile information
- create sales
- view catalog, sales, movements and logs

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
