import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
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

  // Single source of truth for composer selectors (Lexical editor inside dialog)
  const DIALOG_COMPOSER_SEL = [
    'div[role="dialog"] div[role="textbox"][contenteditable="true"]',
    'div[role="dialog"] div[data-lexical-editor="true"]',
    'div[role="dialog"] div[contenteditable="true"][spellcheck="true"]',
    'div[role="dialog"] div[contenteditable="true"]',
  ].join(', ');

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
    // Retry up to 8 times — Facebook's compose button may render late on slow connections.
    let triggerResult = null;
    for (let attempt = 1; attempt <= 8; attempt++) {
      triggerResult = await page.evaluate(() => {
        const TRIGGER_TEXTS = [
          'כאן כותבים...', 'Write something...', 'כתוב משהו...',
          'מה אתה חושב?', "What's on your mind?",
        ];

        for (const text of TRIGGER_TEXTS) {
          const el = document.querySelector(`[aria-label="${text}"]`) ||
                     document.querySelector(`[aria-placeholder="${text}"]`);
          if (el) { el.click(); return `aria: "${text}"`; }
        }

        for (const el of document.querySelectorAll('div[role="button"]')) {
          const txt = (el.textContent ?? '').trim();
          if (TRIGGER_TEXTS.some(t => txt.includes(t.replace('...', '')))) {
            el.click();
            return `text: "${txt.slice(0, 50)}"`;
          }
        }

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

      if (triggerResult) break;
      console.log(`[publisher] post=${postId} Compose trigger not found (attempt ${attempt}/8)`);
      await sleep(1500);
    }

    if (!triggerResult) throw new Error('Could not find compose button in group');
    console.log(`[publisher] post=${postId} Compose trigger clicked via: ${triggerResult}`);

    // Wait for the composer dialog to open
    await sleep(3000);

    // ── 3. Find Lexical editor INSIDE the dialog (mirrors extension STEP 2) ──
    // Scoping to div[role="dialog"] prevents accidentally targeting comment boxes.
    let composerEl = null;
    for (let attempt = 1; attempt <= 15; attempt++) {
      try {
        composerEl = await page.locator(DIALOG_COMPOSER_SEL).first().elementHandle({ timeout: 500 });
      } catch {}
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
      // Per-image error tolerance: one bad URL shouldn't kill the post
      for (const url of imageUrls) {
        try {
          const tmp = await downloadImage(url);
          tmpFiles.push(tmp);
        } catch (e) {
          console.warn(`[publisher] post=${postId} skipped image ${url}: ${e.message}`);
        }
      }

      if (tmpFiles.length === 0) {
        console.warn(`[publisher] post=${postId} All image downloads failed — continuing without images`);
      } else {
        let imgStrategy = null;

        // Check if a photo preview appeared inside the dialog
        const hasImagePreview = () => page.evaluate(() => {
          const d = document.querySelector('div[role="dialog"]');
          return !!(
            d?.querySelector('img[src^="blob:"]') ||
            d?.querySelector('[data-visualcompletion="media-vc-image"]') ||
            d?.querySelector('div[role="img"]') ||
            d?.querySelector('[data-testid="media-attachment-preview"]')
          );
        });

        // Poll for image preview — return as soon as it appears, capped at maxMs
        const waitForPreview = async (maxMs) => {
          const deadline = Date.now() + maxMs;
          while (Date.now() < deadline) {
            if (await hasImagePreview()) return true;
            await sleep(500);
          }
          return false;
        };

        // Cap is generous: 2s per image + 4s base, max 30s
        const previewCapMs = Math.min(30_000, 4_000 + tmpFiles.length * 2_000);

        // Diagnostic: log buttons available in dialog to help debug selector issues
        const dialogBtns = await page.evaluate(() => {
          const dialog = document.querySelector('div[role="dialog"]');
          return [...(dialog?.querySelectorAll('[role="button"]') ?? [])]
            .map(el => el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 25))
            .filter(Boolean).slice(0, 15);
        });
        console.log(`[publisher] post=${postId} Dialog buttons: ${JSON.stringify(dialogBtns)}`);

        // S0: Direct — try pre-rendered hidden file input in dialog (no button click needed).
        // Facebook sometimes has an <input type="file"> already in the DOM.
        try {
          const directInput = page.locator('div[role="dialog"] input[type="file"]').first();
          if (await directInput.count() > 0) {
            await directInput.setInputFiles(tmpFiles);
            if (await waitForPreview(previewCapMs)) {
              imgStrategy = 'S0-direct';
              console.log(`[publisher] post=${postId} Image inject: ${imgStrategy}`);
            }
          }
        } catch (e) {
          console.warn(`[publisher] post=${postId} S0 failed: ${e.message}`);
        }

        // S1: Click photo button via page.evaluate (bypasses overlay pointer-event interception),
        // then use setInputFiles on whatever file input appears.
        if (!imgStrategy) {
          try {
            const PHOTO_LABELS_JS = [
              'תמונה/סרטון', 'Photo/video', 'Photo', 'תמונה',
              'Add photos/videos', 'הוסף תמונה', 'הוספת תמונות/סרטונים',
            ];
            const clickResult = await page.evaluate((labels) => {
              const dialog = document.querySelector('div[role="dialog"]');
              if (!dialog) return null;
              for (const label of labels) {
                const el = dialog.querySelector(`[aria-label="${label}"]`);
                if (el) { el.click(); return `aria=${label}`; }
              }
              // Partial aria-label match for photo/image/media/video
              for (const el of dialog.querySelectorAll('[role="button"], button, label, div[tabindex]')) {
                const lbl = (el.getAttribute('aria-label') ?? '').toLowerCase();
                if (lbl && /תמונ|photo|image|media|video/.test(lbl)) {
                  el.click();
                  return `partial=${el.getAttribute('aria-label')}`;
                }
              }
              return null;
            }, PHOTO_LABELS_JS);

            if (clickResult) {
              console.log(`[publisher] post=${postId} Photo btn JS click: ${clickResult}`);
              await sleep(2000);
              for (const sel of [
                'div[role="dialog"] input[type="file"]',
                'input[type="file"][accept*="image"]',
                'input[type="file"]',
              ]) {
                const fi = page.locator(sel).last();
                if (await fi.count() > 0) {
                  await fi.setInputFiles(tmpFiles);
                  if (await waitForPreview(previewCapMs)) {
                    imgStrategy = 'S1-js-click';
                    console.log(`[publisher] post=${postId} Image inject: ${imgStrategy}`);
                    break;
                  }
                }
              }
            } else {
              console.warn(`[publisher] post=${postId} S1: no photo button found via JS`);
            }
          } catch (e) {
            console.warn(`[publisher] post=${postId} S1 failed: ${e.message}`);
          }
        }

        // S2: Playwright locator click + filechooser (may be intercepted by overlays, kept as fallback)
        if (!imgStrategy) {
          try {
            const PHOTO_SEL = [
              '[aria-label="תמונה/סרטון"]', '[aria-label="Photo/video"]',
              '[aria-label="Photo"]',        '[aria-label="תמונה"]',
              '[aria-label="Add photos/videos"]', '[aria-label="הוסף תמונה"]',
            ].join(', ');
            const photoBtn = page.locator(PHOTO_SEL).first();
            if (await photoBtn.count() > 0) {
              const chooserPromise = page.waitForEvent('filechooser', { timeout: 6000 }).catch(() => null);
              await photoBtn.click({ timeout: 4000 });
              const chooser = await chooserPromise;
              if (chooser) {
                await chooser.setFiles(tmpFiles);
                if (await waitForPreview(previewCapMs)) {
                  imgStrategy = 'S2-filechooser';
                  console.log(`[publisher] post=${postId} Image inject: ${imgStrategy}`);
                } else {
                  console.warn(`[publisher] post=${postId} S2-filechooser: files sent but no preview`);
                }
              } else {
                await sleep(500);
                const fi = page.locator('input[type="file"]').last();
                if (await fi.count() > 0) {
                  await fi.setInputFiles(tmpFiles);
                  if (await waitForPreview(previewCapMs)) {
                    imgStrategy = 'S2-no-chooser';
                    console.log(`[publisher] post=${postId} Image inject: ${imgStrategy}`);
                  }
                }
              }
            } else {
              console.warn(`[publisher] post=${postId} S2: photo btn locator matched 0 elements`);
            }
          } catch (e) {
            console.warn(`[publisher] post=${postId} S2 failed: ${e.message}`);
          }
        }

        if (!imgStrategy) {
          console.warn(`[publisher] post=${postId} Image upload failed — continuing without images`);
        } else {
          // After image upload, Facebook sometimes leaves a photo-picker sub-panel open
          // that hides the Post button. Close it by clicking Done/Add/OK if present.
          const pickerClosed = await page.evaluate(() => {
            const dialog = document.querySelector('div[role="dialog"]');
            if (!dialog) return null;
            const DONE_LABELS = ['סיום', 'הוסף', 'הוספה', 'אישור', 'Done', 'Add', 'OK', 'בוצע'];
            for (const label of DONE_LABELS) {
              const btn = dialog.querySelector(`[aria-label="${label}"][role="button"]`) ||
                          dialog.querySelector(`button[aria-label="${label}"]`);
              if (btn) { btn.click(); return `aria=${label}`; }
            }
            for (const btn of dialog.querySelectorAll('[role="button"], button')) {
              const txt = (btn.textContent ?? '').trim();
              if (DONE_LABELS.includes(txt)) { btn.click(); return `text=${txt}`; }
            }
            return null;
          });
          if (pickerClosed) {
            console.log(`[publisher] post=${postId} Closed photo picker panel: ${pickerClosed}`);
            await sleep(800);
          }
        }
      }

      // Let the dialog settle before re-finding the composer for text injection
      await sleep(1000);
    }

    // ── 5. Re-find the composer (it may have expanded after image upload) ─
    // The dialog structure changes when photos are attached — re-query fresh.
    composerEl = null;
    for (let attempt = 1; attempt <= 10; attempt++) {
      try {
        composerEl = await page.locator(DIALOG_COMPOSER_SEL).first().elementHandle({ timeout: 500 });
      } catch {}
      if (composerEl) break;
      await sleep(800);
    }
    if (!composerEl) throw new Error('Could not find composer editor after image upload');

    // ── 6. Inject text ────────────────────────────────────────────────────

    // Check injection by text length only — paragraph structure varies across Lexical versions.
    // Log paragraph count separately for diagnostics without using it as a gate.
    const checkInjected = async () => {
      return page.evaluate(({ el, text }) => {
        const composerText = (el.textContent ?? '').replace(/\s/g, '');
        const expectedText = text.replace(/\s/g, '');
        return composerText.length >= expectedText.length * 0.8;
      }, { el: composerEl, text: fullContent });
    };

    // Clear the editor before each fallback to prevent text duplication.
    // Uses focus() (not click) to bypass Facebook's overlay-pointer-event interception.
    const clearEditor = async () => {
      try {
        await composerEl.evaluate(el => el.focus());
        await sleep(100);
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Delete');
        await sleep(200);
      } catch {}
    };

    // Method 0: Playwright-native keyboard (real CDP keystrokes — Lexical treats as user input)
    let injected = false;
    try {
      // focus() via element.focus() inside page.evaluate avoids Facebook overlays
      // that intercept synthetic clicks (which would trigger 30s actionability retries).
      await composerEl.evaluate(el => el.focus());
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
      await clearEditor();
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
      await clearEditor();
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
      await clearEditor();
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
        // Use focus() not click() — avoids Facebook overlays intercepting pointer events
        await composerEl.evaluate(el => el.focus());
        await sleep(300);
        // Move caret to the very end of all content (Ctrl+End, not End — End only goes to end-of-line)
        await page.keyboard.press('Control+End');
        await page.keyboard.type(' ');
        await sleep(3000);
        console.log(`[publisher] post=${postId} Link preview hydration done`);
      } catch (e) {
        console.warn(`[publisher] post=${postId} Link preview error: ${e.message}`);
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

    // ── 6. Find and click Post button ────────────────────────────────────
    const POST_LABELS = ['פרסום', 'פרסם', 'Post', 'שתף', 'Share', 'שלח', 'שלחי', 'בקש לפרסם'];

    // 30 attempts × 600ms = 18s total.
    // allowDisabled kicks in from attempt 20 so a stuck aria-disabled doesn't block us.
    let posted = false;
    for (let attempt = 1; attempt <= 30; attempt++) {
      const allowDisabled = attempt >= 20;
      const result = await page.evaluate(({ labels, allowDisabled }) => {
        const dialog = document.querySelector('div[role="dialog"]');
        const root   = dialog ?? document;
        const enabled = (el) => allowDisabled || el.getAttribute('aria-disabled') !== 'true';

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
          if (el && enabled(el)) {
            el.scrollIntoView({ block: 'center', behavior: 'instant' });
            humanClick(el);
            return `S1 aria-label="${label}"`;
          }
        }

        // S2: text content match
        const lower = labels.map(l => l.toLowerCase());
        for (const el of root.querySelectorAll('[role="button"], button')) {
          const txt = (el.textContent ?? '').trim().toLowerCase();
          if (lower.includes(txt) && enabled(el)) {
            el.scrollIntoView({ block: 'center', behavior: 'instant' });
            humanClick(el);
            return `S2 text="${txt}"`;
          }
        }

        // S3: blue background button
        const s3root = dialog ?? root;
        for (const el of s3root.querySelectorAll('[role="button"], button')) {
          const r = el.getBoundingClientRect();
          if (r.width < 40 || r.height < 20) continue;
          try {
            const bg = window.getComputedStyle(el).backgroundColor;
            const m  = bg.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/);
            if (m) {
              const [, r2, g, b] = m.map(Number);
              if (b > 180 && b > r2 * 2 && enabled(el)) {
                el.scrollIntoView({ block: 'center', behavior: 'instant' });
                humanClick(el);
                return `S3 blue bg="${bg}"`;
              }
            }
          } catch {}
        }

        // S4: lowest visible button in dialog or document (catch-all)
        const s4root = dialog ?? root;
        const cands = [...s4root.querySelectorAll('[role="button"]')]
          .filter(el => {
            const r = el.getBoundingClientRect();
            return r.width >= 40 && r.height >= 24 && enabled(el);
          })
          .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
        if (cands[0]) {
          cands[0].scrollIntoView({ block: 'center', behavior: 'instant' });
          humanClick(cands[0]);
          return `S4 positional text="${(cands[0].textContent ?? '').trim().slice(0, 20)}"`;
        }

        // Diagnostic: return all button labels so we can see what's in the dialog
        const allBtns = [...(dialog ?? document).querySelectorAll('[role="button"], button')]
          .map(el => el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 20))
          .filter(Boolean).slice(0, 10);
        return `NONE found. Dialog buttons: ${JSON.stringify(allBtns)}`;
      }, { labels: POST_LABELS, allowDisabled });

      if (result && !result.startsWith('NONE')) {
        posted = true;
        console.log(`[publisher] post=${postId} Post button clicked via: ${result}${allowDisabled ? ' (forced)' : ''}`);
        break;
      }

      if (attempt % 5 === 0) {
        console.log(`[publisher] post=${postId} Post button not ready (attempt ${attempt}/30): ${result}`);
      }
      await sleep(600);
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
