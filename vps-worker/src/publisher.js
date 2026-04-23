import { chromium } from 'playwright';
import { mkdir, readFile } from 'fs/promises';
import path from 'path';
import { sleep, randomBetween, downloadImage, cleanup } from './utils.js';

const SESSION_DIR = '/home/ubuntu/fb-session';
const ERRORS_DIR  = '/home/ubuntu/fb-errors';
const HEADLESS    = false;

let _browser = null;

export async function getBrowser(headless = HEADLESS) {
  if (_browser) return _browser;
  await mkdir(SESSION_DIR, { recursive: true });
  await mkdir(ERRORS_DIR,  { recursive: true });
  _browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless,
    channel: 'chrome',
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
    timezoneId: 'Asia/Jerusalem',
    locale: 'he-IL',
  });
  console.log('[browser] Persistent context started (single instance)');
  return _browser;
}

export async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
    console.log('[browser] Context closed');
  }
}

/**
 * Post to a Facebook group via browser automation.
 * Logic mirrors the Chrome Extension's easyMarketingPost() in content.js.
 */
export async function postToGroup(postId, groupId, content, imageUrls = [], linkUrl = null) {
  const browser  = await getBrowser();
  const page     = await browser.newPage();
  const tmpFiles = [];

  // Build full post content: text body + link URL appended (if any)
  const fullContent = linkUrl ? `${content}\n\n${linkUrl}` : content;

  try {
    // ── 1. Navigate ───────────────────────────────────────────────────────
    console.log(`[publisher] post=${postId} Navigating to group ${groupId}`);
    await page.goto(`https://www.facebook.com/groups/${groupId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('checkpoint')) {
      throw new Error('SESSION_EXPIRED');
    }

    const bodyText = await page.textContent('body').catch(() => '');
    if (
      bodyText?.toLowerCase().includes('suspicious activity') ||
      bodyText?.toLowerCase().includes('verify your identity') ||
      bodyText?.toLowerCase().includes('your account has been') ||
      bodyText?.toLowerCase().includes("you've been blocked") ||
      bodyText?.toLowerCase().includes('security check') ||
      bodyText?.includes('אימות זהות') ||
      bodyText?.includes('בדיקת אבטחה')
    ) {
      throw new Error('FACEBOOK_BLOCKED');
    }

    await sleep(randomBetween(2000, 4000));

    // Brief human-like scroll, then snap back to top so the compose
    // trigger isn't removed by Facebook's virtual scroll engine.
    await page.mouse.wheel(0, randomBetween(300, 600));
    await sleep(randomBetween(800, 1500));
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(500);

    // ── 2. Click the compose trigger (mirrors extension STEP 1) ──────────
    const triggerResult = await page.evaluate(() => {
      const TRIGGER_TEXTS = [
        'כאן כותבים...', 'Write something...', 'כתוב משהו...',
        'מה אתה חושב?', "What's on your mind?",
      ];

      // aria-label / aria-placeholder (most reliable)
      for (const text of TRIGGER_TEXTS) {
        const el = document.querySelector(`[aria-label="${text}"]`) ||
                   document.querySelector(`[aria-placeholder="${text}"]`);
        if (el) { el.click(); return `aria: "${text}"`; }
      }

      // div[role="button"] with matching text content
      for (const el of document.querySelectorAll('div[role="button"]')) {
        const txt = (el.textContent ?? '').trim();
        if (TRIGGER_TEXTS.some(t => txt.includes(t.replace('...', '')))) {
          el.click();
          return `text: "${txt.slice(0, 50)}"`;
        }
      }

      // Broad fallback: any element whose direct text node starts with a compose phrase
      const phrases = ['כאן כותבים', 'מה אתה חושב', 'Write something', "What's on your mind"];
      for (const el of document.querySelectorAll('*')) {
        const own = [...el.childNodes]
          .filter(n => n.nodeType === 3)
          .map(n => n.textContent.trim())
          .join('');
        if (own.length > 0 && own.length < 60 && phrases.some(p => own.startsWith(p))) {
          el.click();
          return `fallback: "${own.slice(0, 40)}"`;
        }
      }

      return null;
    });

    if (!triggerResult) throw new Error('Could not find compose button in group');
    console.log(`[publisher] post=${postId} Compose trigger clicked via: ${triggerResult}`);

    // Wait for the composer dialog to open
    await sleep(3000);

    // ── 3. Find Lexical editor INSIDE the dialog (mirrors extension STEP 2) ──
    // Scoping to div[role="dialog"] prevents accidentally targeting comment boxes.
    const COMPOSER_SELECTORS = [
      'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
      'div[role="dialog"] div[data-lexical-editor="true"]',
      'div[role="dialog"] div[contenteditable="true"][spellcheck="true"]',
      'div[role="dialog"] div[contenteditable="true"]',
    ];

    let composerEl = null;
    for (let attempt = 1; attempt <= 15; attempt++) {
      for (const sel of COMPOSER_SELECTORS) {
        try {
          const el = await page.locator(sel).first().elementHandle({ timeout: 500 });
          if (el) { composerEl = el; break; }
        } catch {}
      }
      if (composerEl) {
        console.log(`[publisher] post=${postId} Composer found (attempt ${attempt})`);
        break;
      }
      await sleep(1000);
    }
    if (!composerEl) throw new Error('Could not find composer editor in dialog');

    // ── 4. Upload images FIRST (before text injection) ───────────────────
    // CRITICAL: Clicking the photo button resets the Lexical editor content.
    // By uploading images on the empty composer first, we avoid losing text.
    if (imageUrls.length > 0) {
      console.log(`[publisher] post=${postId} Downloading ${imageUrls.length} image(s)`);
      for (const url of imageUrls) {
        const tmp = await downloadImage(url);
        tmpFiles.push(tmp);
      }

      let imgStrategy = null;

      // S0-a: Try setInputFiles on an already-existing hidden file input
      // (Facebook often pre-mounts one in the DOM before any button click)
      try {
        const existingInput = page.locator('input[type="file"][accept*="image"]').last();
        if (await existingInput.count() > 0) {
          await existingInput.setInputFiles(tmpFiles);
          await sleep(Math.max(4000, tmpFiles.length * 2000));
          imgStrategy = 'S0a-direct-input';
          console.log(`[publisher] post=${postId} Image inject: ${imgStrategy}`);
        }
      } catch (e) {
        console.warn(`[publisher] post=${postId} S0a failed: ${e.message}`);
      }

      // S0-b: Click photo button (composer still empty → no text lost), then setInputFiles
      if (!imgStrategy) {
        try {
          const PHOTO_LABELS = [
            '[aria-label="תמונה/סרטון"]', '[aria-label="Photo/video"]',
            '[aria-label="Photo"]',        '[aria-label="תמונה"]',
            '[aria-label="Add photos/videos"]',
          ];
          const photoBtn = page.locator(PHOTO_LABELS.join(', ')).first();

          if (await photoBtn.count() > 0) {
            await photoBtn.click({ timeout: 4000 });
            await sleep(1500);
          } else {
            // Broader fallback: any SVG-icon button in the dialog toolbar
            await page.evaluate(() => {
              const dialog = document.querySelector('div[role="dialog"]');
              const toolbar = dialog?.querySelectorAll('[role="button"]') ?? [];
              for (const btn of toolbar) {
                const lbl = btn.getAttribute('aria-label') ?? '';
                if (/תמונ|photo|image|media/i.test(lbl)) { btn.click(); return; }
              }
            });
            await sleep(1500);
          }

          const fileInput = page.locator('input[type="file"]').last();
          if (await fileInput.count() > 0) {
            await fileInput.setInputFiles(tmpFiles);
            await sleep(Math.max(4000, tmpFiles.length * 2000));
            imgStrategy = 'S0b-after-photo-btn';
            console.log(`[publisher] post=${postId} Image inject: ${imgStrategy}`);
          }
        } catch (e) {
          console.warn(`[publisher] post=${postId} S0b failed: ${e.message}`);
        }
      }

      if (!imgStrategy) {
        console.warn(`[publisher] post=${postId} Image upload failed — continuing without images`);
      }

      // After image upload, the dialog may have changed state.
      // Wait for it to settle before finding the composer for text injection.
      await sleep(1000);
    }

    // ── 5. Re-find the composer (it may have expanded after image upload) ─
    // The dialog structure changes when photos are attached — re-query fresh.
    composerEl = null;
    const COMPOSER_SELECTORS2 = [
      'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
      'div[role="dialog"] div[data-lexical-editor="true"]',
      'div[role="dialog"] div[contenteditable="true"][spellcheck="true"]',
      'div[role="dialog"] div[contenteditable="true"]',
    ];
    for (let attempt = 1; attempt <= 10; attempt++) {
      for (const sel of COMPOSER_SELECTORS2) {
        try {
          const el = await page.locator(sel).first().elementHandle({ timeout: 500 });
          if (el) { composerEl = el; break; }
        } catch {}
      }
      if (composerEl) break;
      await sleep(800);
    }
    if (!composerEl) throw new Error('Could not find composer editor after image upload');

    // ── 6. Inject text ────────────────────────────────────────────────────

    // Helper: check that text AND line breaks were injected into Lexical.
    const expectedNewlines = (fullContent.match(/\n/g) ?? []).length;

    const checkInjected = async () => {
      return page.evaluate(({ el, text, newlines }) => {
        const composerText = el.textContent ?? '';
        if (!composerText.includes(text.slice(0, 15).replace(/\n/g, ''))) return false;
        if (newlines > 0) {
          const paragraphCount = el.querySelectorAll('p').length;
          return paragraphCount > 1;
        }
        return true;
      }, { el: composerEl, text: fullContent, newlines: expectedNewlines });
    };

    // Method 0: Playwright-native keyboard (real CDP keystrokes — Lexical treats as user input)
    let injected = false;
    try {
      await composerEl.click();
      await sleep(200);
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Delete');
      await sleep(150);

      const lines = fullContent.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].length > 0) {
          await page.keyboard.insertText(lines[i]);
        }
        if (i < lines.length - 1) {
          await page.keyboard.press('Enter');
          await sleep(40);
        }
      }
      await sleep(500);
      injected = await checkInjected();
      console.log(`[publisher] post=${postId} Text M0 injected=${injected}`);
    } catch (e) {
      console.warn(`[publisher] post=${postId} M0 failed: ${e.message}`);
    }

    // Method 1: execCommand (fallback)
    if (!injected) {
      await page.evaluate(({ el, text }) => {
        el.focus();
        document.execCommand('selectAll', false);
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i]) document.execCommand('insertText', false, lines[i]);
          if (i < lines.length - 1) document.execCommand('insertParagraph', false);
        }
      }, { el: composerEl, text: fullContent });
      await sleep(500);
      injected = await checkInjected();
      console.log(`[publisher] post=${postId} Text M1 injected=${injected}`);
    }

    // Method 2: DataTransfer paste (fallback)
    if (!injected) {
      await page.evaluate(({ el, text }) => {
        el.focus();
        document.execCommand('selectAll', false);
        document.execCommand('delete', false);
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }, { el: composerEl, text: fullContent });
      await sleep(2000);
      injected = await checkInjected();
      console.log(`[publisher] post=${postId} Text M2 injected=${injected}`);
    }

    // Method 3: char-by-char InputEvent (last resort)
    if (!injected) {
      await page.evaluate(async ({ el, text }) => {
        el.focus();
        document.execCommand('selectAll', false);
        document.execCommand('delete', false);
        await new Promise(r => setTimeout(r, 200));
        for (let i = 0; i < text.length; i++) {
          const char = text[i], isNewline = char === '\n';
          const key = isNewline ? 'Enter' : char, keyCode = isNewline ? 13 : char.charCodeAt(0);
          el.dispatchEvent(new KeyboardEvent('keydown', { key, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true }));
          el.dispatchEvent(new InputEvent('beforeinput', { inputType: isNewline ? 'insertParagraph' : 'insertText', data: isNewline ? null : char, bubbles: true, cancelable: true, composed: true }));
          el.dispatchEvent(new InputEvent('input', { inputType: isNewline ? 'insertParagraph' : 'insertText', data: isNewline ? null : char, bubbles: true, cancelable: false, composed: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', { key, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true }));
          if (i % 10 === 9) await new Promise(r => setTimeout(r, 20));
        }
      }, { el: composerEl, text: fullContent });
      await sleep(2000);
      injected = await checkInjected();
      console.log(`[publisher] post=${postId} Text M3 injected=${injected}`);
    }

    if (!injected) throw new Error('Text injection failed — all methods failed');
    console.log(`[publisher] post=${postId} Text injection confirmed ✓`);
    await sleep(2000);

    // ── 6a. Link preview hydration ────────────────────────────────────────
    if (linkUrl) {
      try {
        await page.evaluate(el => {
          el.focus();
          const sel = window.getSelection();
          if (sel && el.lastChild) { sel.selectAllChildren(el); sel.collapseToEnd(); }
        }, composerEl);
        await sleep(300);
        await page.evaluate(el => {
          const opts = { key: ' ', code: 'Space', keyCode: 32, which: 32, bubbles: true, cancelable: true, composed: true };
          el.dispatchEvent(new KeyboardEvent('keydown', opts));
          document.execCommand('insertText', false, ' ');
          el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: ' ', bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keyup', opts));
        }, composerEl);
        await sleep(3000);
        console.log(`[publisher] post=${postId} Link preview hydration done`);
      } catch (e) {
        console.warn(`[publisher] post=${postId} Link preview error: ${e.message}`);
      }
    }

    // (no more image upload section — moved to step 4 above)
    // Strategies S1–S4 (JS event dispatch) — legacy, kept for reference only
    if (false) try {
        const imageData = await Promise.all(
          tmpFiles.map(async (p) => ({
            b64:  (await readFile(p)).toString('base64'),
            name: path.basename(p),
            mime: p.endsWith('.png') ? 'image/png' : p.endsWith('.gif') ? 'image/gif' : 'image/jpeg',
          }))
        );

        const imgResult = await page.evaluate(async (images) => {
          const files = images.map(({ b64, name, mime }) => {
            const bin   = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
            return new File([new Blob([bytes], { type: mime })], name, { type: mime });
          });
          const dt = new DataTransfer();
          files.forEach(f => dt.items.add(f));

          const dialog   = document.querySelector('div[role="dialog"]');
          const composer = dialog?.querySelector('[contenteditable="true"]');

          function assignToFileInput(input) {
            Object.defineProperty(input, 'files', { value: dt.files, configurable: true });
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('input',  { bubbles: true }));
          }

          function hasPreview() {
            return !!(
              dialog?.querySelector('img[src^="blob:"]') ||
              dialog?.querySelector('[data-visualcompletion="media-vc-image"]') ||
              dialog?.querySelector('div[role="img"]') ||
              dialog?.querySelector('img[src]:not([src=""])')
            );
          }

          // S1: paste event on the Lexical editor
          if (composer) {
            composer.focus();
            await new Promise(r => setTimeout(r, 150));
            composer.dispatchEvent(new ClipboardEvent('paste', {
              bubbles: true, cancelable: true, clipboardData: dt,
            }));
            await new Promise(r => setTimeout(r, 3000));
            if (hasPreview()) return 'S1-paste-ok';
          }

          // S2: drop event on dialog
          const dropTarget = dialog ?? composer;
          if (dropTarget) {
            dropTarget.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
            await new Promise(r => setTimeout(r, 80));
            dropTarget.dispatchEvent(new DragEvent('dragover',  { dataTransfer: dt, bubbles: true, cancelable: true }));
            await new Promise(r => setTimeout(r, 80));
            dropTarget.dispatchEvent(new DragEvent('drop',      { dataTransfer: dt, bubbles: true, cancelable: true }));
            await new Promise(r => setTimeout(r, 3000));
            if (hasPreview()) return 'S2-drop-ok';
          }

          // S3: click photo toolbar button then look globally for file input
          const PHOTO_LABELS = ['תמונה/סרטון', 'Photo/video', 'Photo', 'תמונה', 'Add photos/videos'];
          const root = dialog ?? document;
          let photoBtn = null;
          for (const lbl of PHOTO_LABELS) {
            photoBtn = root.querySelector(`[aria-label="${lbl}"]`);
            if (photoBtn) break;
          }
          if (!photoBtn) {
            for (const el of root.querySelectorAll('[role="button"]')) {
              if (PHOTO_LABELS.some(l => (el.textContent ?? '').trim().includes(l))) {
                photoBtn = el; break;
              }
            }
          }
          if (photoBtn) {
            photoBtn.click();
            await new Promise(r => setTimeout(r, 1500));
          }

          // After clicking photo button, scan the WHOLE document (not just dialog)
          let fileInput =
            document.querySelector('input[type="file"][accept*="image"]') ??
            document.querySelector('input[type="file"]') ??
            null;

          if (fileInput) {
            assignToFileInput(fileInput);
            await new Promise(r => setTimeout(r, 3000));
            // File inputs don't always produce a detectable preview; assume success
            if (hasPreview()) return 'S3-dialog-input-ok (preview)';
            return 'S3-dialog-input-ok (assumed)';
          }

          // S4: global file input scan (most specific accept pattern first)
          const patterns = [
            'input[type="file"][accept="image/*,image/heif,image/heic"]',
            'input[type="file"][accept*="image/heic"]',
            'input[type="file"][accept^="image"]',
            'input[type="file"][accept*="image/"]',
            'input[type="file"][accept*="video/"]',
            'input[type="file"]',
          ];
          for (const pat of patterns) {
            const inputs = [...document.querySelectorAll(pat)];
            if (inputs.length > 0) {
              const inp = inputs.find(el => el.files?.length === 0) ?? inputs[0];
              assignToFileInput(inp);
              await new Promise(r => setTimeout(r, 3000));
              return `S4-global-ok (${pat})`;
            }
          }
          return 'no-input-found';
        }, imageData);

        console.log(`[publisher] post=${postId} Image inject: ${imgResult}`);

        if (imgResult !== 'no-input-found') {
          const extraWait = Math.max(3000, tmpFiles.length * 2000);
          await sleep(extraWait);
          console.log(`[publisher] post=${postId} Images ready`);
        } else {
          console.warn(`[publisher] post=${postId} All image strategies failed`);
        }
      } catch (imgErr) {
        console.warn(`[publisher] post=${postId} Image upload error: ${imgErr.message}`);
      }
    }

    // ── 5a. Pre-submit verification log ──────────────────────────────────
    const verify = await page.evaluate(() => {
      const dialog = document.querySelector('div[role="dialog"]');
      const editor = dialog?.querySelector('[contenteditable="true"]');
      return {
        paragraphs: editor?.querySelectorAll('p').length ?? 0,
        textLen:    (editor?.textContent ?? '').length,
        hasImage:   !!(
          dialog?.querySelector('img[src^="blob:"]') ||
          dialog?.querySelector('[data-visualcompletion="media-vc-image"]')
        ),
      };
    });
    console.log(
      `[publisher] post=${postId} Pre-submit: p=${verify.paragraphs} ` +
      `len=${verify.textLen} img=${verify.hasImage}`
    );

    // ── 6. Find and click Post button (mirrors extension STEP 4) ─────────
    const POST_LABELS = ['פרסום', 'פרסם', 'Post', 'שתף', 'Share'];

    let posted = false;
    for (let attempt = 1; attempt <= 10; attempt++) {
      const result = await page.evaluate((labels) => {
        const dialog = document.querySelector('div[role="dialog"]');
        const root   = dialog ?? document;

        function humanClick(el) {
          const r  = el.getBoundingClientRect();
          const cx = r.left + r.width  / 2;
          const cy = r.top  + r.height / 2;
          const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
          el.dispatchEvent(new MouseEvent('mouseover',  opts));
          el.dispatchEvent(new MouseEvent('mousedown',  opts));
          el.dispatchEvent(new MouseEvent('mouseup',    opts));
          el.dispatchEvent(new MouseEvent('click',      opts));
        }

        // S1: exact aria-label
        for (const label of labels) {
          const el = root.querySelector(`[aria-label="${label}"][role="button"]`) ||
                     root.querySelector(`button[aria-label="${label}"]`) ||
                     root.querySelector(`[aria-label="${label}"]`);
          if (el && el.getAttribute('aria-disabled') !== 'true') {
            el.scrollIntoView({ block: 'center', behavior: 'instant' });
            humanClick(el);
            return `S1 aria-label="${label}"`;
          }
        }

        // S2: text content match
        const lower = labels.map(l => l.toLowerCase());
        for (const el of root.querySelectorAll('[role="button"], button')) {
          const txt = (el.textContent ?? '').trim().toLowerCase();
          if (lower.includes(txt) && el.getAttribute('aria-disabled') !== 'true') {
            el.scrollIntoView({ block: 'center', behavior: 'instant' });
            humanClick(el);
            return `S2 text="${txt}"`;
          }
        }

        // S3: blue background button (Facebook's submit button is blue)
        if (dialog) {
          for (const el of dialog.querySelectorAll('[role="button"], button')) {
            const r = el.getBoundingClientRect();
            if (r.width < 40 || r.height < 20) continue;
            try {
              const bg = window.getComputedStyle(el).backgroundColor;
              const m  = bg.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/);
              if (m) {
                const [, r2, g, b] = m.map(Number);
                if (b > 180 && b > r2 * 2 && el.getAttribute('aria-disabled') !== 'true') {
                  el.scrollIntoView({ block: 'center', behavior: 'instant' });
                  humanClick(el);
                  return `S3 blue bg="${bg}"`;
                }
              }
            } catch {}
          }
        }

        // S4: bottom-right positional (last enabled button in dialog)
        if (dialog) {
          const cands = [...dialog.querySelectorAll('[role="button"]')]
            .filter(el => {
              const r = el.getBoundingClientRect();
              return r.width >= 30 && r.height >= 20 && el.getAttribute('aria-disabled') !== 'true';
            })
            .sort((a, b) => {
              const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
              return (rb.bottom + rb.right) - (ra.bottom + ra.right);
            });
          if (cands[0]) {
            cands[0].scrollIntoView({ block: 'center', behavior: 'instant' });
            humanClick(cands[0]);
            return `S4 positional text="${(cands[0].textContent ?? '').trim().slice(0, 20)}"`;
          }
        }

        return null;
      }, POST_LABELS);

      if (result) {
        posted = true;
        console.log(`[publisher] post=${postId} Post button clicked via: ${result}`);
        break;
      }

      console.log(`[publisher] post=${postId} Post button not ready (attempt ${attempt}/10)`);
      await sleep(800);
    }

    if (!posted) throw new Error('Could not find the Post button');

    // ── 7. Wait for dialog to close (success indicator) ───────────────────
    console.log(`[publisher] post=${postId} Waiting for composer to close...`);
    const deadline = Date.now() + 20_000;
    let composerGone = false;
    while (!composerGone && Date.now() < deadline) {
      await sleep(500);
      composerGone = await page
        .evaluate(() => !document.querySelector('div[role="dialog"]'))
        .catch(() => true);
    }
    if (!composerGone) {
      throw new Error('Composer still open after Post click — publish may have failed');
    }

    console.log(`[publisher] post=${postId} ✓ Successfully posted to group ${groupId}`);

  } catch (err) {
    try {
      const screenshotPath = `${ERRORS_DIR}/post-${postId}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.error(`[publisher] post=${postId} Screenshot saved: ${screenshotPath}`);
    } catch {}
    throw err;
  } finally {
    await page.close().catch(() => {});
    await cleanup(...tmpFiles);
  }
}
