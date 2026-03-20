// ─────────────────────────────────────────────────────────────────────────────
// EasyMarketing — Facebook DOM automation  (content.js)
//
// Injected via: chrome.scripting.executeScript({ files:["content.js"], world:"MAIN" })
// Defines: window.easyMarketingPost(content, imageUrl, linkUrl) → { success, error }
//
// TO DEBUG: DevTools on the Facebook tab → Console → filter "[EasyMarketing]"
// ─────────────────────────────────────────────────────────────────────────────

window.easyMarketingPost = async function (content, imageUrl, linkUrl) {

  // ── Helpers ────────────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log  = (...a) => console.log("[EasyMarketing]",  ...a);
  const warn = (...a) => console.warn("[EasyMarketing]", ...a);
  const err  = (...a) => console.error("[EasyMarketing]", ...a);

  const fullContent = linkUrl ? `${content}\n${linkUrl}` : content;

  // ── STEP 1 — Click the "כאן כותבים..." trigger ───────────────────────────
  // The contenteditable does NOT exist until this is clicked.

  log("STEP 1 — Looking for composer trigger...");

  const TRIGGER_TEXTS = [
    "כאן כותבים...", "Write something...", "כתוב משהו...",
    "מה אתה חושב?", "What's on your mind?",
  ];

  let triggerEl = null;

  for (const text of TRIGGER_TEXTS) {
    triggerEl =
      document.querySelector(`[aria-label="${text}"]`) ||
      document.querySelector(`[aria-placeholder="${text}"]`);
    if (triggerEl) { log(`Trigger found via aria: "${text}"`); break; }
  }

  if (!triggerEl) {
    log("aria scan found nothing — scanning div[role=button] by textContent...");
    for (const el of document.querySelectorAll('div[role="button"]')) {
      const txt = (el.textContent ?? "").trim();
      if (TRIGGER_TEXTS.some((t) => txt.includes(t.replace("...", "")))) {
        log(`Trigger found by text: "${txt.slice(0, 50)}"`);
        triggerEl = el;
        break;
      }
    }
  }

  if (!triggerEl) {
    const sample = [...document.querySelectorAll('div[role="button"]')]
      .slice(0, 10).map((e) => `"${(e.textContent ?? "").trim().slice(0, 40)}"`);
    err("Trigger not found. Buttons on page:", sample.join(", "));
    return { success: false, error: `Trigger not found. Page buttons: ${sample.join(", ")}` };
  }

  triggerEl.click();
  log("Trigger clicked — waiting 3 s for modal...");
  await sleep(3000);

  // ── STEP 2 — Find the Lexical contenteditable ─────────────────────────────

  log("STEP 2 — Looking for contenteditable composer...");

  const COMPOSER_SELECTORS = [
    'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
    'div[role="dialog"] div[data-lexical-editor="true"]',
    'div[role="dialog"] div[contenteditable="true"][spellcheck="true"]',
    'div[role="dialog"] div[contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    'div[data-lexical-editor="true"]',
    'div[contenteditable="true"][spellcheck="true"]',
  ];

  let composer = null;
  for (let i = 1; i <= 15; i++) {
    for (const sel of COMPOSER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) { log(`Composer found on attempt ${i}: ${sel}`); composer = el; break; }
    }
    if (composer) break;
    log(`Attempt ${i}/15 — not found yet...`);
    await sleep(1000);
  }

  if (!composer) {
    const d = document.querySelectorAll('[role="dialog"]').length;
    const c = document.querySelectorAll("[contenteditable]").length;
    err(`Composer not found. dialogs=${d}, contenteditable=${c}`);
    return { success: false, error: `Composer not found. dialogs=${d}, contenteditable=${c}` };
  }

  log(`Composer OK: role="${composer.getAttribute("role")}" ce="${composer.contentEditable}"`);

  // ── STEP 3 — Focus + inject text ─────────────────────────────────────────
  // Lexical renders the "פרסם" button ONLY after it detects real text input.
  // We try four methods; each is verified before moving on.

  log("STEP 3 — Injecting text (4 methods)...");

  // Full pointer + focus sequence
  composer.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  await sleep(80);
  composer.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
  composer.dispatchEvent(new MouseEvent("click",     { bubbles: true, cancelable: true }));
  await sleep(250);
  composer.focus();
  await sleep(400);

  // Place cursor at end
  try {
    const sel   = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    log("Cursor placed at end.");
  } catch (e) { warn("Cursor placement failed:", e.message); }

  // Helper: does the composer now contain our text?
  const snippet = fullContent.slice(0, 15);
  const hasText = () => (composer.textContent ?? "").includes(snippet);

  let injected = false;

  // ── Method A: selectAll then execCommand (forces Lexical to process the full buffer)
  if (!injected) {
    log("  Method A: selectAll + execCommand('insertText')...");
    try {
      document.execCommand("selectAll", false);
      await sleep(100);
      const ok = document.execCommand("insertText", false, fullContent);
      await sleep(1000); // ← give Facebook 1 s to register the input
      if (hasText()) {
        injected = true;
        log(`  Method A ✓  execCommand returned ${ok}`);
      } else {
        warn(`  Method A: execCommand=${ok} but composer still empty:`, JSON.stringify((composer.textContent ?? "").slice(0, 80)));
      }
    } catch (e) { warn("  Method A threw:", e.message); }
  }

  // ── Method B: beforeinput InputEvent (Lexical's native handler)
  if (!injected) {
    log("  Method B: beforeinput InputEvent...");
    try {
      composer.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true, cancelable: true,
        inputType: "insertText",
        data: fullContent,
      }));
      await sleep(1000);
      if (hasText()) {
        injected = true;
        log("  Method B ✓");
      } else {
        warn("  Method B: event dispatched but text absent:", JSON.stringify((composer.textContent ?? "").slice(0, 80)));
      }
    } catch (e) { warn("  Method B threw:", e.message); }
  }

  // ── Method C: DataTransfer clipboard paste
  if (!injected) {
    log("  Method C: DataTransfer clipboard paste...");
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", fullContent);
      composer.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
      );
      await sleep(1000);
      if (hasText()) {
        injected = true;
        log("  Method C ✓");
      } else {
        warn("  Method C: paste sent but text absent:", JSON.stringify((composer.textContent ?? "").slice(0, 80)));
      }
    } catch (e) { warn("  Method C threw:", e.message); }
  }

  // ── Method D: direct DOM write into Lexical's inner <p>
  if (!injected) {
    log("  Method D: direct innerHTML into <p> + input event...");
    try {
      // Lexical wraps each paragraph in a <p> with data-lexical-text="true"
      let target = composer.querySelector('[data-lexical-text="true"]')
                ?? composer.querySelector("p")
                ?? composer;
      target.textContent = fullContent;
      composer.dispatchEvent(new InputEvent("input",  { bubbles: true, inputType: "insertText", data: fullContent }));
      composer.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(1000);
      if (hasText()) {
        injected = true;
        warn("  Method D ✓  (DOM-only — button may still be disabled if Lexical state wasn't updated)");
      } else {
        warn("  Method D: text still absent. Composer:", JSON.stringify((composer.textContent ?? "").slice(0, 100)));
      }
    } catch (e) { warn("  Method D threw:", e.message); }
  }

  if (!injected) {
    err("All 4 injection methods failed.");
    return {
      success: false,
      error: "All 4 text injection methods failed. Open DevTools on the Facebook tab and filter by [EasyMarketing].",
    };
  }

  // Extra pause — give Lexical time to re-render and ENABLE the Post button
  log("Text injected. Waiting 1.5 s for Lexical to enable the Post button...");
  await sleep(1500);

  // ── STEP 4 — Find and click "פרסם" ───────────────────────────────────────

  log("STEP 4 — Searching for Post / פרסם button...");

  // "פרסום" is the confirmed Hebrew label (imperative form used by Facebook IL).
  // Keep "פרסם" and "Post" as fallbacks for other locales.
  const POST_LABELS = ["פרסום", "פרסם", "Post", "שתף", "Share"];

  function logAllDialogButtons(label) {
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) return;
    const all = [...dialog.querySelectorAll('[role="button"], button')].map((el) => {
      const r = el.getBoundingClientRect();
      const bg = window.getComputedStyle(el).backgroundColor;
      return {
        text:     (el.textContent ?? "").trim().slice(0, 30),
        label:    el.getAttribute("aria-label"),
        disabled: el.getAttribute("aria-disabled"),
        size:     `${Math.round(r.width)}×${Math.round(r.height)}`,
        bg,
      };
    });
    log(`${label} — all buttons in dialog (${all.length}):`, JSON.stringify(all));
  }

  function isBlueBackground(el) {
    // Facebook's primary (Post) button has a blue background.
    // We parse the computed background-color and check for a blue-dominant RGB.
    try {
      const bg = window.getComputedStyle(el).backgroundColor;
      const m  = bg.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
      if (!m) return false;
      const [, r, g, b] = m.map(Number);
      // FB blue range: R<120, G>80, B>180 — covers (24,119,242), (0,132,255), etc.
      return b > 180 && b > r * 2;
    } catch { return false; }
  }

  function findPostButton() {
    const dialog = document.querySelector('div[role="dialog"]');
    const root   = dialog ?? document;

    // ── Strategy 1: exact aria-label ──
    for (const label of POST_LABELS) {
      const el =
        root.querySelector(`[aria-label="${label}"][role="button"]`) ||
        root.querySelector(`button[aria-label="${label}"]`);
      if (el) {
        const dis = el.getAttribute("aria-disabled");
        log(`Found by aria-label="${label}" — aria-disabled="${dis}"`);
        if (dis === "true") warn("Button is DISABLED — text injection may not have updated Lexical state.");
        return el;
      }
    }

    // ── Strategy 2: text content (case-insensitive, trims whitespace) ──
    for (const el of root.querySelectorAll('[role="button"], button')) {
      const text = (el.textContent ?? "").trim().toLowerCase();
      if (POST_LABELS.map((l) => l.toLowerCase()).includes(text)) {
        const dis = el.getAttribute("aria-disabled");
        log(`Found by textContent="${text}" — aria-disabled="${dis}"`);
        if (dis === "true") warn("Button is DISABLED — text injection may not have updated Lexical state.");
        return el;
      }
    }

    // ── Strategy 3: blue background (Facebook primary button style) ──
    if (dialog) {
      for (const el of dialog.querySelectorAll('[role="button"], button')) {
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 24) continue; // skip tiny icon buttons
        if (isBlueBackground(el)) {
          const dis = el.getAttribute("aria-disabled");
          const bg  = window.getComputedStyle(el).backgroundColor;
          log(`Found by blue background: bg="${bg}" text="${(el.textContent ?? "").trim().slice(0, 20)}" aria-disabled="${dis}"`);
          if (dis === "true") warn("Blue button is DISABLED — text injection may not have updated Lexical state.");
          return el;
        }
      }
    }

    // ── Strategy 4: bottom-right positional fallback ──
    if (dialog) {
      const candidates = [...dialog.querySelectorAll('[role="button"]')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width >= 30 && r.height >= 20;
      });
      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return rb.bottom - ra.bottom || rb.right - ra.right;
        });
        const best = candidates[0];
        const dis  = best.getAttribute("aria-disabled");
        const bg   = window.getComputedStyle(best).backgroundColor;
        log(`Positional fallback → text="${(best.textContent ?? "").trim().slice(0, 20)}" aria-label="${best.getAttribute("aria-label")}" disabled="${dis}" bg="${bg}"`);
        if (dis === "true") warn("Positional button is DISABLED — text injection may not have updated Lexical state.");
        return best;
      }
    }

    return null;
  }

  let postBtn = null;
  for (let attempt = 1; attempt <= 10; attempt++) {
    logAllDialogButtons(`Attempt ${attempt}/10`);
    postBtn = findPostButton();
    if (postBtn) break;
    log(`Post button not found on attempt ${attempt}/10, waiting 800 ms...`);
    await sleep(800);
  }

  if (!postBtn) {
    logAllDialogButtons("FINAL (not found)");
    return {
      success: false,
      error: "Post button not found after 10 attempts. Check DevTools on the Facebook tab for [EasyMarketing] logs.",
    };
  }

  // Click even if disabled — Facebook sometimes re-enables it on click
  const disabled = postBtn.getAttribute("aria-disabled");
  log(`Clicking Post button — aria-disabled="${disabled}" text="${(postBtn.textContent ?? "").trim().slice(0, 20)}"`);
  postBtn.click();

  if (disabled === "true") {
    // Wait a beat and try once more in case a re-render was needed
    await sleep(1500);
    log("Button was disabled — retrying click after 1.5 s...");
    postBtn.click();
  }

  await sleep(5000);
  log("Post submitted — done.");
  return { success: true };
};
