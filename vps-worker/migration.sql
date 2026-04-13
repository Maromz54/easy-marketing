-- ============================================================
-- VPS Playwright Worker — Database Migration
-- Run this in Supabase Dashboard → SQL Editor before deploying.
-- ============================================================

-- 1. Add retry_count column (tracks how many times a post was retried)
alter table posts add column if not exists retry_count integer not null default 0;

-- 2. Atomic claim function using FOR UPDATE SKIP LOCKED
--    Prevents duplicate processing even if two worker instances somehow run.
create or replace function claim_next_group_post()
returns table (
  id uuid,
  content text,
  image_urls text[],
  link_url text,
  target_id text,
  batch_id uuid,
  retry_count integer
)
language plpgsql
as $$
begin
  return query
  update posts
  set status = 'processing'
  where id = (
    select id from posts
    where status = 'scheduled'
      and scheduled_at <= now()
      and facebook_token_id is null   -- VPS worker owns null-token group posts
      and target_id is not null
    order by scheduled_at asc
    limit 1
    for update skip locked           -- skip rows locked by concurrent transactions
  )
  returning id, content, image_urls, link_url, target_id, batch_id, retry_count;
end;
$$;
