-- Migration 004: Add 'cancelled' status for posts manually cancelled by the user.
-- PostgreSQL enum values can be added but never removed.
ALTER TYPE public.post_status ADD VALUE IF NOT EXISTS 'cancelled';

-- Partial index for fast lookup of cancelled posts per user.
CREATE INDEX IF NOT EXISTS idx_posts_cancelled
  ON public.posts (user_id, created_at DESC)
  WHERE status = 'cancelled';
