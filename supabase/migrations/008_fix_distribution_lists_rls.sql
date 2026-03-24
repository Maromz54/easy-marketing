-- Migration 008: Create distribution_lists table + correct RLS policies
--
-- Replaces migration 005 which was never applied in production.
-- Uses IF NOT EXISTS / DROP IF EXISTS throughout so it is safe to re-run.

-- ── Table ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.distribution_lists (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name       TEXT        NOT NULL,
  group_ids  TEXT[]      NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_distribution_lists_user_id
  ON public.distribution_lists (user_id, created_at DESC);

-- ── Auto-update updated_at ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_distribution_lists_updated_at ON public.distribution_lists;
CREATE TRIGGER trg_distribution_lists_updated_at
  BEFORE UPDATE ON public.distribution_lists
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── Row Level Security ────────────────────────────────────────────────────────

ALTER TABLE public.distribution_lists ENABLE ROW LEVEL SECURITY;

-- Drop any stale policies before (re-)creating them.
DROP POLICY IF EXISTS "Users can manage own distribution lists" ON public.distribution_lists;
DROP POLICY IF EXISTS "dist_lists_select"  ON public.distribution_lists;
DROP POLICY IF EXISTS "dist_lists_insert"  ON public.distribution_lists;
DROP POLICY IF EXISTS "dist_lists_update"  ON public.distribution_lists;
DROP POLICY IF EXISTS "dist_lists_delete"  ON public.distribution_lists;

-- SELECT: users may only read their own lists.
CREATE POLICY "dist_lists_select"
  ON public.distribution_lists FOR SELECT
  USING (auth.uid() = user_id);

-- INSERT: the new row's user_id must match the authenticated user.
CREATE POLICY "dist_lists_insert"
  ON public.distribution_lists FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- UPDATE: users may only update their own rows.
CREATE POLICY "dist_lists_update"
  ON public.distribution_lists FOR UPDATE
  USING     (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- DELETE: users may only delete their own rows.
CREATE POLICY "dist_lists_delete"
  ON public.distribution_lists FOR DELETE
  USING (auth.uid() = user_id);
