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

    // After sync, check for auto-bump jobs.
    if (Date.now() - queueStart < QUEUE_LIMIT_MS) {
      await checkForBumpJob(config);
    }

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
      func: async (maxIterations, pulseWaitMs, stableThreshold) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        // Accumulator — survives DOM virtualisation between iterations
        const accumulated = new Map(); // groupId → { groupId, name, iconUrl }

        // ── Stop-word boundary detection ──────────────────────────────────
        // Facebook appends "Suggested for you" / "הצעות עבורך" sections BELOW
        // the user's real joined groups. Once we see these headers we must
        // stop collecting — everything after is suggested/promotional content.
        const STOP_WORDS = [
          "suggested",
          "more to discover",
          "הצעות עבורך",
          "קבוצות שאתה עשוי לאהוב",
          "קבוצות מוצעות",
        ];
        let hitBoundary = false;

        function checkBoundary() {
          if (hitBoundary) return true;
          const headings = document.querySelectorAll(
            'h2, h3, h4, [role="heading"], span[dir="auto"]'
          );
          for (const h of headings) {
            const text = (h.textContent ?? "").trim().toLowerCase();
            if (!text) continue;
            for (const stop of STOP_WORDS) {
              if (text.includes(stop.toLowerCase())) {
                console.log(
                  `[EasyMarketing] ⛔ Boundary hit: "${h.textContent?.trim()}" — stopping collection.`
                );
                hitBoundary = true;
                return true;
              }
            }
          }
          return false;
        }

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
          if (hitBoundary) return; // Don't collect past the boundary

          // ── Strategy 1: <a href="/groups/<numeric>/"> links ──────────────
          for (const link of document.querySelectorAll('a[href*="/groups/"]')) {
            const match = link.href.match(/\/groups\/(\d{5,})\b/);
            if (!match) continue;
            const groupId = match[1];
            if (accumulated.has(groupId)) continue;

            // ── Name: look INSIDE the <a> element first ───────────────────
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

          // ── Strategy 2: data-groupid attributes ──────────────────────────
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

        // ── Dynamic container detection ───────────────────────────────────
        // Facebook renders the groups list inside a custom inner scrollable
        // div. We walk up from a known group link to find the first ancestor
        // whose CSS overflow-y is "auto" or "scroll" AND that is actually
        // taller than its viewport (i.e. it has overflow content).
        // Falls back to document.documentElement if none is found.
        function findScrollContainer() {
          const links = document.querySelectorAll('a[href*="/groups/"]');
          for (const link of links) {
            let el = link.parentElement;
            while (el && el !== document.body) {
              const oy = window.getComputedStyle(el).overflowY;
              if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight) {
                return el;
              }
              el = el.parentElement;
            }
          }
          return document.documentElement;
        }

        // Initial capture (groups already in viewport on page load)
        extractVisible();
        console.log(`[EasyMarketing] Initial: ${accumulated.size} group(s)`);

        let stableCount = 0;
        let lastSize = accumulated.size;

        for (let i = 0; i < maxIterations; i++) {
          // Check if we've scrolled past the joined groups into the
          // "Suggested" section — if so, stop immediately.
          if (checkBoundary()) {
            console.log(
              `[EasyMarketing] Stopping at iteration ${i + 1} — boundary reached (total: ${accumulated.size})`
            );
            break;
          }

          // ── Pulse scroll (two-stage) ──────────────────────────────────
          // Stage 1: anchor-scroll the last visible group link into view.
          //   This triggers FB's IntersectionObserver and nudges the lazy
          //   loader to begin fetching the next batch.
          const allGroupLinks = [
            ...document.querySelectorAll('a[href*="/groups/"]'),
          ].filter((el) => /\/groups\/(\d{5,})\b/.test(el.href));
          const lastEl = allGroupLinks[allGroupLinks.length - 1];
          if (lastEl) {
            lastEl.scrollIntoView({ behavior: "smooth", block: "end" });
          }
          await sleep(pulseWaitMs); // wait for stage-1 lazy-load

          // Collect whatever rendered between stage 1 and stage 2.
          extractVisible();

          // Stage 2: force-scroll the actual container another 1000 px.
          //   Even if no new links appeared yet, this guarantees the
          //   viewport moves past any "false floor" that FB rendered as
          //   a spacer while the real next batch is still loading.
          const container = findScrollContainer();
          container.scrollTop += 1000;
          await sleep(pulseWaitMs); // wait for stage-2 lazy-load

          const sizeBefore = accumulated.size;
          extractVisible();
          const added = accumulated.size - sizeBefore;
          console.log(
            `[EasyMarketing] Iter ${i + 1}/${maxIterations}: +${added} new (total: ${accumulated.size})`
          );

          if (accumulated.size === lastSize) {
            stableCount++;
            console.log(
              `[EasyMarketing] No new groups — patience ${stableCount}/${stableThreshold}`
            );
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
      // maxIterations=200, pulseWaitMs=3 s (×2 per iter = 6 s total),
      // stableThreshold=8 (~48 s of patience before giving up)
      args: [200, 3000, 8],
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

// ── Auto-bump ────────────────────────────────────────────────────────────────
// Called after post queue and sync jobs drain. Checks for published posts that
// have auto_bump_enabled and are due for a bump comment. Opens the Facebook
// post permalink, finds the comment box, types a short randomised string, and
// submits it to push the post back up in the group feed.

const BUMP_STRINGS = [
  "Up", ".", "רלוונטי", "bump", "עדיין רלוונטי",
  "מעדכן", "פעיל", "relevant", "still available",
];

async function checkForBumpJob(config) {
  const { apiBaseUrl, extensionSecret } = config;

  let bump;
  try {
    const res = await fetch(`${apiBaseUrl}/api/extension/pending-bumps`, {
      headers: { "x-extension-secret": extensionSecret },
    });
    if (!res.ok) return;
    const data = await res.json();
    bump = data.bump;
  } catch {
    return; // Best-effort — don't block on network errors
  }

  if (!bump) return;

  console.log(`[EasyMarketing] Bump job found — post ${bump.postId}, target ${bump.targetId}`);

  // Build the permalink: if we have a facebook_post_id, navigate directly.
  // Otherwise fall back to the group page (less reliable for bumping).
  const url = bump.facebookPostId
    ? `https://www.facebook.com/${bump.facebookPostId}`
    : bump.targetId
    ? `https://www.facebook.com/groups/${bump.targetId}`
    : null;

  if (!url) {
    console.warn("[EasyMarketing] No URL for bump — skipping.");
    return;
  }

  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: true });
  } catch (err) {
    console.error("[EasyMarketing] Failed to open bump tab:", err.message);
    return;
  }

  try {
    await waitForTabLoad(tab.id, 30_000);
  } catch {
    chrome.tabs.remove(tab.id).catch(() => {});
    return;
  }

  // Let the Facebook SPA settle
  await sleep(5000);

  // Pick a random bump string
  const bumpText = BUMP_STRINGS[Math.floor(Math.random() * BUMP_STRINGS.length)];

  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: async (text) => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

        // ── Find the comment input box ────────────────────────────────
        // Facebook uses different selectors depending on layout. We try
        // multiple strategies to find the first available comment input.
        const selectors = [
          '[aria-label="Write a comment"]',
          '[aria-label="Write a comment…"]',
          '[aria-label="כתיבת תגובה"]',
          '[aria-label="כתיבת תגובה…"]',
          '[contenteditable="true"][role="textbox"]',
          'div[data-testid="UFI2CommentInput/comment_input"]',
        ];

        let commentBox = null;
        for (const sel of selectors) {
          commentBox = document.querySelector(sel);
          if (commentBox) break;
        }

        if (!commentBox) {
          // Try clicking the "Write a comment" prompt to open the input
          const prompts = document.querySelectorAll('[role="button"]');
          for (const p of prompts) {
            const t = (p.textContent ?? "").trim().toLowerCase();
            if (
              t.includes("write a comment") ||
              t.includes("כתיבת תגובה") ||
              t.includes("comment")
            ) {
              p.click();
              await sleep(2000);
              break;
            }
          }

          // Retry finding the input after clicking
          for (const sel of selectors) {
            commentBox = document.querySelector(sel);
            if (commentBox) break;
          }
        }

        if (!commentBox) {
          return { success: false, error: "Comment box not found" };
        }

        // ── Focus and type into the comment box ─────────────────────
        commentBox.focus();
        await sleep(500);

        // Facebook uses Lexical/Draft.js — we must dispatch events properly
        // so the React state picks up the text. We use execCommand for
        // compatibility (similar to the posting flow).
        document.execCommand("insertText", false, text);
        await sleep(1000);

        // ── Submit the comment ──────────────────────────────────────
        // Press Enter to submit
        const enterEvent = new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        });
        commentBox.dispatchEvent(enterEvent);
        await sleep(2000);

        return { success: true };
      },
      args: [bumpText],
    });

    if (result?.success) {
      console.log(`[EasyMarketing] Bump comment posted: "${bumpText}"`);
    } else {
      console.warn("[EasyMarketing] Bump failed:", result?.error ?? "unknown error");
    }
  } catch (err) {
    console.error("[EasyMarketing] Bump execution error:", err.message);
  }

  chrome.tabs.remove(tab.id).catch(() => {});
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
