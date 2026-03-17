-- ============================================================
-- EasyMarketing - Initial Database Schema
-- Run this in your Supabase SQL Editor (Settings > SQL Editor)
-- ============================================================

-- Enable UUID extension (usually already enabled in Supabase)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. PROFILES
-- Extends Supabase Auth users with app-specific data
-- ============================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name   TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Auto-create a profile row when a new user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'avatar_url'
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ============================================================
-- 2. FACEBOOK TOKENS
-- Long-lived page/group access tokens per user
-- ============================================================
CREATE TABLE IF NOT EXISTS public.facebook_tokens (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  page_id          TEXT NOT NULL,
  page_name        TEXT,
  access_token     TEXT NOT NULL,        -- Store encrypted in production
  token_expires_at TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, page_id)
);

-- ============================================================
-- 3. POST STATUS ENUM
-- ============================================================
DO $$ BEGIN
  CREATE TYPE public.post_status AS ENUM ('draft', 'scheduled', 'published', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 4. POSTS
-- All composed posts — immediate or scheduled
-- ============================================================
CREATE TABLE IF NOT EXISTS public.posts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  facebook_token_id  UUID REFERENCES public.facebook_tokens(id) ON DELETE SET NULL,
  content            TEXT NOT NULL,
  image_url          TEXT,
  link_url           TEXT,
  status             public.post_status NOT NULL DEFAULT 'draft',
  scheduled_at       TIMESTAMPTZ,          -- NULL = immediate publish
  published_at       TIMESTAMPTZ,
  facebook_post_id   TEXT,                 -- Returned by Graph API after publish
  error_message      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for the cron job query: find all due scheduled posts
CREATE INDEX IF NOT EXISTS idx_posts_scheduled
  ON public.posts (status, scheduled_at)
  WHERE status = 'scheduled';

-- ============================================================
-- 5. LINKS
-- Short trackable links (WhatsApp redirect, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.links (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL UNIQUE,       -- e.g. "abc123" → /r/abc123
  destination  TEXT NOT NULL,              -- Full destination URL
  label        TEXT,                       -- Friendly label (Hebrew supported)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast slug lookups on redirect edge route
CREATE INDEX IF NOT EXISTS idx_links_slug ON public.links (slug);

-- ============================================================
-- 6. LINK CLICKS
-- One row per click — raw analytics data
-- ============================================================
CREATE TABLE IF NOT EXISTS public.link_clicks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  link_id     UUID NOT NULL REFERENCES public.links(id) ON DELETE CASCADE,
  clicked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash     TEXT,          -- SHA-256 of IP — never store raw IPs
  user_agent  TEXT,
  country     TEXT           -- Optional: from edge geo header (Vercel: x-vercel-ip-country)
);

-- Index for analytics aggregations by link
CREATE INDEX IF NOT EXISTS idx_link_clicks_link_id
  ON public.link_clicks (link_id, clicked_at DESC);

-- ============================================================
-- 7. ROW LEVEL SECURITY (RLS)
-- Each user can only see their own data
-- ============================================================

ALTER TABLE public.profiles        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.facebook_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.links           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_clicks     ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- facebook_tokens
CREATE POLICY "Users can manage own tokens"
  ON public.facebook_tokens FOR ALL
  USING (auth.uid() = user_id);

-- posts
CREATE POLICY "Users can manage own posts"
  ON public.posts FOR ALL
  USING (auth.uid() = user_id);

-- links
CREATE POLICY "Users can manage own links"
  ON public.links FOR ALL
  USING (auth.uid() = user_id);

-- link_clicks: public insert (redirect route), restricted select
CREATE POLICY "Anyone can insert a click"
  ON public.link_clicks FOR INSERT
  WITH CHECK (true);

CREATE POLICY "Users can view clicks on own links"
  ON public.link_clicks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.links
      WHERE links.id = link_clicks.link_id
        AND links.user_id = auth.uid()
    )
  );

-- ============================================================
-- 8. SERVICE ROLE BYPASS (for cron job / server-side)
-- The cron job uses SUPABASE_SERVICE_ROLE_KEY which bypasses RLS
-- No additional policies needed for that path.
-- ============================================================

-- Done! Your schema is ready.
