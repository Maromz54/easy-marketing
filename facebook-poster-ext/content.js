// ─────────────────────────────────────────────────────────────────────────────
// EasyMarketing — Facebook DOM automation  (content.js)
//
// Injected via: chrome.scripting.executeScript({ files:["content.js"], world:"MAIN" })
// Defines:      window.easyMarketingPost(content, imageUrl, linkUrl)
//
// DEBUG: Open DevTools on the Facebook tab → Console → filter "[EasyMarketing]"
// ─────────────────────────────────────────────────────────────────────────────

window.easyMarketingPost = async function (content, imageUrl, linkUrl) {

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const log   = (...a) => console.log("[EasyMarketing]",  ...a);
  const warn  = (...a) => console.warn("[EasyMarketing]", ...a);
  const err   = (...a) => console.error("[EasyMarketing]", ...a);

  const fullContent = linkUrl ? `${content}\n${linkUrl}` : content;

  // ── STEP 1 — Click the "כאן כותבים..." trigger ───────────────────────────

  log("STEP 1 — Searching for composer trigger...");

  const TRIGGER_TEXTS = [
    "כאן כותבים...", "Write something...", "כתוב משהו...",
    "מה אתה חושב?", "What's on your mind?",
  ];

  let triggerEl = null;
  for (const text of TRIGGER_TEXTS) {
    triggerEl =
      document.querySelector(`[aria-label="${text}"]`) ||
      document.querySelector(`[aria-placeholder="${text}"]`);
    if (triggerEl) { log(`Trigger via aria: "${text}"`); break; }
  }

  if (!triggerEl) {
    for (const el of document.querySelectorAll('div[role="button"]')) {
      const txt = (el.textContent ?? "").trim();
      if (TRIGGER_TEXTS.some((t) => txt.includes(t.replace("...", "")))) {
        log(`Trigger via text: "${txt.slice(0, 50)}"`);
        triggerEl = el;
        break;
      }
    }
  }

  if (!triggerEl) {
    const sample = [...document.querySelectorAll('div[role="button"]')]
      .slice(0, 10).map((e) => `"${(e.textContent ?? "").trim().slice(0, 40)}"`);
    err("Trigger not found. Page buttons:", sample.join(", "));
    return { success: false, error: `Trigger not found. Buttons: ${sample.join(", ")}` };
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
      if (el) { log(`Composer found (attempt ${i}): ${sel}`); composer = el; break; }
    }
    if (composer) break;
    log(`Attempt ${i}/15 — not yet...`);
    await sleep(1000);
  }

  if (!composer) {
    const d = document.querySelectorAll('[role="dialog"]').length;
    const c = document.querySelectorAll("[contenteditable]").length;
    err(`Composer not found. dialogs=${d}, contenteditable=${c}`);
    return { success: false, error: `Composer not found. dialogs=${d}, contenteditable=${c}` };
  }

  log(`Composer: role="${composer.getAttribute("role")}" ce="${composer.contentEditable}"`);

  // ── STEP 3 — Human-like text injection ───────────────────────────────────
  //
  // Lexical renders the "פרסום" button only AFTER it detects real text input
  // through its internal EditorState. We try five methods in order.
  //
  // CRITICAL: execCommand only fires a trusted beforeinput event when:
  //   (a) the element IS document.activeElement, AND
  //   (b) there is a valid Selection range inside the element.
  // We verify both before each attempt.

  log("STEP 3 — Injecting text...");

  /** Place a cursor/selection at the end of `el`, preferring inside <p>. */
  function placeCursorInComposer(el) {
    try {
      const p     = el.querySelector("p") ?? el;
      const range = document.createRange();
      // Empty Lexical editor: <p><br></p>
      if (p.childNodes.length === 1 && p.firstChild?.nodeName === "BR") {
        range.setStartBefore(p.firstChild);
      } else {
        range.selectNodeContents(p);
        range.collapse(false); // end
      }
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    } catch (e) {
      warn("placeCursorInComposer failed:", e.message);
      return false;
    }
  }

  /** Fire the follow-up events Facebook needs to "see" new text. */
  function firePostInjectionEvents(el, data) {
    el.dispatchEvent(new InputEvent("input",  { bubbles: true, inputType: "insertText", data }));
    el.dispatchEvent(new Event("change",  { bubbles: true }));
    // A benign keydown/keyup nudges React's synthetic event system
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Dead", bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup",   { key: "Dead", bubbles: true }));
  }

  const snippet = fullContent.slice(0, 15);
  const hasText = () => (composer.textContent ?? "").includes(snippet);

  // ── Full pointer+focus sequence ──
  composer.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  await sleep(60);
  composer.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
  composer.dispatchEvent(new MouseEvent("click",     { bubbles: true, cancelable: true }));
  await sleep(300);
  composer.focus();
  await sleep(400);

  log("activeElement after focus:", document.activeElement?.tagName,
      document.activeElement?.getAttribute("role"),
      "| isComposer:", document.activeElement === composer);

  let injected = false;

  // ── Method A: selectAll → execCommand('insertText') ──
  // selectAll first clears placeholder/existing text and places a valid selection.
  if (!injected) {
    log("  Method A: selectAll + execCommand('insertText')...");
    try {
      placeCursorInComposer(composer);
      await sleep(100);
      document.execCommand("selectAll", false);
      await sleep(80);
      const ok = document.execCommand("insertText", false, fullContent);
      firePostInjectionEvents(composer, fullContent);
      await sleep(1200);
      if (hasText()) { injected = true; log("  Method A ✓ execCommand returned:", ok); }
      else warn("  Method A: execCommand =", ok, "but text absent. activeElement:",
                document.activeElement?.tagName, "| composer text:", JSON.stringify((composer.textContent ?? "").slice(0, 80)));
    } catch (e) { warn("  Method A threw:", e.message); }
  }

  // ── Method B: First char via KeyboardEvent chain to wake Lexical, then execCommand rest ──
  // Simulating a real keystroke for the first character convinces Lexical it
  // is in "edit mode", after which execCommand reliably inserts the remainder.
  if (!injected) {
    log("  Method B: single keystroke wake-up + execCommand rest...");
    try {
      composer.focus();
      await sleep(200);
      placeCursorInComposer(composer);
      await sleep(100);

      const first = fullContent[0];
      composer.dispatchEvent(new KeyboardEvent("keydown",  { key: first, bubbles: true, cancelable: true }));
      composer.dispatchEvent(new KeyboardEvent("keypress", { key: first, bubbles: true, cancelable: true }));
      composer.dispatchEvent(new InputEvent("beforeinput",
        { bubbles: true, cancelable: true, inputType: "insertText", data: first }));
      document.execCommand("insertText", false, first);
      composer.dispatchEvent(new InputEvent("input",
        { bubbles: true, inputType: "insertText", data: first }));
      composer.dispatchEvent(new KeyboardEvent("keyup",    { key: first, bubbles: true }));
      await sleep(500);
      log("  Method B: first char done. Composer so far:", (composer.textContent ?? "").slice(0, 20));

      if (fullContent.length > 1) {
        const rest = fullContent.slice(1);
        document.execCommand("insertText", false, rest);
        firePostInjectionEvents(composer, rest);
      }
      await sleep(1200);
      if (hasText()) { injected = true; log("  Method B ✓"); }
      else warn("  Method B: text still absent:", JSON.stringify((composer.textContent ?? "").slice(0, 100)));
    } catch (e) { warn("  Method B threw:", e.message); }
  }

  // ── Method C: beforeinput InputEvent (Lexical listens to trusted beforeinput;
  //             synthetic events have isTrusted=false so this is a soft fallback)
  if (!injected) {
    log("  Method C: beforeinput InputEvent...");
    try {
      composer.focus();
      await sleep(200);
      placeCursorInComposer(composer);
      composer.dispatchEvent(new InputEvent("beforeinput",
        { bubbles: true, cancelable: true, inputType: "insertText", data: fullContent }));
      firePostInjectionEvents(composer, fullContent);
      await sleep(1200);
      if (hasText()) { injected = true; log("  Method C ✓"); }
      else warn("  Method C failed:", JSON.stringify((composer.textContent ?? "").slice(0, 80)));
    } catch (e) { warn("  Method C threw:", e.message); }
  }

  // ── Method D: DataTransfer clipboard paste ──
  if (!injected) {
    log("  Method D: DataTransfer clipboard paste...");
    try {
      composer.focus();
      await sleep(200);
      const dt = new DataTransfer();
      dt.setData("text/plain", fullContent);
      composer.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
      );
      composer.dispatchEvent(new InputEvent("input",
        { bubbles: true, inputType: "insertFromPaste", data: fullContent }));
      composer.dispatchEvent(new Event("change", { bubbles: true }));
      await sleep(1200);
      if (hasText()) { injected = true; log("  Method D ✓"); }
      else warn("  Method D failed:", JSON.stringify((composer.textContent ?? "").slice(0, 80)));
    } catch (e) { warn("  Method D threw:", e.message); }
  }

  // ── Method E: Direct DOM write into Lexical's <p> paragraph ──
  // Last resort — puts text in DOM but may not update Lexical's EditorState,
  // which means the Post button might stay disabled. Still worth trying.
  if (!injected) {
    log("  Method E: direct DOM write into <p> / [data-lexical-text]...");
    try {
      const target =
        composer.querySelector('[data-lexical-text="true"]') ??
        composer.querySelector("p") ??
        composer;
      target.textContent = fullContent;
      firePostInjectionEvents(composer, fullContent);
      await sleep(1200);
      if (hasText()) {
        injected = true;
        warn("  Method E ✓ (DOM-only — Post button may stay disabled if Lexical state not updated)");
      } else {
        warn("  Method E failed:", JSON.stringify((composer.textContent ?? "").slice(0, 100)));
      }
    } catch (e) { warn("  Method E threw:", e.message); }
  }

  if (!injected) {
    err("All 5 injection methods failed. Final composer text:", JSON.stringify((composer.textContent ?? "").slice(0, 100)));
    return {
      success: false,
      error: "All 5 injection methods failed. See [EasyMarketing] logs in DevTools on the Facebook tab.",
    };
  }

  // Extra wait — let Facebook/Lexical re-render and ENABLE the Post button
  log("Text injected ✓ — waiting 2 s for Post button to become active...");
  await sleep(2000);

  // ── STEP 4 — Find and click "פרסום" ──────────────────────────────────────

  log("STEP 4 — Searching for Post / פרסום button...");

  // All known label variants — "פרסום" first (confirmed Hebrew IL text)
  const POST_LABELS = ["פרסום", "פרסם", "Post", "שתף", "Share"];

  /** Log every button inside the dialog with full detail for debugging. */
  function dumpDialogButtons(prefix) {
    const dialog = document.querySelector('div[role="dialog"]');
    if (!dialog) { log(prefix, "— no dialog found"); return; }
    const rows = [...dialog.querySelectorAll('[role="button"], button')].map((el) => {
      const r   = el.getBoundingClientRect();
      const bg  = window.getComputedStyle(el).backgroundColor;
      const cls = el.className.slice(0, 60);
      return {
        text:     (el.textContent ?? "").trim().slice(0, 40),
        label:    el.getAttribute("aria-label"),
        disabled: el.getAttribute("aria-disabled"),
        size:     `${Math.round(r.width)}×${Math.round(r.height)}`,
        bg,
        cls,
      };
    });
    log(`${prefix} — ${rows.length} button(s):`, JSON.stringify(rows));
  }

  /** Return true if the element's computed background is Facebook-blue. */
  function isBlue(el) {
    try {
      const bg = window.getComputedStyle(el).backgroundColor;
      const m  = bg.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return false;
      const [, r, g, b] = m.map(Number);
      // FB blue shades: (24,119,242), (0,132,255), (8,102,255), etc.
      // Key property: blue channel dominant, > 180, blue > 2× red
      return b > 180 && b > r * 2;
    } catch { return false; }
  }

  function findPostButton() {
    const dialog = document.querySelector('div[role="dialog"]');
    const root   = dialog ?? document;

    // ── S1: Exact aria-label match ──
    for (const label of POST_LABELS) {
      const el =
        root.querySelector(`[aria-label="${label}"][role="button"]`) ||
        root.querySelector(`button[aria-label="${label}"]`);
      if (el) {
        log(`S1 (exact aria-label="${label}") disabled="${el.getAttribute("aria-disabled")}"`);
        return el;
      }
    }

    // ── S1b: Partial aria-label match (language-agnostic) ──
    for (const el of root.querySelectorAll('[role="button"][aria-label], button[aria-label]')) {
      const lbl = (el.getAttribute("aria-label") ?? "").toLowerCase();
      if (POST_LABELS.some((p) => lbl.includes(p.toLowerCase()))) {
        log(`S1b (partial aria-label "${el.getAttribute("aria-label")}") disabled="${el.getAttribute("aria-disabled")}"`);
        return el;
      }
    }

    // ── S2: Text content — case-insensitive, inside dialog first ──
    for (const el of root.querySelectorAll('[role="button"], button')) {
      const text = (el.textContent ?? "").trim().toLowerCase();
      if (POST_LABELS.map((l) => l.toLowerCase()).includes(text)) {
        log(`S2 (text="${text}") disabled="${el.getAttribute("aria-disabled")}"`);
        return el;
      }
    }

    // ── S3: Blue background — primary button colour almost never changes ──
    if (dialog) {
      for (const el of dialog.querySelectorAll('[role="button"], button')) {
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 20) continue; // skip icon buttons
        if (isBlue(el)) {
          const bg  = window.getComputedStyle(el).backgroundColor;
          const dis = el.getAttribute("aria-disabled");
          log(`S3 (blue bg="${bg}") text="${(el.textContent ?? "").trim().slice(0, 20)}" disabled="${dis}"`);
          if (dis === "true") warn("Blue button is DISABLED — text injection did not update Lexical state. Check [EasyMarketing] logs above.");
          return el;
        }
      }
    }

    // ── S4: Bottom-right positional fallback ──
    // The Post button is always the bottom-most, right-most action button.
    if (dialog) {
      const cands = [...dialog.querySelectorAll('[role="button"]')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width >= 30 && r.height >= 20;
      });
      if (cands.length) {
        cands.sort((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return rb.bottom - ra.bottom || rb.right - ra.right;
        });
        const best = cands[0];
        const dis  = best.getAttribute("aria-disabled");
        log(`S4 (positional) text="${(best.textContent ?? "").trim().slice(0, 20)}" label="${best.getAttribute("aria-label")}" disabled="${dis}"`);
        if (dis === "true") warn("Positional button is DISABLED — text injection did not update Lexical state.");
        return best;
      }
    }

    return null;
  }

  let postBtn = null;
  for (let attempt = 1; attempt <= 10; attempt++) {
    dumpDialogButtons(`Attempt ${attempt}/10`);
    postBtn = findPostButton();
    if (postBtn) break;
    await sleep(800);
  }

  if (!postBtn) {
    dumpDialogButtons("FINAL — button not found");
    return {
      success: false,
      error: "Post button not found after 10 attempts. See full [EasyMarketing] log in Facebook tab DevTools.",
    };
  }

  const dis = postBtn.getAttribute("aria-disabled");
  log(`Clicking: label="${postBtn.getAttribute("aria-label")}" text="${(postBtn.textContent ?? "").trim().slice(0, 20)}" disabled="${dis}"`);
  postBtn.click();

  // If the button was disabled (text injection used Method E / DOM-only),
  // wait a moment and retry — Facebook sometimes re-enables on click.
  if (dis === "true") {
    await sleep(1500);
    log("Was disabled — retrying click after 1.5 s...");
    postBtn.click();
  }

  await sleep(5000);
  log("Done — post submitted.");
  return { success: true };
};
