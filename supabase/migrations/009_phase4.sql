-- Migration 009: Phase 4 — Templates, Synced Groups, Sync Jobs
-- Run in Supabase SQL Editor.

-- ── 1. Templates support on posts ─────────────────────────────────────────────
ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS is_template BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_posts_templates
  ON public.posts (user_id, is_template)
  WHERE is_template = TRUE;

-- ── 2. Synced Facebook groups ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.facebook_groups (
  id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  group_id  TEXT        NOT NULL,     -- numeric Facebook Group ID stored as text
  name      TEXT        NOT NULL,
  icon_url  TEXT,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, group_id)          -- upsert key
);

ALTER TABLE public.facebook_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "fb_groups_select"
  ON public.facebook_groups FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "fb_groups_insert"
  ON public.facebook_groups FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "fb_groups_update"
  ON public.facebook_groups FOR UPDATE
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "fb_groups_delete"
  ON public.facebook_groups FOR DELETE
  USING (auth.uid() = user_id);

-- ── 3. Sync job queue ─────────────────────────────────────────────────────────
-- Lets the dashboard signal the extension to run a scrape asynchronously.
CREATE TABLE IF NOT EXISTS public.sync_jobs (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type         TEXT        NOT NULL DEFAULT 'facebook_groups',
  status       TEXT        NOT NULL DEFAULT 'pending', -- pending | processing | done | failed
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE public.sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sync_jobs_select"
  ON public.sync_jobs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "sync_jobs_insert"
  ON public.sync_jobs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "sync_jobs_update"
  ON public.sync_jobs FOR UPDATE
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "sync_jobs_delete"
  ON public.sync_jobs FOR DELETE
  USING (auth.uid() = user_id);
