-- Migration: add profiles table (JSONB-backed)

CREATE TABLE IF NOT EXISTS profiles (
  id SERIAL PRIMARY KEY,
  full_name TEXT NOT NULL,
  profile_title TEXT,
  profile_description TEXT,
  projects JSONB DEFAULT '[]'::jsonb,
  skills TEXT[] DEFAULT ARRAY[]::text[],
  jobs JSONB DEFAULT '[]'::jsonb,
  education JSONB DEFAULT '[]'::jsonb,
  certifications JSONB DEFAULT '[]'::jsonb,
  github_profile TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Optional index for quick lookup by github_profile
CREATE INDEX IF NOT EXISTS idx_profiles_github ON profiles(github_profile);
