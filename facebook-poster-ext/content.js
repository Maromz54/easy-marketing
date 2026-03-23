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

  log(`Composer: role="${composer.getAttribute("role")}" contenteditable="${composer.contentEditable}"`);

  // Scope all future searches to the dialog that owns this composer.
  // Moving this here (rather than step 4) so step 3b can use it safely.
  const composerDialog = composer.closest('div[role="dialog"]') ?? null;
  log(`Composer dialog found: ${!!composerDialog}`);

  // ── STEP 3 — Text injection ───────────────────────────────────────────────
  //
  // Root cause of previous failures: firing extra synthetic events (input,
  // change, keydown) AFTER execCommand caused Lexical to process the text a
  // second time → double text in the editor → corrupted state → button disabled.
  //
  // Fix: ONE clean execCommand call, zero extra events afterwards.
  // execCommand('insertText') already fires a trusted native beforeinput event
  // that Lexical processes correctly on its own.

  log("STEP 3 — Injecting text (clean single execCommand)...");

  // 1. Full pointer sequence so Lexical activates the editor
  composer.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  await sleep(60);
  composer.dispatchEvent(new MouseEvent("mouseup",   { bubbles: true, cancelable: true }));
  composer.dispatchEvent(new MouseEvent("click",     { bubbles: true, cancelable: true }));
  await sleep(300);

  // 2. Focus
  composer.focus();
  await sleep(400);

  log("activeElement after focus:", document.activeElement?.tagName,
      `role="${document.activeElement?.getAttribute("role")}"`,
      "| isComposer:", document.activeElement === composer);

  // 3. Place cursor at end of any existing content
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

  // 4. selectAll to clear any placeholder / stale content
  document.execCommand("selectAll", false);
  await sleep(80);

  // 5. Insert text — ONE call, NO extra events.
  //    execCommand fires its own trusted beforeinput/input events internally.
  const ok = document.execCommand("insertText", false, fullContent);
  log(`execCommand('insertText') returned: ${ok}`);
  log("Composer text after inject:", JSON.stringify((composer.textContent ?? "").slice(0, 80)));

  // 6. Wait 2 s for Lexical to process the input and ENABLE the Post button
  log("Waiting 2 s for Lexical to enable the פרסום button...");
  await sleep(2000);

  // Verify
  const injected = (composer.textContent ?? "").includes(fullContent.slice(0, 15));
  if (!injected) {
    // Fallback: DataTransfer paste — also fires clean native events
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

    const injectedFallback = (composer.textContent ?? "").includes(fullContent.slice(0, 15));
    if (!injectedFallback) {
      err("Both injection methods failed. Composer text:", JSON.stringify((composer.textContent ?? "").slice(0, 100)));
      return {
        success: false,
        error: "Text injection failed (execCommand + paste both failed). See [EasyMarketing] logs in Facebook tab DevTools.",
      };
    }
    log("Paste fallback succeeded.");
  } else {
    log("Text injection confirmed ✓");
  }

  // ── STEP 3b — Image attachment (non-fatal) ────────────────────────────────
  //
  // Strategy (each step is tried only if the previous one fails):
  //   S-IMG-1 (primary)  : ClipboardEvent('paste') with DataTransfer on composer
  //   S-IMG-2 (fallback) : DragEvent('drop') with DataTransfer on dialog/composer
  //   S-IMG-3 (fallback) : Assign files to hidden <input type="file">, or click
  //                        the photo-toolbar button first to reveal it
  //
  // Note: composerDialog is defined right after step 2, so it is safe to use here.

  if (imageUrl) {
    log("STEP 3b — Attaching image:", imageUrl);
    let imageInjected = false;

    try {
      log("IMG: Fetching image blob from:", imageUrl);
      const resp = await fetch(imageUrl);
      if (!resp.ok) throw new Error(`fetch ${resp.status} ${resp.statusText}`);
      const blob = await resp.blob();
      log(`IMG: Blob received — type=${blob.type} size=${blob.size} bytes`);

      const filename = decodeURIComponent(imageUrl.split("/").pop() || "image.jpg");
      const file = new File([blob], filename, { type: blob.type || "image/jpeg" });

      function hasImagePreview() {
        return !!(
          composerDialog?.querySelector('img[src^="blob:"]') ||
          composerDialog?.querySelector('[data-visualcompletion="media-vc-image"]') ||
          composerDialog?.querySelector('div[role="img"]')
        );
      }

      // ── S-IMG-1: paste event on the Lexical contenteditable ──────────────
      log("IMG S1: Dispatching paste event on composer...");
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        composer.focus();
        await sleep(150);
        const pasteEvt = new ClipboardEvent("paste", {
          bubbles: true, cancelable: true, clipboardData: dt,
        });
        composer.dispatchEvent(pasteEvt);
        log("IMG S1: paste dispatched — waiting 3 s for Facebook to render preview...");
        await sleep(3000);
        if (hasImagePreview()) {
          imageInjected = true;
          log("IMG S1: SUCCESS — image preview detected in dialog ✓");
        } else {
          log("IMG S1: paste dispatched but no image preview found — trying S-IMG-2...");
        }
      } catch (e) { warn("IMG S1 error:", e.message); }

      // ── S-IMG-2: drop event on composerDialog ────────────────────────────
      if (!imageInjected) {
        log("IMG S2: Dispatching drop events on composer dialog...");
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
            log("IMG S2: drop dispatched but no image preview — trying S-IMG-3...");
          }
        } catch (e) { warn("IMG S2 error:", e.message); }
      }

      // ── S-IMG-3: file input (direct or via photo-toolbar button) ─────────
      if (!imageInjected) {
        log("IMG S3: Looking for hidden file input...");
        try {
          const dt = new DataTransfer();
          dt.items.add(file);

          let fileInput =
            document.querySelector('div[role="dialog"] input[type="file"][accept*="image"]') ||
            document.querySelector('div[role="dialog"] input[type="file"]');

          if (!fileInput) {
            log("IMG S3: file input not in DOM — looking for photo toolbar button...");
            const PHOTO_LABELS = ["תמונה/סרטון", "Photo/video", "Photo", "תמונה", "Add photos/videos"];
            let photoBtn = null;
            for (const label of PHOTO_LABELS) {
              photoBtn = document.querySelector(`[aria-label="${label}"]`);
              if (photoBtn) { log(`IMG S3: photo button found via label "${label}"`); break; }
            }
            if (!photoBtn) {
              for (const el of document.querySelectorAll('[role="dialog"] [role="button"]')) {
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
                document.querySelector('input[type="file"][accept*="image"]') ||
                document.querySelector('input[type="file"]');
            }
          }

          if (fileInput) {
            Object.defineProperty(fileInput, "files", { value: dt.files, configurable: true });
            fileInput.dispatchEvent(new Event("change", { bubbles: true }));
            fileInput.dispatchEvent(new Event("input",  { bubbles: true }));
            log("IMG S3: files set on input — waiting 3 s...");
            await sleep(3000);
            imageInjected = true;
            log("IMG S3: file input injection done (preview detection skipped — file input less reliable)");
          } else {
            warn("IMG S3: no file input found — all image injection methods exhausted.");
          }
        } catch (e) { warn("IMG S3 error:", e.message); }
      }

      if (!imageInjected) {
        warn("IMG: All injection methods failed — post will be published text-only.");
      }

    } catch (imgErr) {
      warn("IMG: Failed to fetch image (non-fatal) — continuing text-only:", imgErr.message);
    }
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

    // S1b: partial aria-label (language-agnostic, role="button" or button)
    for (const el of root.querySelectorAll('[role="button"][aria-label], button[aria-label]')) {
      const lbl = (el.getAttribute("aria-label") ?? "").toLowerCase();
      if (POST_LABELS.some((p) => lbl.includes(p.toLowerCase()))) {
        const dis = el.getAttribute("aria-disabled");
        log(`S1b partial label="${el.getAttribute("aria-label")}" disabled="${dis}"`);
        if (dis === "true") warn("Button found but DISABLED.");
        return el;
      }
    }

    // S1c: any element with matching aria-label (no role requirement — catches div[aria-label="פרסום"])
    for (const label of POST_LABELS) {
      const el = root.querySelector(`[aria-label="${label}"]`);
      if (el) {
        const dis = el.getAttribute("aria-disabled");
        log(`S1c any-element aria-label="${label}" tag=${el.tagName} disabled="${dis}"`);
        if (dis === "true") warn("Button found but DISABLED.");
        return el;
      }
    }

    // S2: innerText / textContent (case-insensitive, also checks divs without role="button")
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

    // S2b: document-wide search for visible elements with matching aria-label (catches any wrappers)
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

    // S3: blue background — primary button colour rarely changes
    if (dialog) {
      for (const el of dialog.querySelectorAll('[role="button"], button')) {
        const r = el.getBoundingClientRect();
        if (r.width < 40 || r.height < 20) continue;
        if (isBlue(el)) {
          const dis = el.getAttribute("aria-disabled");
          const bg  = window.getComputedStyle(el).backgroundColor;
          log(`S3 blue bg="${bg}" disabled="${dis}"`);
          if (dis === "true") warn("Blue button DISABLED — Lexical state not updated.");
          return el;
        }
      }
    }

    // S4: bottom-right positional fallback (scoped to composer dialog)
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
    postBtn = null; // keep waiting for enabled state
    await sleep(800);
  }

  // Last resort: accept a disabled button rather than give up entirely
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

  // Scroll the button into view so it has a real bounding box
  postBtn.scrollIntoView({ block: "center", behavior: "instant" });
  await sleep(200);

  // Human-like click: full pointer event sequence
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
  log("Done — post submitted.");
  return { success: true };
};
