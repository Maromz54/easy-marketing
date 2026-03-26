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

  // Use the canonical "joined groups" URL with viewer_added ordering so the
  // page renders all groups the user belongs to in a consistent list layout.
  let tab;
  try {
    tab = await chrome.tabs.create({
      url: "https://www.facebook.com/groups/joins/?nav_source=tab&ordering=viewer_added",
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

  // Let the Facebook SPA render before we start scrolling
  await sleep(6000);

  // ── Anchor-scroll extraction ─────────────────────────────────────────────
  // Facebook embeds the groups list in a custom inner scrollable div, so
  // window.scrollBy has no effect. We inject ONE self-contained async function
  // that runs entirely in the page context:
  //   1. extractVisible() harvests all group links currently in the DOM → Map
  //   2. scrollIntoView() on the LAST rendered group card triggers the correct
  //      scrollable ancestor automatically (window OR the inner FB container)
  //   3. Wait 6 s for FB's lazy-loader to render the next batch
  //   4. Repeat until Map.size has been stable for 5 consecutive iterations
  // The Map lives in page context, so virtualised nodes that disappear from the
  // DOM are already captured — nothing is lost between iterations.
  let groups = [];
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      // Chrome MV3 properly awaits Promises returned by async funcs here.
      func: async (maxIterations, waitMs, stableThreshold) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        // Accumulator — survives DOM virtualisation between iterations
        const accumulated = new Map(); // groupId → { groupId, name, iconUrl }

        // Returns true when text looks like descriptive meta-text (member
        // counts, "suggested" labels) rather than a real group name.
        function isMeta(text) {
          if (!text || text.length < 2) return true;
          if (/חברים/.test(text)) return true;         // "81 חברים בקבוצה"
          if (/\bmembers\b/i.test(text)) return true;  // "1,234 members"
          if (/^\d[\d,.\s]*$/.test(text)) return true; // pure number string
          return false;
        }

        function extractVisible() {
          // ── Strategy 1: <a href="/groups/<numeric>/"> links ──────────────
          for (const link of document.querySelectorAll('a[href*="/groups/"]')) {
            const match = link.href.match(/\/groups\/(\d{5,})\b/);
            if (!match) continue;
            const groupId = match[1];
            if (accumulated.has(groupId)) continue;

            // ── Name: look INSIDE the <a> element first ───────────────────
            // FB always places the group title as a descendant of the link.
            // Member-count text (e.g. "81 חברים בקבוצה") lives OUTSIDE the
            // link in a sibling span, so restricting to link descendants
            // eliminates it completely.
            let name = "";

            // P1 — heading / dir="auto" span that is a child of the link
            const innerEl =
              link.querySelector('[role="heading"]') ??
              link.querySelector('span[dir="auto"]');
            if (innerEl) {
              const c = innerEl.textContent?.trim() ?? "";
              if (!isMeta(c)) name = c;
            }

            // P2 — full text content of the link itself
            if (!name) {
              const lt = link.textContent?.trim() ?? "";
              if (lt && !lt.startsWith("http") && !isMeta(lt)) name = lt;
            }

            // P3 — walk up to the enclosing card and look for a heading
            // outside the link, but only accept it if it passes isMeta().
            if (!name) {
              const card =
                link.closest('[role="listitem"]') ??
                link.closest('[role="article"]') ??
                link.closest('[data-visualcompletion]') ??
                link.parentElement?.parentElement?.parentElement;
              const cardEl =
                card?.querySelector('[role="heading"]') ??
                card?.querySelector('span[dir="auto"]');
              const c = cardEl?.textContent?.trim() ?? "";
              if (c && !isMeta(c)) name = c;
            }

            // Final fallback
            if (!name) name = `Group ${groupId}`;

            // ── Icon: search the enclosing card ───────────────────────────
            const card =
              link.closest('[role="listitem"]') ??
              link.closest('[role="article"]') ??
              link.closest('[data-visualcompletion]') ??
              link.parentElement?.parentElement?.parentElement ??
              link.parentElement;
            const img =
              card?.querySelector('img[src*="scontent"]') ??
              card?.querySelector("img[src]");

            accumulated.set(groupId, {
              groupId,
              name,
              iconUrl: img?.getAttribute("src") ?? null,
            });
          }

          // ── Strategy 2: data-groupid attributes (widget / sidebar) ───────
          for (const el of document.querySelectorAll("[data-groupid]")) {
            const groupId = el.getAttribute("data-groupid");
            if (!groupId || !/^\d{5,}$/.test(groupId) || accumulated.has(groupId))
              continue;
            const c = el.textContent?.trim() ?? "";
            const name = !isMeta(c) ? c : `Group ${groupId}`;
            const img = el.querySelector("img[src]");
            accumulated.set(groupId, {
              groupId,
              name,
              iconUrl: img?.src ?? null,
            });
          }
        }

        // Initial capture (groups already in viewport on page load)
        extractVisible();
        console.log(`[EasyMarketing] Initial: ${accumulated.size} group(s)`);

        let stableCount = 0;
        let lastSize = accumulated.size;

        for (let i = 0; i < maxIterations; i++) {
          // Scroll the last known group link into view. scrollIntoView()
          // automatically targets the correct scrollable ancestor — window
          // or an inner FB div — so it works regardless of page layout.
          const allGroupLinks = [
            ...document.querySelectorAll('a[href*="/groups/"]'),
          ].filter((el) => /\/groups\/(\d{5,})\b/.test(el.href));
          const lastEl = allGroupLinks[allGroupLinks.length - 1];
          if (lastEl) {
            lastEl.scrollIntoView({ behavior: "smooth", block: "end" });
          }

          // 6 s wait — generous enough for slow connections and large lists
          await sleep(waitMs);

          const sizeBefore = accumulated.size;
          extractVisible();
          const added = accumulated.size - sizeBefore;
          console.log(
            `[EasyMarketing] Iter ${i + 1}/${maxIterations}: +${added} new (total: ${accumulated.size})`
          );

          if (accumulated.size === lastSize) {
            stableCount++;
            if (stableCount >= stableThreshold) {
              console.log(
                `[EasyMarketing] Stable for ${stableThreshold} iterations — done.`
              );
              break;
            }
          } else {
            stableCount = 0;
            lastSize = accumulated.size;
          }
        }

        return [...accumulated.values()];
      },
      // maxIterations=60, waitMs=6 s, stableThreshold=5 consecutive identical sizes
      args: [60, 6000, 5],
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
