import 'dotenv/config';
import { getBrowser, closeBrowser, postToGroup } from './publisher.js';
import {
  resetStuckPosts,
  claimNextPost,
  markPublished,
  markFailed,
  rescheduleWithBackoff,
  recordGroupPost,
  getLastPostedAt,
} from './db.js';
import { sleep, randomBetween } from './utils.js';

// ── Configuration ─────────────────────────────────────────────────────────────
const MAX_RETRIES           = 2;
const BASE_RETRY_DELAY_MS   = 90_000;        // backoff base: 90s → 180s → 360s
const MIN_GROUP_GAP_MS      = 10 * 60_000;   // minimum 10 min between posts to the same group
const POST_TIMEOUT_MS       = 60_000;        // kill a stuck publish attempt after 60 seconds
const BROWSER_RESTART_EVERY = 12;           // restart browser every N posts (memory leak prevention)

// ── Timeout helper ────────────────────────────────────────────────────────────
/**
 * Race a promise against a deadline.
 * Rejects with Error('TIMEOUT') if the promise doesn't settle within ms.
 */
function withTimeout(promise, ms = POST_TIMEOUT_MS) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('TIMEOUT')), ms)
    ),
  ]);
}

// ── Interactive setup mode ────────────────────────────────────────────────────
// Run with: DISPLAY=:99 node src/index.js --setup
// Opens a visible browser window so you can log into Facebook once.
// The session (cookies) is saved to /home/ubuntu/fb-session automatically.
// Press Ctrl+C when done logging in.
if (process.argv.includes('--setup')) {
  console.log('[setup] Opening Facebook in a browser window.');
  console.log('[setup] Log in to your account, then press Ctrl+C when done.');
  const ctx = await getBrowser(false /* headful */);
  const page = await ctx.newPage();
  await page.goto('https://www.facebook.com');
  await new Promise(() => {});  // block until Ctrl+C
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────
process.on('SIGINT',  async () => { console.log('[worker] SIGINT — shutting down'); await closeBrowser(); process.exit(0); });
process.on('SIGTERM', async () => { console.log('[worker] SIGTERM — shutting down'); await closeBrowser(); process.exit(0); });

// ── Main loop ─────────────────────────────────────────────────────────────────
async function main() {
  console.log('[worker] ===== Facebook Group Publisher started (single instance) =====');

  // Warm up the browser and clear any posts left in "processing" from a previous crash
  await getBrowser();
  await resetStuckPosts();

  let postsProcessedSinceRestart = 0;

  while (true) {
    try {
      const post = await claimNextPost();

      // Nothing due — wait before polling again
      if (!post) {
        const pollDelay = randomBetween(60_000, 90_000);
        console.log(`[worker] No posts due. Next poll in ${Math.round(pollDelay / 1000)}s`);
        await sleep(pollDelay);
        continue;
      }

      console.log(`[worker] Claimed post=${post.id} group=${post.target_id} retry=${post.retry_count}`);

      // ── Memory leak prevention: restart browser every N posts ────────────
      if (postsProcessedSinceRestart >= BROWSER_RESTART_EVERY) {
        console.log(`[worker] Restarting browser after ${BROWSER_RESTART_EVERY} posts (memory reset)`);
        await closeBrowser();
        await getBrowser();
        postsProcessedSinceRestart = 0;
      }

      // ── Per-group gap enforcement ─────────────────────────────────────────
      const sinceLastPost = Date.now() - getLastPostedAt(post.target_id);
      if (sinceLastPost < MIN_GROUP_GAP_MS) {
        const wait = MIN_GROUP_GAP_MS - sinceLastPost;
        console.log(`[worker] Group ${post.target_id} was posted to recently — rescheduling in ${Math.round(wait / 1000)}s`);
        await rescheduleWithBackoff(post.id, post.retry_count, wait);
        continue;
      }

      // ── Publish with timeout ──────────────────────────────────────────────
      let success = false;
      let lastError = '';

      try {
        await withTimeout(
          postToGroup(post.id, post.target_id, post.content, post.image_urls ?? []),
          POST_TIMEOUT_MS
        );
        success = true;

      } catch (err) {
        lastError = err.message;
        console.warn(
          `[worker] post=${post.id} group=${post.target_id} failed ` +
          `(attempt ${post.retry_count + 1}/${MAX_RETRIES + 1}): ${lastError}`
        );

        // Fatal errors — worker must stop, operator must intervene
        if (lastError.includes('SESSION_EXPIRED')) {
          console.error('[worker] FATAL SESSION_EXPIRED — run "npm run setup" to re-login. Stopping.');
          await closeBrowser();
          process.exit(1);
        }
        if (lastError.includes('FACEBOOK_BLOCKED')) {
          console.error('[worker] FATAL FACEBOOK_BLOCKED — manual review required. Stopping.');
          await closeBrowser();
          process.exit(2);
        }

        // Recoverable errors (TIMEOUT, selector not found, etc.) — retry with backoff
        if (post.retry_count < MAX_RETRIES) {
          await rescheduleWithBackoff(post.id, post.retry_count, BASE_RETRY_DELAY_MS);
          console.log(`[worker] post=${post.id} rescheduled for retry ${post.retry_count + 1}`);
        } else {
          await markFailed(post.id, `Max retries (${MAX_RETRIES}) reached. Last error: ${lastError}`);
          console.error(`[worker] ✗ post=${post.id} permanently failed`);
        }
      }

      if (success) {
        await markPublished(post.id);
        recordGroupPost(post.target_id);
        postsProcessedSinceRestart++;
        console.log(`[worker] ✓ post=${post.id} published to group=${post.target_id}`);
      }

      // ── Anti-ban delay between consecutive posts ───────────────────────────
      const postDelay = randomBetween(120_000, 300_000);
      console.log(`[worker] Next post in ${Math.round(postDelay / 60_000)} min`);
      await sleep(postDelay);

    } catch (loopErr) {
      console.error('[worker] Unexpected loop error:', loopErr.message);
      await sleep(30_000);
    }
  }
}

main().catch(err => {
  console.error('[worker] Fatal startup error:', err);
  process.exit(1);
});
