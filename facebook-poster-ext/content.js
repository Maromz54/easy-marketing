// ─────────────────────────────────────────────────────────────────────────────
// EasyMarketing — Facebook DOM automation
//
// Injected into the Facebook group page by background.js via
// chrome.scripting.executeScript({ files: ["content.js"], world: "MAIN" })
//
// Running in world: "MAIN" gives us access to the same window/React state
// that Lexical uses, which is required for reliable text injection.
//
// TO DEBUG: Open DevTools on the Facebook tab (not the extension) → Console.
//           Filter by "[EasyMarketing]" to see every step.
//
// ⚠️  SELECTOR UPDATE GUIDE (when Facebook breaks things):
//   1. Open the group page, click "כאן כותבים...", inspect the modal in DevTools.
//   2. Find the TRIGGER_TEXTS that match the placeholder text in your language.
//   3. Find the contenteditable — look for role="textbox" + contenteditable="true".
//   4. Find the Post button — inspect bottom-right of the modal for aria-label.
// ─────────────────────────────────────────────────────────────────────────────

window.easyMarketingPost = async function (content, imageUrl, linkUrl) {

  // ── Helpers ────────────────────────────────────────────────────────────────

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log   = (...a) => console.log("[EasyMarketing]", ...a);
  const warn  = (...a) => console.warn("[EasyMarketing]", ...a);
  const err   = (...a) => console.error("[EasyMarketing]", ...a);

  /** Returns true if el has non-zero dimensions (i.e. rendered and visible). */
  function hasSize(el) {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  const fullContent = linkUrl ? `${content}\n${linkUrl}` : content;

  // ── STEP 1: Click the "כאן כותבים..." trigger ─────────────────────────────
  //
  // The Lexical contenteditable does NOT exist in the DOM until this trigger
  // is clicked. Facebook renders the editor lazily inside a modal/dialog.

  log("STEP 1 — Looking for composer trigger...");

  // Placeholders we look for (Hebrew + English variants)
  const TRIGGER_TEXTS = [
    "כאן כותבים...",
    "Write something...",
    "כתוב משהו...",
    "מה אתה חושב?",
    "What's on your mind?",
  ];

  let triggerEl = null;

  // Try aria-label / aria-placeholder attributes first (most reliable)
  for (const text of TRIGGER_TEXTS) {
    triggerEl =
      document.querySelector(`[aria-label="${text}"]`) ||
      document.querySelector(`[aria-placeholder="${text}"]`);
    if (triggerEl) {
      log(`Found trigger via aria attribute: "${text}"`, triggerEl.tagName);
      break;
    }
  }

  // Fallback: scan all role="button" elements for matching inner text
  if (!triggerEl) {
    log("aria-label scan found nothing — scanning div[role=button] by text...");
    for (const el of document.querySelectorAll('div[role="button"]')) {
      const txt = (el.textContent ?? "").trim();
      if (TRIGGER_TEXTS.some((t) => txt.includes(t.replace("...", "")))) {
        log(`Found trigger by textContent: "${txt.slice(0, 50)}"`, el.tagName);
        triggerEl = el;
        break;
      }
    }
  }

  if (!triggerEl) {
    const sample = [...document.querySelectorAll('div[role="button"]')]
      .slice(0, 10)
      .map((e) => `"${(e.textContent ?? "").trim().slice(0, 40)}"`);
    err("Trigger not found. Sample role=button texts:", sample.join(", "));
    return {
      success: false,
      error: `Trigger not found. Tried: ${TRIGGER_TEXTS.join(", ")}. Page buttons: ${sample.join(", ")}`,
    };
  }

  triggerEl.click();
  log("Trigger clicked — waiting 3 s for modal to open...");
  await sleep(3000);

  // ── STEP 2: Find the Lexical contenteditable ───────────────────────────────
  //
  // After the trigger click, Facebook renders a modal. We prefer to scope
  // selectors to div[role="dialog"] to avoid matching stale elements.

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

  for (let attempt = 1; attempt <= 15; attempt++) {
    for (const sel of COMPOSER_SELECTORS) {
      const el = document.querySelector(sel);
      if (el) {
        log(`Composer found on attempt ${attempt} with: ${sel}`);
        composer = el;
        break;
      }
    }
    if (composer) break;
    log(`Attempt ${attempt}/15 — composer not in DOM yet, waiting 1 s...`);
    await sleep(1000);
  }

  if (!composer) {
    const dialogs = document.querySelectorAll('[role="dialog"]').length;
    const editables = document.querySelectorAll("[contenteditable]").length;
    err(`Composer not found after 15 s. Dialogs=${dialogs}, contenteditable elements=${editables}`);
    return {
      success: false,
      error: `Composer not found after 15 s. dialogs=${dialogs}, contenteditable=${editables}`,
    };
  }

  log(
    "Composer:",
    `role="${composer.getAttribute("role")}"`,
    `contenteditable="${composer.contentEditable}"`,
    `data-lexical="${composer.dataset.lexicalEditor}"`,
    `text="${(composer.textContent ?? "").slice(0, 40)}"`
  );

  // ── STEP 3: Focus + inject text ───────────────────────────────────────────
  //
  // Four methods, tried in order. We stop at the first one that results in
  // the text appearing inside the composer's textContent.
  //
  // Lexical processes input via the 'beforeinput' browser event (method A).
  // execCommand('insertText') is the classic fallback (method B).
  // DataTransfer paste is another common approach (method C).
  // Direct DOM write (method D) is a last resort — may not enable the Post button.

  log("STEP 3 — Focusing composer and injecting text...");

  // Full pointer + focus sequence so Lexical activates
  composer.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  await sleep(80);
  composer.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
  composer.dispatchEvent(new MouseEvent("click",     { bubbles: true, cancelable: true }));
  await sleep(250);
  composer.focus();
  await sleep(300);

  // Place the text cursor at the very end of existing content
  try {
    const sel   = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(composer);
    range.collapse(false); // collapse to end
    sel.removeAllRanges();
    sel.addRange(range);
    log("Selection/cursor set to end of composer.");
  } catch (e) {
    warn("Could not set selection:", e.message);
  }

  let injected = false;

  // ── Method A: beforeinput InputEvent (Lexical-native) ──
  log("  Method A: dispatching beforeinput InputEvent...");
  try {
    const ev = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: fullContent,
    });
    composer.dispatchEvent(ev);
    await sleep(700);
    if ((composer.textContent ?? "").includes(fullContent.slice(0, 15))) {
      injected = true;
      log("  Method A succeeded ✓ Composer:", (composer.textContent ?? "").slice(0, 60));
    } else {
      warn("  Method A: event dispatched but text not found. Composer:", JSON.stringify((composer.textContent ?? "").slice(0, 80)));
    }
  } catch (e) {
    warn("  Method A threw:", e.message);
  }

  // ── Method B: document.execCommand('insertText') ──
  if (!injected) {
    log("  Method B: document.execCommand('insertText')...");
    try {
      const ok = document.execCommand("insertText", false, fullContent);
      await sleep(700);
      if ((composer.textContent ?? "").includes(fullContent.slice(0, 15))) {
        injected = true;
        log("  Method B succeeded ✓ execCommand returned:", ok);
      } else {
        warn("  Method B: execCommand returned", ok, "but text not found. Composer:", JSON.stringify((composer.textContent ?? "").slice(0, 80)));
      }
    } catch (e) {
      warn("  Method B threw:", e.message);
    }
  }

  // ── Method C: DataTransfer clipboard paste ──
  if (!injected) {
    log("  Method C: DataTransfer clipboard paste...");
    try {
      const dt = new DataTransfer();
      dt.setData("text/plain", fullContent);
      composer.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
      );
      await sleep(700);
      if ((composer.textContent ?? "").includes(fullContent.slice(0, 15))) {
        injected = true;
        log("  Method C succeeded ✓");
      } else {
        warn("  Method C: paste dispatched but text not found. Composer:", JSON.stringify((composer.textContent ?? "").slice(0, 80)));
      }
    } catch (e) {
      warn("  Method C threw:", e.message);
    }
  }

  // ── Method D: Direct DOM write + synthetic input event (last resort) ──
  if (!injected) {
    log("  Method D: direct textContent write + input event (last resort)...");
    try {
      // Lexical wraps content in a <p> inside the editor
      const paragraph = composer.querySelector("p") ?? composer;
      paragraph.textContent = fullContent;
      composer.dispatchEvent(new Event("input",  { bubbles: true }));
      composer.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(700);
      if ((composer.textContent ?? "").includes(fullContent.slice(0, 15))) {
        injected = true;
        warn("  Method D succeeded ✓ (DOM-only — Post button may remain disabled if Lexical state wasn't updated)");
      } else {
        warn("  Method D also failed. Composer:", JSON.stringify((composer.textContent ?? "").slice(0, 100)));
      }
    } catch (e) {
      warn("  Method D threw:", e.message);
    }
  }

  if (!injected) {
    err("All 4 injection methods failed. Final composer textContent:", JSON.stringify((composer.textContent ?? "").slice(0, 100)));
    return {
      success: false,
      error: "All 4 text injection methods failed. Open DevTools on the Facebook tab and filter by [EasyMarketing] for details.",
    };
  }

  // Give Lexical a moment to re-render and enable the Post button
  await sleep(1200);

  // ── STEP 4: Find and click the Post / פרסם button ─────────────────────────

  log("STEP 4 — Searching for Post / פרסם button...");

  const POST_LABELS = ["פרסם", "Post", "שתף", "Share"];

  function findPostButton() {
    const dialog = document.querySelector('div[role="dialog"]');
    const root = dialog ?? document;

    // Try aria-label (most reliable when present)
    for (const label of POST_LABELS) {
      const el =
        root.querySelector(`[aria-label="${label}"][role="button"]`) ||
        root.querySelector(`button[aria-label="${label}"]`);
      if (el) {
        log(`  Found by aria-label: "${label}"`);
        return el;
      }
    }

    // Try text content
    for (const el of root.querySelectorAll('[role="button"], button')) {
      const text = (el.textContent ?? "").trim();
      if (POST_LABELS.includes(text)) {
        log(`  Found by textContent: "${text}"`);
        return el;
      }
    }

    // Positional fallback: the submit button is always bottom-right in the modal.
    // We take all rendered buttons, sort by (bottom DESC, right DESC), and pick
    // the top candidate that is at least 50 px wide (not a small icon button).
    if (dialog) {
      const candidates = [...dialog.querySelectorAll('[role="button"]')].filter(
        (el) => {
          const r = el.getBoundingClientRect();
          return r.width >= 50 && r.height >= 24;
        }
      );

      if (candidates.length > 0) {
        candidates.sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return rb.bottom - ra.bottom || rb.right - ra.right;
        });

        // Log all for debugging
        candidates.slice(0, 6).forEach((btn, i) => {
          const r = btn.getBoundingClientRect();
          log(
            `  Candidate ${i + 1}: text="${(btn.textContent ?? "").trim().slice(0, 20)}"`,
            `aria-label="${btn.getAttribute("aria-label")}"`,
            `aria-disabled="${btn.getAttribute("aria-disabled")}"`,
            `size=${Math.round(r.width)}×${Math.round(r.height)}`,
            `pos=(${Math.round(r.right)},${Math.round(r.bottom)})`
          );
        });

        const best = candidates[0];
        log(`  Positional fallback → candidate 1 selected.`);
        return best;
      }
    }

    return null;
  }

  let postBtn = null;
  for (let attempt = 1; attempt <= 10; attempt++) {
    postBtn = findPostButton();
    if (postBtn) break;
    log(`  Post button not found on attempt ${attempt}/10, retrying in 800 ms...`);
    await sleep(800);
  }

  if (!postBtn) {
    const dialog = document.querySelector('div[role="dialog"]');
    const btnDump = dialog
      ? [...dialog.querySelectorAll('[role="button"]')].map((e) => ({
          text: (e.textContent ?? "").trim().slice(0, 30),
          label: e.getAttribute("aria-label"),
          disabled: e.getAttribute("aria-disabled"),
        }))
      : [];
    err("Post button not found after 10 attempts. Dialog buttons:", btnDump);
    return {
      success: false,
      error: `Post button not found. Dialog buttons: ${JSON.stringify(btnDump.slice(0, 8))}`,
    };
  }

  log(
    "Clicking Post button:",
    `aria-label="${postBtn.getAttribute("aria-label")}"`,
    `text="${(postBtn.textContent ?? "").trim().slice(0, 20)}"`,
    `aria-disabled="${postBtn.getAttribute("aria-disabled")}"`
  );
  postBtn.click();

  await sleep(5000);
  log("Post submitted — done.");
  return { success: true };
};
