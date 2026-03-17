-- ============================================================
-- Migration 002: Add target_id to posts table
--
-- Purpose: Support posting to Facebook Groups AS A PAGE.
-- When target_id is NULL, the publish engine falls back to the
-- page's own page_id (normal page wall post).
-- When target_id is set, it is the Group ID where the Page is
-- an admin/member — the Page Access Token is used to publish.
--
-- Run this in: Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS target_id TEXT;

COMMENT ON COLUMN public.posts.target_id IS
  'Facebook target for publishing: NULL = the connected Page itself, '
  'or a Group ID where the Page has posting rights. '
  'The Page Access Token (from facebook_tokens) is always used.';
