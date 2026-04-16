# Deployment Notes

## Local
```bash
docker compose up --build
```

## Frontend
Set `VITE_API_URL` to the backend public API base, for example:
```bash
VITE_API_URL=https://your-backend.vercel.app/api
```

## Backend
Set:
```bash
DATABASE_URL=postgresql+psycopg://...
JWT_SECRET=change-me
CORS_ORIGINS=https://your-frontend.vercel.app
```

## Post-deploy checklist
- backend `/api/health` returns `{"status":"ok"}`
- frontend can log in with demo credentials
- dashboard shows seeded data
- creating a product updates the catalog and logs tab
- creating a sale updates stock, sales and logs
