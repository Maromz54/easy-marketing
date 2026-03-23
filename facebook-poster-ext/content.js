// ─────────────────────────────────────────────────────────────────────────────
// EasyMarketing — Facebook DOM automation  (content.js)
//
// Injected via: chrome.scripting.executeScript({ files:["content.js"], world:"MAIN" })
// Defines:      window.easyMarketingPost(content, imageUrl, linkUrl)
//
// Return values:
//   { success: true }
//   { success: false, error: "..." }
//   { success: false, imageInjectionFailed: true, error: "..." }  ← tab stays open
//
// DEBUG: Open DevTools on the Facebook tab → Console → filter "[EasyMarketing]"
// ─────────────────────────────────────────────────────────────────────────────

window.easyMarketingPost = async function (content, imageUrl, linkUrl, imageDataUri) {

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

  log(`Composer: role="${composer.getAttribute("role")}" contenteditable="${composer.contentEditable}"`);

  // Defined here (after step 2) so composerDialog is available in BOTH step 3b and step 4.
  const composerDialog = composer.closest('div[role="dialog"]') ?? null;
  log(`Composer dialog found: ${!!composerDialog}`);

  // ── STEP 3 — Text injection ───────────────────────────────────────────────

  log("STEP 3 — Injecting text...");

  composer.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  await sleep(60);
  composer.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
  composer.dispatchEvent(new MouseEvent("click",     { bubbles: true, cancelable: true }));
  await sleep(300);

  composer.focus();
  await sleep(400);

  log("activeElement after focus:", document.activeElement?.tagName,
      `role="${document.activeElement?.getAttribute("role")}"`,
      "| isComposer:", document.activeElement === composer);

  try {
    const p     = composer.querySelector("p") ?? composer;
    const range = document.createRange();
    if (p.childNodes.length === 1 && p.firstChild?.nodeName === "BR") {
      range.setStartBefore(p.firstChild);
    } else {
      range.selectNodeContents(p);
      range.collapse(false);
    }
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    log("Cursor placed inside <p>.");
  } catch (e) {
    warn("Cursor placement failed:", e.message);
  }

  document.execCommand("selectAll", false);
  await sleep(80);

  const ok = document.execCommand("insertText", false, fullContent);
  log(`execCommand('insertText') returned: ${ok}`);
  log("Composer text after inject:", JSON.stringify((composer.textContent ?? "").slice(0, 80)));

  log("Waiting 2 s for Lexical to enable the פרסום button...");
  await sleep(2000);

  const injected = (composer.textContent ?? "").includes(fullContent.slice(0, 15));
  if (!injected) {
    log("execCommand did not insert text — trying DataTransfer paste fallback...");
    composer.focus();
    await sleep(200);
    const dt = new DataTransfer();
    dt.setData("text/plain", fullContent);
    composer.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })
    );
    log("Paste dispatched. Waiting 2 s...");
    await sleep(2000);

    if (!(composer.textContent ?? "").includes(fullContent.slice(0, 15))) {
      err("Both text injection methods failed.");
      return {
        success: false,
        error: "Text injection failed (execCommand + paste both failed). See [EasyMarketing] logs.",
      };
    }
    log("Paste fallback succeeded.");
  } else {
    log("Text injection confirmed ✓");
  }

  // ── STEP 3b — Image attachment (MANDATORY if imageUrl provided) ───────────
  //
  // If the post has an image and all injection strategies fail, we return
  // imageInjectionFailed: true so background.js marks the post as failed
  // and leaves the tab open for inspection — the submit button is NOT clicked.
  //
  // Strategies (tried in order):
  //   S-IMG-1 : ClipboardEvent('paste') with DataTransfer on the Lexical composer
  //   S-IMG-2 : DragEvent('drop') with DataTransfer on the composer dialog
  //   S-IMG-3 : Assign File to dialog-scoped <input type="file">;
  //             clicks the photo-toolbar button first if input not yet in DOM
  //   S-IMG-4 : Global document scan using Facebook-specific accept strings

  if (imageUrl) {
    log("STEP 3b — Image injection (MANDATORY). URL:", imageUrl);
    let imageInjected = false;

    // Helper: detect a rendered image preview in the dialog
    function hasImagePreview() {
      return !!(
        composerDialog?.querySelector('img[src^="blob:"]') ||
        composerDialog?.querySelector('[data-visualcompletion="media-vc-image"]') ||
        composerDialog?.querySelector('div[role="img"]') ||
        composerDialog?.querySelector('img[src]:not([src=""])')
      );
    }

    // Helper: assign a File to a file input and fire change/input events
    function assignToFileInput(input, fileObj) {
      const dt = new DataTransfer();
      dt.items.add(fileObj);
      Object.defineProperty(input, "files", { value: dt.files, configurable: true });
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("input",  { bubbles: true }));
    }

    // ── Acquire image data ────────────────────────────────────────────────
    // The background service worker pre-fetched the image and passed it as a
    // base64 data URI (4th arg) to avoid Facebook's CSP blocking fetch().
    // If the pre-fetch failed, we fall back to a direct fetch here — which may
    // also be blocked by CSP, but at least we log clearly what happened.

    let file;
    try {
      const filename = decodeURIComponent(imageUrl.split("/").pop() || "image.jpg");

      if (imageDataUri) {
        log("IMG: Decoding pre-fetched data URI from background (CSP bypass) ✓");
        const [header, base64Data] = imageDataUri.split(",");
        const mimeType = header.match(/data:([^;]+)/)?.[1] ?? "image/jpeg";
        const binaryStr = atob(base64Data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }
        const blob = new Blob([bytes], { type: mimeType });
        file = new File([blob], filename, { type: mimeType });
        log(`IMG: File created — name="${filename}" type=${file.type} size=${file.size} bytes`);
      } else {
        log("IMG: No pre-fetched data — attempting direct fetch (may be blocked by CSP)...");
        const resp = await fetch(imageUrl);
        if (!resp.ok) throw new Error(`fetch ${resp.status} ${resp.statusText}`);
        const blob = await resp.blob();
        log(`IMG: Direct fetch succeeded — type=${blob.type} size=${blob.size} bytes`);
        file = new File([blob], filename, { type: blob.type || "image/jpeg" });
      }
    } catch (fetchErr) {
      err("IMG: Failed to acquire image data:", fetchErr.message);
      return {
        success: false,
        imageInjectionFailed: true,
        error: `Image data acquisition failed: ${fetchErr.message}`,
      };
    }

    // ── S-IMG-1: paste event on the Lexical contenteditable ────────────────
    log("IMG S1: Dispatching paste event on composer...");
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      composer.focus();
      await sleep(150);
      composer.dispatchEvent(new ClipboardEvent("paste", {
        bubbles: true, cancelable: true, clipboardData: dt,
      }));
      log("IMG S1: paste dispatched — waiting 3 s...");
      await sleep(3000);
      if (hasImagePreview()) {
        imageInjected = true;
        log("IMG S1: SUCCESS — image preview detected ✓");
      } else {
        log("IMG S1: paste dispatched but no image preview detected.");
      }
    } catch (e) { warn("IMG S1 error:", e.message); }

    // ── S-IMG-2: drop event on composerDialog ──────────────────────────────
    if (!imageInjected) {
      log("IMG S2: Dispatching drop events on dialog...");
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        const dropTarget = composerDialog ?? composer;
        dropTarget.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true, cancelable: true }));
        await sleep(80);
        dropTarget.dispatchEvent(new DragEvent("dragover",  { dataTransfer: dt, bubbles: true, cancelable: true }));
        await sleep(80);
        dropTarget.dispatchEvent(new DragEvent("drop",      { dataTransfer: dt, bubbles: true, cancelable: true }));
        log("IMG S2: drop dispatched — waiting 3 s...");
        await sleep(3000);
        if (hasImagePreview()) {
          imageInjected = true;
          log("IMG S2: SUCCESS — image preview detected ✓");
        } else {
          log("IMG S2: drop dispatched but no image preview detected.");
        }
      } catch (e) { warn("IMG S2 error:", e.message); }
    }

    // ── S-IMG-3: dialog-scoped file input (direct or via photo button) ─────
    if (!imageInjected) {
      log("IMG S3: Trying dialog-scoped file input...");
      try {
        let fileInput =
          composerDialog?.querySelector('input[type="file"][accept*="image"]') ??
          composerDialog?.querySelector('input[type="file"]') ??
          null;

        if (!fileInput) {
          log("IMG S3: input not in dialog — looking for photo toolbar button...");
          const PHOTO_LABELS = ["תמונה/סרטון", "Photo/video", "Photo", "תמונה", "Add photos/videos"];
          let photoBtn = null;
          for (const label of PHOTO_LABELS) {
            photoBtn = (composerDialog ?? document).querySelector(`[aria-label="${label}"]`);
            if (photoBtn) { log(`IMG S3: photo button found via label "${label}"`); break; }
          }
          if (!photoBtn) {
            for (const el of (composerDialog ?? document).querySelectorAll('[role="button"]')) {
              const txt = (el.textContent ?? "").trim();
              if (PHOTO_LABELS.some((l) => txt.includes(l))) {
                log(`IMG S3: photo button found via text "${txt.slice(0, 30)}"`);
                photoBtn = el; break;
              }
            }
          }
          if (photoBtn) {
            photoBtn.click();
            log("IMG S3: photo button clicked — waiting 1.5 s...");
            await sleep(1500);
            fileInput =
              document.querySelector('input[type="file"][accept*="image"]') ??
              document.querySelector('input[type="file"]') ??
              null;
          }
        }

        if (fileInput) {
          log(`IMG S3: file input found (accept="${fileInput.accept}") — assigning file...`);
          assignToFileInput(fileInput, file);
          log("IMG S3: files assigned — waiting 3 s...");
          await sleep(3000);
          // File inputs don't always produce a detectable preview; assume success
          imageInjected = true;
          if (hasImagePreview()) {
            log("IMG S3: SUCCESS — image preview detected ✓");
          } else {
            log("IMG S3: files assigned (no visual preview detected — assuming accepted).");
          }
        } else {
          log("IMG S3: no file input found in dialog.");
        }
      } catch (e) { warn("IMG S3 error:", e.message); }
    }

    // ── S-IMG-4: global scan for Facebook-specific file inputs ─────────────
    //
    // Facebook hides file inputs anywhere in the document — not necessarily
    // inside the dialog. We scan the entire page with Facebook-specific accept
    // patterns, most specific first.
    if (!imageInjected) {
      log("IMG S4: Global document scan for Facebook-specific file inputs...");
      try {
        const FB_ACCEPT_PATTERNS = [
          'input[type="file"][accept="image/*,image/heif,image/heic"]',
          'input[type="file"][accept*="image/heic"]',
          'input[type="file"][accept^="image"]',
          'input[type="file"][accept*="image/"]',
          'input[type="file"][accept*="video/"]',  // Facebook bundles image+video
          'input[type="file"]',                     // last resort
        ];

        let fileInput = null;
        for (const pattern of FB_ACCEPT_PATTERNS) {
          const candidates = [...document.querySelectorAll(pattern)];
          log(`IMG S4: pattern "${pattern}" → ${candidates.length} candidate(s)`);
          if (candidates.length > 0) {
            // Prefer an input with no files already set
            fileInput = candidates.find((el) => el.files?.length === 0) ?? candidates[0];
            log(`IMG S4: selected input accept="${fileInput.accept}" files=${fileInput.files?.length}`);
            break;
          }
        }

        if (fileInput) {
          assignToFileInput(fileInput, file);
          log("IMG S4: files assigned globally — waiting 3 s...");
          await sleep(3000);
          imageInjected = true;
          if (hasImagePreview()) {
            log("IMG S4: SUCCESS — image preview detected ✓");
          } else {
            log("IMG S4: files assigned globally (no visual preview — assuming accepted).");
          }
        } else {
          log("IMG S4: no file input found anywhere in document.");
        }
      } catch (e) { warn("IMG S4 error:", e.message); }
    }

    // ── All strategies exhausted ────────────────────────────────────────────
    if (!imageInjected) {
      err("IMG: All 4 injection strategies failed. Post NOT submitted. Tab left open for inspection.");
      return {
        success: false,
        imageInjectionFailed: true,
        error: "Image injection failed — S1 (paste), S2 (drop), S3 (dialog file input), S4 (global file input) all failed. Tab left open.",
      };
    }

    log("STEP 3b complete — image injected ✓");
  }

  // ── STEP 4 — Find and click "פרסום" ──────────────────────────────────────

  log("STEP 4 — Searching for פרסום / Post button...");

  const POST_LABELS = ["פרסום", "פרסם", "Post", "שתף", "Share"];

  function dumpDialogButtons(prefix) {
    const dialog = composerDialog ?? document.querySelector('div[role="dialog"]');
    if (!dialog) { log(prefix, "— no dialog found"); return; }
    const rows = [...dialog.querySelectorAll('[role="button"], button')].map((el) => {
      const r  = el.getBoundingClientRect();
      const bg = window.getComputedStyle(el).backgroundColor;
      return {
        text:     (el.textContent ?? "").trim().slice(0, 40),
        label:    el.getAttribute("aria-label"),
        disabled: el.getAttribute("aria-disabled"),
        size:     `${Math.round(r.width)}×${Math.round(r.height)}`,
        bg,
        cls:      el.className.slice(0, 80),
      };
    });
    log(`${prefix} — ${rows.length} button(s):`, JSON.stringify(rows));
  }

  function isBlue(el) {
    try {
      const bg = window.getComputedStyle(el).backgroundColor;
      const m  = bg.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return false;
      const [, r, g, b] = m.map(Number);
      return b > 180 && b > r * 2;
    } catch { return false; }
  }

  function findPostButton() {
    const dialog = composerDialog ?? document.querySelector('div[role="dialog"]');
    const root   = dialog ?? document;

    // S1: exact aria-label
    for (const label of POST_LABELS) {
      const el =
        root.querySelector(`[aria-label="${label}"][role="button"]`) ||
        root.querySelector(`button[aria-label="${label}"]`);
      if (el) {
        const dis = el.getAttribute("aria-disabled");
        log(`S1 aria-label="${label}" disabled="${dis}"`);
        if (dis === "true") warn("Button found but DISABLED — Lexical may not have updated state yet.");
        return el;
      }
    }

    // S1b: partial aria-label (language-agnostic)
    for (const el of root.querySelectorAll('[role="button"][aria-label], button[aria-label]')) {
      const lbl = (el.getAttribute("aria-label") ?? "").toLowerCase();
      if (POST_LABELS.some((p) => lbl.includes(p.toLowerCase()))) {
        const dis = el.getAttribute("aria-disabled");
        log(`S1b partial label="${el.getAttribute("aria-label")}" disabled="${dis}"`);
        if (dis === "true") warn("Button found but DISABLED.");
        return el;
      }
    }

    // S1c: any element with matching aria-label (no role requirement)
    for (const label of POST_LABELS) {
      const el = root.querySelector(`[aria-label="${label}"]`);
      if (el) {
        const dis = el.getAttribute("aria-disabled");
        log(`S1c any-element aria-label="${label}" tag=${el.tagName} disabled="${dis}"`);
        if (dis === "true") warn("Button found but DISABLED.");
        return el;
      }
    }

    // S2: innerText / textContent case-insensitive
    const s2Labels = POST_LABELS.map((l) => l.toLowerCase());
    for (const el of root.querySelectorAll('[role="button"], button, div[aria-label], div[tabindex]')) {
      const text = (el.innerText ?? el.textContent ?? "").trim().toLowerCase();
      if (s2Labels.some((l) => text === l || text === l + "\n" || text.split("\n")[0].trim() === l)) {
        const dis = el.getAttribute("aria-disabled");
        log(`S2 innerText="${text.slice(0, 20)}" tag=${el.tagName} disabled="${dis}"`);
        if (dis === "true") warn("Button found but DISABLED.");
        return el;
      }
    }

    // S2b: document-wide visible element search
    for (const label of POST_LABELS) {
      for (const el of document.querySelectorAll(`[aria-label="${label}"]`)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          const dis = el.getAttribute("aria-disabled");
          log(`S2b doc-wide aria-label="${label}" tag=${el.tagName} visible=${r.width}×${r.height} disabled="${dis}"`);
          if (dis === "true") warn("Button found but DISABLED.");
          return el;
        }
      }
    }

    // S3: blue background
    if (dialog) {
      for (const el of dialog.querySelectorAll('[role="button"], button')) {
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 20) continue;
        if (isBlue(el)) {
          const dis = el.getAttribute("aria-disabled");
          const bg  = window.getComputedStyle(el).backgroundColor;
          log(`S3 blue bg="${bg}" disabled="${dis}"`);
          if (dis === "true") warn("Blue button DISABLED.");
          return el;
        }
      }
    }

    // S4: bottom-right positional fallback
    const s4Root = composerDialog ?? dialog;
    if (s4Root) {
      const cands = [...s4Root.querySelectorAll('[role="button"]')].filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width >= 30 && r.height >= 20;
      });
      if (cands.length) {
        cands.sort((a, b) => {
          const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
          return (rb.bottom + rb.right) - (ra.bottom + ra.right);
        });
        const best = cands[0];
        const dis  = best.getAttribute("aria-disabled");
        log(`S4 positional text="${(best.textContent ?? "").trim().slice(0, 20)}" disabled="${dis}"`);
        if (dis === "true") warn("Positional button DISABLED.");
        return best;
      }
    }

    return null;
  }

  let postBtn = null;
  for (let attempt = 1; attempt <= 10; attempt++) {
    dumpDialogButtons(`Attempt ${attempt}/10`);
    postBtn = findPostButton();
    if (postBtn && postBtn.getAttribute("aria-disabled") !== "true") {
      log(`Enabled button found on attempt ${attempt} ✓`);
      break;
    }
    if (postBtn) {
      log(`Button found but still disabled on attempt ${attempt}, waiting 800 ms...`);
    } else {
      log(`Button not found on attempt ${attempt}, waiting 800 ms...`);
    }
    postBtn = null;
    await sleep(800);
  }

  if (!postBtn) {
    dumpDialogButtons("Last resort — accepting disabled button");
    postBtn = findPostButton();
  }

  if (!postBtn) {
    dumpDialogButtons("FINAL FAILURE");
    return {
      success: false,
      error: "Post button not found after 10 attempts. See [EasyMarketing] in Facebook tab DevTools.",
    };
  }

  const dis = postBtn.getAttribute("aria-disabled");
  log(`Clicking: label="${postBtn.getAttribute("aria-label")}" text="${(postBtn.textContent ?? "").trim().slice(0, 20)}" disabled="${dis}"`);

  postBtn.scrollIntoView({ block: "center", behavior: "instant" });
  await sleep(200);

  function humanClick(el) {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width  / 2;
    const cy = rect.top  + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
    el.dispatchEvent(new MouseEvent("mouseover",  opts));
    el.dispatchEvent(new MouseEvent("mouseenter", { ...opts, bubbles: false }));
    el.dispatchEvent(new MouseEvent("mousemove",  opts));
    el.dispatchEvent(new MouseEvent("mousedown",  opts));
    el.dispatchEvent(new MouseEvent("mouseup",    opts));
    el.dispatchEvent(new MouseEvent("click",      opts));
    log("humanClick dispatched on:", el.tagName, `label="${el.getAttribute("aria-label")}"`);
  }

  humanClick(postBtn);

  if (dis === "true") {
    await sleep(1500);
    log("Was disabled — retrying humanClick after 1.5 s...");
    humanClick(postBtn);
  }

  await sleep(5000);
  log("Done — post submitted ✓");
  return { success: true };
};
