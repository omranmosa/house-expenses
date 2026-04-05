# House Expense Tracker

Two house workers (تحسين and Biswajit) submit receipt photos. Claude AI extracts expense data. Manager views reports with spending analytics.

## Architecture

- **Frontend**: React + Vite → Vercel
- **Backend**: Node.js + Express → Railway
- **Database**: Supabase (PostgreSQL)
- **Storage**: Supabase Storage (receipt images)
- **AI**: Anthropic Claude API (vision) for receipt scanning

## Environment Variables

### Backend (`/backend/.env`)
```
ANTHROPIC_API_KEY=       # From console.anthropic.com
SUPABASE_URL=            # Your Supabase project URL
SUPABASE_SERVICE_KEY=    # Supabase service role key
MANAGER_PASSWORD=omran2026
HOUSEHOLD_SIZE=5
PORT=3001
```

### Frontend (`/frontend/.env`)
```
VITE_API_URL=            # Backend URL (e.g. https://your-app.railway.app)
```

## Supabase Setup

1. Create a new Supabase project
2. Run the SQL in `backend/schema.sql` in the SQL editor
3. Create a storage bucket called `receipts` (public)

## Local Development

```bash
# Backend
cd backend && npm install && npm run dev

# Frontend
cd frontend && npm install && npm run dev
```

## Deployment

- **Backend**: Push to GitHub → connect repo to Railway → set env vars → deploy
- **Frontend**: Push to GitHub → connect repo to Vercel → set root to `frontend` → set env vars → deploy
