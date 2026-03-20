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

  // Extra settling time — Facebook's SPA needs a moment after 'complete'.
  // Background tabs render slower, so we give it more time.
  await sleep(5000);

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
// ⚠️  TWO-PHASE FLOW (verified against Hebrew Facebook DOM, March 2025):
//
//   Phase 1 — Click the trigger
//     The "כאן כותבים..." area is a div[role="button"]. The actual Lexical
//     editor (contenteditable) does NOT exist in the DOM until after you click
//     this trigger. Clicking it opens a modal/dialog containing the editor.
//
//   Phase 2 — Find the editor inside the dialog
//     After the modal opens, look for div[role="textbox"][contenteditable="true"]
//     preferably scoped to div[role="dialog"] so we don't hit stale elements.
//
//   Phase 3 — Insert text via execCommand('insertText')
//     Deprecated but still working in Chrome as of early 2025.
//     DataTransfer clipboard-paste is used as a fallback.
//
//   Phase 4 — Click "פרסם" (Hebrew Post button)
//     Searched first inside the dialog, then globally.
//
// ⚠️  SELECTOR UPDATE GUIDE:
//     Open DevTools on the group page → Elements panel → inspect the
//     "כאן כותבים..." area. Update TRIGGER_TEXTS if the placeholder changes.
//     Inspect the modal's submit button for the correct aria-label.
// ─────────────────────────────────────────────────────────────────────────────

async function postToFacebookGroup(content, imageUrl, linkUrl) {
  /* helpers — must be defined inline; this runs in page context with no closure */
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function isVisible(el) {
    return !!(el && el.offsetParent !== null && el.getBoundingClientRect().height > 0);
  }

  /* ── Step 0: build full content string ── */
  const fullContent = linkUrl ? `${content}\n${linkUrl}` : content;

  /* ── Step 1: click the "כאן כותבים..." trigger to open the Lexical editor ──
   *
   * The trigger is a div[role="button"] containing the placeholder text.
   * Try aria-label first, then fall back to a text-content scan.
   * The contenteditable will NOT exist before this click.
   */
  const TRIGGER_TEXTS = ["כאן כותבים...", "Write something...", "כתוב משהו...", "מה אתה חושב?"];

  let triggerClicked = false;

  // Try aria-label / aria-placeholder on any element
  for (const text of TRIGGER_TEXTS) {
    const el =
      document.querySelector(`[aria-label="${text}"]`) ||
      document.querySelector(`[aria-placeholder="${text}"]`);
    if (el) {
      el.click();
      triggerClicked = true;
      break;
    }
  }

  // Fallback: scan all role="button" elements for matching inner text
  if (!triggerClicked) {
    for (const el of document.querySelectorAll('div[role="button"]')) {
      const text = el.textContent?.trim() ?? "";
      if (TRIGGER_TEXTS.some((t) => text.startsWith(t.replace("...", "")))) {
        el.click();
        triggerClicked = true;
        break;
      }
    }
  }

  if (!triggerClicked) {
    return {
      success: false,
      error: 'לא נמצא כפתור "כאן כותבים..." — ייתכן שפייסבוק שינתה את ה-DOM. פתח DevTools ובדוק את האלמנט.',
    };
  }

  // Wait for the modal / expanded composer to finish rendering
  await sleep(2500);

  /* ── Step 2: find the Lexical contenteditable inside the dialog ──
   *
   * Prefer elements scoped to div[role="dialog"] because clicking the trigger
   * usually opens a modal. Fall back to a global search if no dialog is found.
   */
  function findComposer() {
    const scopeSelectors = [
      // Scoped to dialog (modal) — preferred
      'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
      'div[role="dialog"] div[data-lexical-editor="true"]',
      'div[role="dialog"] div[contenteditable="true"][spellcheck="true"]',
      'div[role="dialog"] div[contenteditable="true"]',
      // Global fallback
      'div[role="textbox"][contenteditable="true"]',
      'div[data-lexical-editor="true"]',
      'div[contenteditable="true"][spellcheck="true"]',
    ];
    for (const sel of scopeSelectors) {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  let composer = null;
  for (let i = 0; i < 15; i++) {
    composer = findComposer();
    if (composer) break;
    await sleep(1000);
  }

  if (!composer) {
    return {
      success: false,
      error: `לא נמצאה תיבת הכתיבה אחרי לחיצה על הטריגר (15 שניות). פתח DevTools ובדוק מה קורה לאחר לחיצה על "כאן כותבים...". triggerClicked=${triggerClicked}`,
    };
  }

  /* ── Step 3: focus the editor and inject text ── */
  composer.click();
  await sleep(500);
  composer.focus();
  await sleep(300);

  // execCommand is deprecated but still works in Chrome (as of early 2025)
  const inserted = document.execCommand("insertText", false, fullContent);

  if (!inserted) {
    // Clipboard-paste fallback for Lexical
    const dt = new DataTransfer();
    dt.setData("text/plain", fullContent);
    composer.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
    );
  }

  // Give Lexical time to process the synthetic input
  await sleep(2000);

  // Verify something was actually inserted
  const composerText = composer.textContent ?? "";
  const snippet = content.slice(0, 15);
  if (snippet.length > 0 && !composerText.includes(snippet)) {
    return {
      success: false,
      error: "הטקסט לא הוכנס לתיבת הכתיבה. Lexical דחה את הפקודה — ייתכן שנדרשת שיטת הזרקה אחרת.",
    };
  }

  /* ── Step 4: find and click the "פרסם" (Post) button ──
   *
   * Search inside the dialog first to avoid false positives elsewhere on the page.
   */
  function findPostButton() {
    const POST_LABELS = ["פרסם", "Post", "שתף", "Share"];

    // Inside dialog first
    const dialog = document.querySelector('div[role="dialog"]');
    if (dialog) {
      for (const el of dialog.querySelectorAll('div[role="button"], button')) {
        const label = (el.getAttribute("aria-label") ?? "").trim();
        const text = (el.textContent ?? "").trim();
        if (POST_LABELS.includes(label) || POST_LABELS.includes(text)) {
          if (isVisible(el)) return el;
        }
      }
    }

    // Global aria-label search
    for (const label of POST_LABELS) {
      const el =
        document.querySelector(`div[aria-label="${label}"][role="button"]`) ||
        document.querySelector(`button[aria-label="${label}"]`);
      if (el && isVisible(el)) return el;
    }

    // Global text-content scan
    for (const el of document.querySelectorAll('div[role="button"], button')) {
      const text = (el.textContent ?? "").trim();
      if (POST_LABELS.includes(text) && isVisible(el)) return el;
    }

    return null;
  }

  let postBtn = null;
  for (let i = 0; i < 8; i++) {
    postBtn = findPostButton();
    if (postBtn) break;
    await sleep(800);
  }

  if (!postBtn) {
    return {
      success: false,
      error: 'לא נמצא כפתור "פרסם" / "Post". ייתכן שהטקסט לא הוכנס, או שפייסבוק שינתה את ה-DOM.',
    };
  }

  postBtn.click();

  // Wait for the post to be submitted and the page to settle
  await sleep(5000);

  return { success: true };
}
