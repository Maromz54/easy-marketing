-- Phase 3: Multiple images + Recurring posts
--
-- Run in Supabase SQL Editor.
-- image_url is kept for backward compatibility with existing rows.

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS image_urls TEXT[] NOT NULL DEFAULT '{}';

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS recurrence_rule TEXT NULL;

-- Index to quickly find posts with an active recurrence rule
CREATE INDEX IF NOT EXISTS idx_posts_recurrence
  ON public.posts (user_id, recurrence_rule)
  WHERE recurrence_rule IS NOT NULL;
