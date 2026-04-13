import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY   // service role bypasses RLS
);

/**
 * On startup: reset any group posts stuck in "processing" state.
 * This is safe because only ONE VPS worker instance runs at a time (pm2 instances=1),
 * so any "processing" null-token post was left there by a previous crash of this worker.
 */
export async function resetStuckPosts() {
  const { error } = await supabase
    .from('posts')
    .update({ status: 'scheduled' })
    .eq('status', 'processing')
    .is('facebook_token_id', null)
    .not('target_id', 'is', null);
  if (error) {
    console.error('[db] resetStuckPosts error:', error.message);
  } else {
    console.log('[db] Stuck group posts reset to "scheduled"');
  }
}

/**
 * Atomically claim the next due group post via a Postgres RPC.
 * The RPC uses FOR UPDATE SKIP LOCKED to prevent any race condition
 * even if somehow two instances run simultaneously.
 * Returns the post row or null if nothing is due.
 */
export async function claimNextPost() {
  const { data, error } = await supabase.rpc('claim_next_group_post');
  if (error) {
    console.error('[db] claimNextPost RPC error:', error.message);
    return null;
  }
  return data?.[0] ?? null;  // RPC returns an array
}

export async function markPublished(postId) {
  console.log(`[db] markPublished post=${postId}`);
  const { error } = await supabase
    .from('posts')
    .update({
      status: 'published',
      published_at: new Date().toISOString(),
      error_message: null,
    })
    .eq('id', postId);
  if (error) console.error('[db] markPublished error:', error.message);
}

export async function markFailed(postId, message) {
  console.error(`[db] markFailed post=${postId}: ${message}`);
  const { error } = await supabase
    .from('posts')
    .update({
      status: 'failed',
      error_message: message,
    })
    .eq('id', postId);
  if (error) console.error('[db] markFailed error:', error.message);
}

/**
 * Reschedule a post for retry with exponential backoff.
 * @param {string} postId
 * @param {number} currentRetryCount  the post's current retry_count value
 * @param {number} baseDelayMs        base delay in ms (doubles each retry)
 */
export async function rescheduleWithBackoff(postId, currentRetryCount, baseDelayMs = 90_000) {
  const delayMs = baseDelayMs * Math.pow(2, currentRetryCount);  // 90s → 180s → 360s
  const nextTime = new Date(Date.now() + delayMs).toISOString();
  console.log(`[db] reschedule post=${postId} retry=${currentRetryCount + 1} in ${Math.round(delayMs / 1000)}s`);
  const { error } = await supabase
    .from('posts')
    .update({
      status: 'scheduled',
      retry_count: currentRetryCount + 1,
      scheduled_at: nextTime,
    })
    .eq('id', postId);
  if (error) console.error('[db] rescheduleWithBackoff error:', error.message);
}

// ── Per-group last-post tracker (in-memory, single process) ──────────────────
const lastPostedAt = new Map();  // groupId (string) → timestamp (ms)

export function recordGroupPost(groupId) {
  lastPostedAt.set(groupId, Date.now());
}

export function getLastPostedAt(groupId) {
  return lastPostedAt.get(groupId) ?? 0;
}
