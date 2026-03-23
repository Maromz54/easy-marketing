// ─────────────────────────────────────────────────────────────────────────────
// EasyMarketing Facebook Poster — Background Service Worker (MV3)
//
// Flow every minute (via chrome.alarms):
//   1. Call GET /api/extension/pending → server atomically marks post 'processing'
//   2. Open Facebook group tab (hidden / inactive)
//   3. Wait for tab to finish loading
//   4. Inject postToFacebookGroup() into the page via chrome.scripting.executeScript
//   5. Call POST /api/extension/update with published / failed
//   6. Close the tab
// ─────────────────────────────────────────────────────────────────────────────

const ALARM_NAME = "easy-marketing-poll";

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
  if (alarm.name === ALARM_NAME) checkAndPost();
});

// ── Core logic ───────────────────────────────────────────────────────────────

async function checkAndPost() {
  const { apiBaseUrl, extensionSecret } = await chrome.storage.sync.get([
    "apiBaseUrl",
    "extensionSecret",
  ]);

  if (!apiBaseUrl || !extensionSecret) {
    console.log("[EasyMarketing] Not configured — open the extension popup to set API URL and secret.");
    return;
  }

  // 1. Poll for a pending post
  let post;
  try {
    const res = await fetch(`${apiBaseUrl}/api/extension/pending`, {
      headers: { "x-extension-secret": extensionSecret },
    });
    if (!res.ok) {
      console.error("[EasyMarketing] pending API error:", res.status);
      return;
    }
    const data = await res.json();
    post = data.post;
  } catch (err) {
    console.error("[EasyMarketing] Network error polling pending:", err);
    return;
  }

  if (!post) {
    console.log("[EasyMarketing] No pending posts.");
    return;
  }

  console.log("[EasyMarketing] Claiming post:", post.id, "→ target:", post.target_id);

  // 2. Validate — extension only handles posts with a target_id (group / page ID)
  if (!post.target_id) {
    await markPost(apiBaseUrl, extensionSecret, post.id, "failed",
      "Extension requires a Target ID (group or page). Set target_id in the post composer.");
    return;
  }

  const targetUrl = `https://www.facebook.com/groups/${post.target_id}`;

  // 3. Open Facebook tab — MUST be active so execCommand gets a real focused
  //    document. Chrome silently ignores execCommand in background tabs.
  //    The tab is closed automatically after posting finishes.
  let tab;
  try {
    tab = await chrome.tabs.create({ url: targetUrl, active: true });
  } catch (err) {
    await markPost(apiBaseUrl, extensionSecret, post.id, "failed", "Failed to open Facebook tab: " + err.message);
    return;
  }

  // 4. Wait for the tab to fully load (or timeout after 30 s)
  try {
    await waitForTabLoad(tab.id, 30_000);
  } catch (err) {
    chrome.tabs.remove(tab.id).catch(() => {});
    await markPost(apiBaseUrl, extensionSecret, post.id, "failed", err.message);
    return;
  }

  // Extra settling time — Facebook's SPA needs a moment after 'complete'.
  // Background tabs render slower, so we give it more time.
  await sleep(5000);

  // 5a-pre. Pre-fetch image in the background service worker.
  //   Facebook's CSP blocks content scripts from fetching external URLs directly.
  //   The service worker has no CSP restrictions, so we fetch here and pass the
  //   result as a base64 data URI to the content script as a 4th argument.
  let imageDataUri = null;
  if (post.image_url) {
    console.log("[EasyMarketing] Pre-fetching image (CSP bypass):", post.image_url);
    imageDataUri = await fetchImageAsDataUri(post.image_url);
    if (imageDataUri) {
      console.log("[EasyMarketing] Image pre-fetched ✓ size:", Math.round(imageDataUri.length / 1024), "KB");
    } else {
      console.warn("[EasyMarketing] Image pre-fetch failed — content script will attempt direct fetch as fallback.");
    }
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
    return;
  }

  // 5b. Call window.easyMarketingPost() with the post data.
  let execResult;
  try {
    execResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: (c, i, l, d) => window.easyMarketingPost(c, i, l, d),
      // 4th arg: base64 data URI pre-fetched by the service worker (null if fetch failed).
      args: [post.content, post.image_url ?? null, post.link_url ?? null, imageDataUri],
    });
  } catch (err) {
    chrome.tabs.remove(tab.id).catch(() => {});
    await markPost(apiBaseUrl, extensionSecret, post.id, "failed",
      "executeScript (call) failed: " + err.message);
    return;
  }

  const scriptResult = execResult?.[0]?.result;

  if (scriptResult?.success) {
    console.log("[EasyMarketing] Post published successfully:", post.id);
    chrome.tabs.remove(tab.id).catch(() => {});
    await markPost(apiBaseUrl, extensionSecret, post.id, "published");
  } else if (scriptResult?.imageInjectionFailed) {
    const errMsg = scriptResult?.error ?? "Image injection failed";
    console.error("[EasyMarketing] Image injection failed — tab LEFT OPEN for inspection:", errMsg);
    console.error("[EasyMarketing] Open DevTools on the Facebook tab and filter [EasyMarketing] to see which strategy (S1–S4) ran.");
    // Tab intentionally NOT closed — user needs to inspect the dialog.
    await markPost(apiBaseUrl, extensionSecret, post.id, "failed", errMsg);
  } else {
    const errMsg = scriptResult?.error ?? "Unknown error in content script";
    console.error("[EasyMarketing] Posting failed — tab left open for inspection:", errMsg);
    // Tab intentionally NOT closed so the user can inspect the DOM.
    await markPost(apiBaseUrl, extensionSecret, post.id, "failed", errMsg);
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
// Returns null on any error so callers can fall back gracefully.
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
    // Build base64 in chunks to avoid stack overflow on large images
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
