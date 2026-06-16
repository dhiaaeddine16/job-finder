Profiles feature added

- New DB migration: dashboard/prisma/migrations/20260615_add_profiles_table.sql
- API endpoints: GET/POST/PUT/DELETE at /api/profiles (see dashboard/src/app/api/profiles/route.ts)
- UI page: /profiles at dashboard/src/app/profiles/page.tsx

Storage choices: JSONB-backed profiles table (projects/jobs/education/certifications stored as JSONB, skills as text[]). This keeps the schema simple and flexible for now.

How to run migration (example):
- psql $DATABASE_URL -f dashboard/prisma/migrations/20260615_add_profiles_table.sql

Follow-ups:
- Add validations and server-side schema checks
- Optionally add avatar_url if you want profile pictures
