# StockFlow Technical Documentation

## Purpose
StockFlow is a portfolio-ready inventory and sales management demo designed to present realistic business workflows instead of isolated CRUD screens.

## Architecture
- **Frontend:** React + TypeScript + Vite
- **Backend:** FastAPI + SQLAlchemy
- **Database:** PostgreSQL-ready through `DATABASE_URL`; SQLite fallback for local tests and smoke runs
- **Authentication:** JWT bearer token
- **Roles:** `admin`, `employee`
- **Deployment targets:** Vercel-ready frontend, Vercel/Render-compatible backend, Docker Compose for local development

## Main modules
### Frontend
- `src/App.tsx` — app shell, tabs, forms, responsive navigation, requests
- `src/index.css` — design system, layout, responsive styles
- `src/types.ts` — shared API types

### Backend
- `app/main.py` — API routes and business workflows
- `app/db.py` — models, database setup, seeding, audit log helpers
- `app/auth.py` — auth dependency helpers
- `app/security.py` — password hashing and JWT helpers

## Core entities
- **User** — authenticated operator
- **Product** — catalog item with SKU, stock and minimum stock
- **Sale** / **SaleItem** — customer order with one or more lines
- **StockMovement** — purchase, adjustment, writeoff or sale stock delta
- **AuditLog** — append-only activity log for traceability

## Main business rules
1. Products can be created, edited and deleted.
2. Products with sales history cannot be deleted.
3. Sales can contain multiple items.
4. Creating a sale decreases stock and writes movement rows.
5. Manual stock changes are done through movements to preserve auditability.
6. Key actions write audit log entries visible in the UI.

## Frontend behavior
- Responsive layout for desktop, tablet and mobile
- Collapsible desktop sidebar
- Mobile burger menu with overlay navigation
- Friendly error handling for timeout, auth and backend availability issues
- Transient welcome/success messages

## Environment variables
### Backend
- `DATABASE_URL`
- `JWT_SECRET`
- `CORS_ORIGINS`

### Frontend
- `VITE_API_URL`

## API endpoints
- `POST /api/auth/login`
- `GET /api/me`
- `GET /api/dashboard`
- `GET /api/products`
- `POST /api/products`
- `PUT /api/products/{product_id}`
- `DELETE /api/products/{product_id}`
- `GET /api/sales`
- `POST /api/sales`
- `GET /api/stock-movements`
- `POST /api/stock-movements`
- `GET /api/logs`
- `POST /api/demo/populate`
- `GET /api/health`

## Logging
Two log layers are present:
1. **Application logs** written by the backend process to stdout/stderr for hosting platforms.
2. **Audit logs** stored in the database and displayed inside the UI.

## Testing
Backend smoke tests cover:
- health endpoint
- seeded dashboard data
- create/edit/delete product flow
- rejection of product deletion with sales history
- duplicate-product validation inside one sale
- idempotent demo-population endpoint
- audit log endpoint availability
