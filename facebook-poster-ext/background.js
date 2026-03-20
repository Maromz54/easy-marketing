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

  // 3. Open Facebook tab (inactive so user's current tab is undisturbed)
  let tab;
  try {
    tab = await chrome.tabs.create({ url: targetUrl, active: false });
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

  // Extra settling time — Facebook's SPA needs a moment after 'complete'
  await sleep(3000);

  // 5. Inject the posting function into the page
  let execResult;
  try {
    execResult = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: postToFacebookGroup,
      args: [post.content, post.image_url ?? null, post.link_url ?? null],
    });
  } catch (err) {
    chrome.tabs.remove(tab.id).catch(() => {});
    await markPost(apiBaseUrl, extensionSecret, post.id, "failed",
      "executeScript failed: " + err.message);
    return;
  }

  const scriptResult = execResult?.[0]?.result;
  chrome.tabs.remove(tab.id).catch(() => {});

  if (scriptResult?.success) {
    console.log("[EasyMarketing] Post published successfully:", post.id);
    await markPost(apiBaseUrl, extensionSecret, post.id, "published");
  } else {
    const errMsg = scriptResult?.error ?? "Unknown error in content script";
    console.error("[EasyMarketing] Posting failed:", errMsg);
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

// ─────────────────────────────────────────────────────────────────────────────
// postToFacebookGroup — runs INSIDE the Facebook page (page context)
//
// ⚠️  FRAGILE SELECTORS — Facebook can change these without notice.
//     If posting stops working, open DevTools on a Facebook group page,
//     inspect the composer area, and update the selectors below.
//
//     Current targets (as of early 2025):
//       • Composer: div[role="textbox"][contenteditable="true"]
//         Also tried: div[data-lexical-editor="true"]
//       • Post button: div[aria-label="Post"] | div[aria-label="פרסם"]
//         Fallback: any div[role="button"] whose trimmed textContent === "Post" | "פרסם"
//
//     Text insertion uses document.execCommand('insertText') — deprecated
//     but still functional in Chrome as of 2025. If it stops working,
//     the DataTransfer clipboard-paste fallback kicks in.
// ─────────────────────────────────────────────────────────────────────────────

async function postToFacebookGroup(content, imageUrl, linkUrl) {
  /* ── internal helpers (no closures — this runs in page context) ── */
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function findComposer() {
    const selectors = [
      'div[role="textbox"][contenteditable="true"]',
      'div[data-lexical-editor="true"]',
      'div[contenteditable="true"][spellcheck="true"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }

  function findPostButton() {
    // Strategy 1: exact aria-label (English or Hebrew)
    for (const label of ["Post", "פרסם", "Share", "שתף"]) {
      const el =
        document.querySelector(`div[aria-label="${label}"][role="button"]`) ||
        document.querySelector(`button[aria-label="${label}"]`);
      if (el) return el;
    }
    // Strategy 2: scan all role=button by text content
    for (const el of document.querySelectorAll('div[role="button"], button')) {
      const text = el.textContent?.trim();
      if (text === "Post" || text === "פרסם" || text === "Share" || text === "שתף") {
        return el;
      }
    }
    return null;
  }

  /* ── Step 0: build the full text to post ── */
  const fullContent = linkUrl ? `${content}\n${linkUrl}` : content;

  /* ── Step 1: find composer — retry up to 12 s ── */
  let composer = null;
  for (let i = 0; i < 12; i++) {
    composer = findComposer();
    if (composer) break;
    await sleep(1000);
  }
  if (!composer) {
    return { success: false, error: "Could not find post composer after 12 seconds. Facebook DOM may have changed." };
  }

  /* ── Step 2: focus and inject text ── */
  composer.click();
  await sleep(600);
  composer.focus();
  await sleep(300);

  // Primary: execCommand (deprecated but works in Chrome 2025)
  const inserted = document.execCommand("insertText", false, fullContent);

  if (!inserted) {
    // Fallback: DataTransfer clipboard-paste simulation
    const dt = new DataTransfer();
    dt.setData("text/plain", fullContent);
    composer.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
    );
  }

  // Wait for React / Lexical to process the input event
  await sleep(1500);

  // Verify text was actually inserted
  if (!composer.textContent?.includes(content.slice(0, 20))) {
    return { success: false, error: "Text injection failed — composer appears empty after insert." };
  }

  /* ── Step 3: find and click the Post button ── */
  let postBtn = null;
  for (let i = 0; i < 5; i++) {
    postBtn = findPostButton();
    if (postBtn) break;
    await sleep(800);
  }
  if (!postBtn) {
    return { success: false, error: "Could not find Post button. Facebook DOM may have changed." };
  }

  postBtn.click();

  // Wait for submission (network + animation)
  await sleep(4000);

  return { success: true };
}
