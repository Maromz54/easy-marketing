-- Migration 005: Distribution Lists
-- Stores named groups of Facebook Group IDs per user.
-- group_ids is a Postgres text[] — no join table needed because
-- list membership is always read and written as a complete unit.

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

ALTER TABLE public.distribution_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own distribution lists"
  ON public.distribution_lists FOR ALL
  USING (auth.uid() = user_id);

-- Auto-update updated_at on row changes.
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
