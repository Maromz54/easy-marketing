-- Add 'processing' status for posts claimed by the Chrome extension
-- This prevents the extension from picking up the same post twice if
-- the alarm fires again before the browser has finished posting.
ALTER TYPE public.post_status ADD VALUE IF NOT EXISTS 'processing';
