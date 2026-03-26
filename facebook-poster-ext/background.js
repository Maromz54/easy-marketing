// ─────────────────────────────────────────────────────────────────────────────
// EasyMarketing Facebook Poster — Background Service Worker (MV3)
//
// Flow every minute (via chrome.alarms):
//   1. runQueue() drains ALL due posts before the next alarm fires.
//      After each post (success or failure) it immediately fetches the next
//      one — no 60-second wait between posts in the same batch.
//   2. After the queue is empty, checkForSyncJob() picks up any pending
//      group-sync requests from the dashboard.
// ─────────────────────────────────────────────────────────────────────────────

const ALARM_NAME       = "easy-marketing-poll";
const QUEUE_LIMIT_MS   = 10 * 60 * 1000; // 10-minute safety valve

// Prevents two alarm fires from running the queue concurrently.
let _queueRunning = false;

// ── Bootstrap ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  console.log("[EasyMarketing] Extension installed — alarm created.");
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
});

// ── Alarm handler ────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME && !_queueRunning) runQueue();
});

// ── Queue runner ─────────────────────────────────────────────────────────────
// Processes ALL due posts sequentially before releasing the lock.

async function runQueue() {
  if (_queueRunning) return;
  _queueRunning = true;
  const queueStart = Date.now();

  try {
    const { apiBaseUrl, extensionSecret } = await chrome.storage.sync.get([
      "apiBaseUrl",
      "extensionSecret",
    ]);

    if (!apiBaseUrl || !extensionSecret) {
      console.log("[EasyMarketing] Not configured — open the extension popup to set API URL and secret.");
      return;
    }

    const config = { apiBaseUrl, extensionSecret };

    // Keep processing posts until the queue is empty or the time limit is hit.
    while (Date.now() - queueStart < QUEUE_LIMIT_MS) {
      const hadPost = await checkAndPost(config);
      if (!hadPost) break; // Queue empty — exit the loop
    }

    if (Date.now() - queueStart >= QUEUE_LIMIT_MS) {
      console.warn("[EasyMarketing] Queue time limit reached — stopping to avoid runaway loop.");
    }

    // After the post queue drains, pick up any pending group-sync jobs.
    await checkForSyncJob(config);

  } finally {
    _queueRunning = false;
  }
}

// ── Core post-processing logic ────────────────────────────────────────────────
// Returns true if a post was processed (success or failure), false if the
// queue was empty (no post returned from /api/extension/pending).

async function checkAndPost(config) {
  const { apiBaseUrl, extensionSecret } = config;

  // 1. Poll for a pending post
  let post;
  try {
    const res = await fetch(`${apiBaseUrl}/api/extension/pending`, {
      headers: { "x-extension-secret": extensionSecret },
    });
    if (!res.ok) {
      console.error("[EasyMarketing] pending API error:", res.status);
      return false;
    }
    const data = await res.json();
    post = data.post;
  } catch (err) {
    console.error("[EasyMarketing] Network error polling pending:", err);
    return false;
  }

  if (!post) {
    console.log("[EasyMarketing] No pending posts.");
    return false;
  }

  console.log("[EasyMarketing] Claiming post:", post.id, "→ target:", post.target_id);

  // 2. Validate — extension only handles posts with a target_id (group / page ID)
  if (!post.target_id) {
    await markPost(apiBaseUrl, extensionSecret, post.id, "failed",
      "Extension requires a Target ID (group or page). Set target_id in the post composer.");
    return true; // Post was processed (even if failed)
  }

  const targetUrl = `https://www.facebook.com/groups/${post.target_id}`;

  // 3. Open Facebook tab — MUST be active so execCommand gets a real focused
  //    document. Chrome silently ignores execCommand in background tabs.
  let tab;
  try {
    tab = await chrome.tabs.create({ url: targetUrl, active: true });
  } catch (err) {
    await markPost(apiBaseUrl, extensionSecret, post.id, "failed", "Failed to open Facebook tab: " + err.message);
    return true;
  }

  // 4. Wait for the tab to fully load (or timeout after 30 s)
  try {
    await waitForTabLoad(tab.id, 30_000);
  } catch (err) {
    chrome.tabs.remove(tab.id).catch(() => {});
    await markPost(apiBaseUrl, extensionSecret, post.id, "failed", err.message);
    return true;
  }

  // Extra settling time — Facebook's SPA needs a moment after 'complete'.
  await sleep(5000);

  // 5a-pre. Pre-fetch all images in the background service worker (parallel).
  //   Facebook's CSP blocks content scripts from fetching external URLs directly.
  //   The service worker has no CSP restrictions, so we fetch here and pass the
  //   results as an array of base64 data URIs to the content script.
  const imageUrls = post.image_urls ?? [];
  let imageDataUris = [];
  if (imageUrls.length > 0) {
    console.log(`[EasyMarketing] Pre-fetching ${imageUrls.length} image(s) in parallel (CSP bypass)...`);
    imageDataUris = await Promise.all(imageUrls.map(fetchImageAsDataUri));
    const successCount = imageDataUris.filter(Boolean).length;
    console.log(`[EasyMarketing] Images pre-fetched: ${successCount}/${imageUrls.length} succeeded.`);
    imageDataUris = imageDataUris.filter(Boolean);
  }

  // 5a. Inject content.js into the page (defines window.easyMarketingPost).
  //     world: "MAIN" lets it share the page's window/React state with Lexical.
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
      world: "MAIN",
    });
  } catch (err) {
    chrome.tabs.remove(tab.id).catch(() => {});
    await markPost(apiBaseUrl, extensionSecret, post.id, "failed",
      "content.js injection failed: " + err.message);
    return true;
  }

  // 5b. Call window.easyMarketingPost() with the post data.
  let execResult;
  try {
    execResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: (c, urls, l, dataUris) => window.easyMarketingPost(c, urls, l, dataUris),
      args: [post.content, imageUrls, post.link_url ?? null, imageDataUris],
    });
  } catch (err) {
    chrome.tabs.remove(tab.id).catch(() => {});
    await markPost(apiBaseUrl, extensionSecret, post.id, "failed",
      "executeScript (call) failed: " + err.message);
    return true;
  }

  const scriptResult = execResult?.[0]?.result;

  if (scriptResult?.success) {
    console.log("[EasyMarketing] Post published successfully:", post.id);
    chrome.tabs.remove(tab.id).catch(() => {});
    await markPost(apiBaseUrl, extensionSecret, post.id, "published");
  } else if (scriptResult?.imageInjectionFailed) {
    const errMsg = scriptResult?.error ?? "Image injection failed";
    console.error(`[EasyMarketing] Image injection failed (${imageUrls.length} image(s)) — tab LEFT OPEN for inspection:`, errMsg);
    // Tab intentionally NOT closed — user needs to inspect the dialog.
    await markPost(apiBaseUrl, extensionSecret, post.id, "failed", errMsg);
  } else {
    const errMsg = scriptResult?.error ?? "Unknown error in content script";
    console.error("[EasyMarketing] Posting failed — tab left open for inspection:", errMsg);
    await markPost(apiBaseUrl, extensionSecret, post.id, "failed", errMsg);
  }

  return true; // A post was processed
}

// ── Group sync ────────────────────────────────────────────────────────────────
// Called after the post queue drains. Checks for a pending sync job from the
// dashboard and, if found, scrapes the user's Facebook groups page.

async function checkForSyncJob(config) {
  const { apiBaseUrl, extensionSecret } = config;

  let job;
  try {
    const res = await fetch(`${apiBaseUrl}/api/extension/sync-check`, {
      headers: { "x-extension-secret": extensionSecret },
    });
    if (!res.ok) return;
    const data = await res.json();
    job = data.job;
  } catch {
    return; // Sync check is best-effort — don't block on network errors
  }

  if (!job) return;

  console.log("[EasyMarketing] Sync job found — opening Facebook groups page...");

  let tab;
  try {
    tab = await chrome.tabs.create({
      url: "https://www.facebook.com/groups/feed/",
      active: false,
    });
  } catch (err) {
    console.error("[EasyMarketing] Failed to open groups tab:", err.message);
    return;
  }

  try {
    await waitForTabLoad(tab.id, 30_000);
  } catch {
    chrome.tabs.remove(tab.id).catch(() => {});
    return;
  }

  // Let the Facebook SPA render
  await sleep(5000);

  // Scroll 3× to trigger lazy-loaded groups
  for (let i = 0; i < 3; i++) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.scrollTo(0, document.body.scrollHeight),
    }).catch(() => {});
    await sleep(2000);
  }

  // Scrape all group links with numeric IDs
  let groups = [];
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const results = [];
        const seen = new Set();
        for (const link of document.querySelectorAll('a[href*="/groups/"]')) {
          const match = link.href.match(/\/groups\/(\d{5,})\//);
          if (!match) continue;
          const groupId = match[1];
          if (seen.has(groupId)) continue;
          seen.add(groupId);
          const container = link.closest('[role="listitem"]') ?? link.parentElement;
          const heading = container?.querySelector('[role="heading"], span[dir="auto"]');
          const name = heading?.textContent?.trim() || link.textContent?.trim() || `Group ${groupId}`;
          const img = container?.querySelector("img[src]");
          results.push({ groupId, name, iconUrl: img?.src ?? null });
        }
        return results;
      },
    });
    groups = result ?? [];
  } catch (err) {
    console.error("[EasyMarketing] Scrape error:", err.message);
  }

  chrome.tabs.remove(tab.id).catch(() => {});
  console.log(`[EasyMarketing] Scraped ${groups.length} group(s) — uploading to server...`);

  try {
    await fetch(`${apiBaseUrl}/api/extension/sync-groups`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-extension-secret": extensionSecret,
      },
      body: JSON.stringify({ jobId: job.id, groups }),
    });
    console.log("[EasyMarketing] Group sync complete ✓");
  } catch (err) {
    console.error("[EasyMarketing] Failed to upload groups:", err.message);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForTabLoad(tabId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error(`Tab ${tabId} did not finish loading within ${timeoutMs / 1000}s`));
    }, timeoutMs);

    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Fetch a URL and return a base64 data URI string (e.g. "data:image/jpeg;base64,...")
// Runs in the service worker — no page CSP applies here.
async function fetchImageAsDataUri(url) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error("[EasyMarketing] fetchImageAsDataUri: HTTP", response.status, url);
      return null;
    }
    const blob = await response.blob();
    const mimeType = blob.type || "image/jpeg";
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return `data:${mimeType};base64,${btoa(binary)}`;
  } catch (e) {
    console.error("[EasyMarketing] fetchImageAsDataUri error:", e.message);
    return null;
  }
}

async function markPost(apiBaseUrl, extensionSecret, postId, status, error) {
  try {
    await fetch(`${apiBaseUrl}/api/extension/update`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-extension-secret": extensionSecret,
      },
      body: JSON.stringify({ postId, status, error }),
    });
  } catch (err) {
    console.error("[EasyMarketing] Failed to update post status:", err);
  }
}
