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

    if (!triggerResult) {
      // Check if this is a restricted group (marketplace-only or no posting permission)
      const restricted = await page.evaluate(() => {
        const body = document.body.textContent ?? '';
        const signals = [
          'מכור משהו', 'Sell something', 'מה אתה מוכר', "What are you selling",
          'הצטרף לקבוצה', 'Join group', 'בקש להצטרף', 'Ask to join',
        ];
        return signals.some(s => body.includes(s)) ? signals.find(s => body.includes(s)) : null;
      });
      if (restricted) throw new Error(`GROUP_RESTRICTED: ${restricted}`);
      throw new Error('Could not find compose button in group');
    }
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

    // Mark the specific dialog that contains the composer with a unique attribute.
    // This prevents all subsequent queries from accidentally targeting Facebook's
    // notification panels or other concurrent dialogs that also use role="dialog".
    await composerEl.evaluate(el => {
      let node = el;
      while (node && node.getAttribute?.('role') !== 'dialog') node = node.parentElement;
      if (node) node.setAttribute('data-em-composer', 'true');
    });

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
          const d = document.querySelector('[data-em-composer="true"]');
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
          const dialog = document.querySelector('[data-em-composer="true"]');
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
              const dialog = document.querySelector('[data-em-composer="true"]');
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
          // Wait for Facebook to finish uploading files to its CDN.
          // setInputFiles fires the change event and Facebook begins async CDN uploads.
          // The blob: preview appears almost immediately, but the actual upload takes
          // ~3s per image. If we click "Publish" before uploads finish, the handler
          // silently ignores the click. 3s/image + 5s base, capped at 30s.
          const cdnUploadWaitMs = Math.min(45_000, 5_000 + tmpFiles.length * 3_000);
          console.log(`[publisher] post=${postId} Waiting ${Math.round(cdnUploadWaitMs/1000)}s for image CDN uploads...`);
          await sleep(cdnUploadWaitMs);

          // After image upload, Facebook sometimes leaves a photo-picker sub-panel open
          // that hides the Post button. Close it by clicking Done/Add/OK if present.
          const pickerClosed = await page.evaluate(() => {
            const dialog = document.querySelector('[data-em-composer="true"]');
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

        // Give Facebook 10s to fetch OG data and render the link preview card.
        // Facebook blocks post submission until the preview finishes loading.
        await sleep(10_000);
        const hasPreview = await page.evaluate(() => {
          const dialog = document.querySelector('[data-em-composer="true"]');
          // Link preview typically renders as a role="link" or a dedicated preview block
          return !!(dialog?.querySelector('[role="link"]') || dialog?.querySelector('[data-testid*="preview"]'));
        });
        console.log(`[publisher] post=${postId} Link preview hydration done (hasPreview=${hasPreview})`);
      } catch (e) {
        console.warn(`[publisher] post=${postId} Link preview error: ${e.message}`);
      }
    }

    // ── 5a. Pre-submit verification log ──────────────────────────────────
    const POST_LABELS = ['פרסום', 'פרסם', 'Post', 'שתף', 'Share', 'שלח', 'שלחי', 'בקש לפרסם'];

    const verify = await page.evaluate((labels) => {
      const dialog = document.querySelector('[data-em-composer="true"]');
      const editor = dialog?.querySelector('[contenteditable="true"]');
      let btnLabel = null, btnDisabled = 'not-found';
      for (const label of labels) {
        const btn = dialog?.querySelector(`[aria-label="${label}"]`);
        if (btn) { btnLabel = label; btnDisabled = btn.getAttribute('aria-disabled') ?? 'enabled'; break; }
      }
      return {
        paragraphs: editor?.querySelectorAll('p').length ?? 0,
        textLen:    (editor?.textContent ?? '').length,
        hasImage:   !!(
          dialog?.querySelector('img[src^="blob:"]') ||
          dialog?.querySelector('[data-visualcompletion="media-vc-image"]')
        ),
        btnLabel,
        btnDisabled,
      };
    }, POST_LABELS);
    console.log(
      `[publisher] post=${postId} Pre-submit: p=${verify.paragraphs} ` +
      `len=${verify.textLen} img=${verify.hasImage} ` +
      `btn="${verify.btnLabel}" disabled=${verify.btnDisabled}`
    );

    // Guard: if composer is empty something went wrong (e.g. a wrong click reset the editor).
    // Submitting an empty post would fail or publish garbage — abort instead.
    if (verify.textLen === 0) {
      throw new Error('Composer is empty before submit — text injection was lost');
    }

    // ── 6. Wait for Post button to become enabled, then click ─────────────
    // The Post button stays aria-disabled="true" while images are uploading to
    // Facebook's CDN. Even though blob: URLs appear immediately, the actual
    // upload takes several more seconds. Clicking a disabled button does nothing.

    const btnEnabledDeadline = Date.now() + 45_000; // wait up to 45s for upload to finish
    let btnReadyLabel = null;
    while (Date.now() < btnEnabledDeadline) {
      const btnState = await page.evaluate((labels) => {
        const dialog = document.querySelector('[data-em-composer="true"]');
        for (const label of labels) {
          const btn = dialog?.querySelector(`[aria-label="${label}"]`);
          if (btn) return { label, disabled: btn.getAttribute('aria-disabled') };
        }
        return null;
      }, POST_LABELS);

      if (btnState && btnState.disabled !== 'true') {
        btnReadyLabel = btnState.label;
        console.log(`[publisher] post=${postId} Post button "${btnReadyLabel}" is enabled`);
        break;
      }
      if (btnState?.disabled === 'true') {
        // log every 5s
        if ((btnEnabledDeadline - Date.now()) % 5000 < 600) {
          console.log(`[publisher] post=${postId} Waiting for Post button to enable (disabled=${btnState.disabled})...`);
        }
      }
      await sleep(500);
    }
    if (!btnReadyLabel) {
      console.warn(`[publisher] post=${postId} Post button never became enabled within 45s — attempting click anyway`);
    }

    // Monitor network requests and responses to diagnose what happens after clicking Post.
    let _postNetworkLog = [];
    let _graphqlResponse = null;
    const _reqListener = req => {
      if (req.method() === 'POST' && req.url().includes('facebook.com')) {
        const path = req.url().replace(/https?:\/\/[^/]+/, '').split('?')[0];
        _postNetworkLog.push(path.slice(0, 70));
      }
    };
    const _respListener = async (resp) => {
      if (resp.request().method() === 'POST' && resp.url().includes('/graphql')) {
        try {
          const body = await resp.text().catch(() => '');
          _graphqlResponse = `status=${resp.status()} body=${body.slice(0, 200)}`;
        } catch {}
      }
    };
    page.on('request', _reqListener);
    page.on('response', _respListener);

    let posted = false;

    // Method A: React internal props — accesses Facebook's compiled onClick directly.
    // Bypasses DOM event dispatch, isTrusted checks, and React's synthetic event layer.
    // Works when btn.click() and page.mouse.click() are silently ignored.
    try {
      const reactResult = await page.evaluate((labels) => {
        const dialog = document.querySelector('[data-em-composer="true"]');
        for (const label of labels) {
          const btn = dialog?.querySelector(`[aria-label="${label}"]`);
          if (!btn || btn.getAttribute('aria-disabled') === 'true') continue;
          btn.scrollIntoView({ block: 'center' });

          // React 17+ stores event handlers on __reactProps$<hash>
          const reactKey = Object.keys(btn).find(k => k.startsWith('__reactProps'));
          if (reactKey && typeof btn[reactKey]?.onClick === 'function') {
            const synth = {
              type: 'click', target: btn, currentTarget: btn,
              bubbles: true, cancelable: true, isTrusted: true,
              defaultPrevented: false, timeStamp: Date.now(),
              preventDefault: () => {}, stopPropagation: () => {},
              stopImmediatePropagation: () => {},
              nativeEvent: {
                isTrusted: true, type: 'click', target: btn,
                preventDefault: () => {}, stopPropagation: () => {},
              },
            };
            btn[reactKey].onClick(synth);
            return 'reactProps:' + label;
          }

          // React fiber walk for older React versions
          const fiberKey = Object.keys(btn).find(k => k.startsWith('__reactFiber'));
          if (fiberKey) {
            let fiber = btn[fiberKey];
            for (let d = 0; d < 8 && fiber; d++, fiber = fiber.return) {
              if (typeof fiber.pendingProps?.onClick === 'function') {
                fiber.pendingProps.onClick({
                  type: 'click', target: btn, currentTarget: btn,
                  bubbles: true, cancelable: true, isTrusted: true,
                  preventDefault: () => {}, stopPropagation: () => {},
                  nativeEvent: { isTrusted: true, type: 'click' },
                });
                return 'reactFiber:' + label;
              }
            }
          }
          return 'noReactHandler:' + label;
        }
        return 'not-found';
      }, POST_LABELS);

      if (reactResult && !reactResult.startsWith('not-found') && !reactResult.startsWith('noReact')) {
        posted = true;
        console.log(`[publisher] post=${postId} Post via ${reactResult}`);
      } else {
        console.warn(`[publisher] post=${postId} Method A (React props): ${reactResult}`);
      }
    } catch (e) {
      console.warn(`[publisher] post=${postId} Method A (React props) failed: ${e.message}`);
    }

    // Method B: CDP Runtime.evaluate with userGesture:true
    // Provides transient user activation context; btn.click() fires inside that context.
    if (!posted) {
      try {
        const cdpSession = await page.context().newCDPSession(page);
        const labelsJson = JSON.stringify(POST_LABELS);
        const cdpResult = await cdpSession.send('Runtime.evaluate', {
          expression: `
            (function() {
              const labels = ${labelsJson};
              for (const label of labels) {
                const btn = document.querySelector('[data-em-composer="true"] [aria-label="' + label + '"]') ||
                            document.querySelector('[role="dialog"] [aria-label="' + label + '"]');
                if (btn && btn.getAttribute('aria-disabled') !== 'true') {
                  btn.scrollIntoView({ block: 'center' });
                  btn.click();
                  return 'clicked:' + label;
                }
              }
              return 'not-found';
            })()
          `,
          userGesture: true,
          awaitPromise: false,
        });
        await cdpSession.detach();
        const clickedLabel = cdpResult?.result?.value;
        if (clickedLabel && !clickedLabel.startsWith('not-found')) {
          posted = true;
          console.log(`[publisher] post=${postId} Post via CDP userGesture: ${clickedLabel}`);
        } else {
          console.warn(`[publisher] post=${postId} Method B (CDP userGesture): ${clickedLabel}`);
        }
      } catch (e) {
        console.warn(`[publisher] post=${postId} Method B (CDP userGesture) failed: ${e.message}`);
      }
    }

    // Method C: Playwright mouse click (trusted CDP Input.dispatchMouseEvent)
    if (!posted) {
      try {
        const btnLoc = page.locator(`[data-em-composer="true"] [aria-label="${btnReadyLabel || POST_LABELS[0]}"]`).first();
        const box = await btnLoc.boundingBox();
        if (box) {
          const cx = box.x + box.width / 2;
          const cy = box.y + box.height / 2;
          await page.mouse.move(cx, cy, { steps: 10 });
          await sleep(100);
          await page.mouse.click(cx, cy);
          posted = true;
          console.log(`[publisher] post=${postId} Post via mouse.click at (${Math.round(cx)},${Math.round(cy)})`);
        }
      } catch (e) {
        console.warn(`[publisher] post=${postId} Method C (mouse.click) failed: ${e.message}`);
      }
    }

    // Method D: locator.click()
    if (!posted) {
      for (const label of POST_LABELS) {
        try {
          const btn = page.locator(`[data-em-composer="true"] [aria-label="${label}"]`).first();
          if (await btn.count() > 0) {
            await btn.click({ timeout: 3000 });
            posted = true;
            console.log(`[publisher] post=${postId} Post via locator.click: "${label}"`);
            break;
          }
        } catch {}
      }
    }

    // Method E: JS humanClick loop with positional fallback (30 attempts × 600ms = 18s)
    for (let attempt = 1; !posted && attempt <= 30; attempt++) {
      const allowDisabled = attempt >= 20;
      const result = await page.evaluate(({ labels, allowDisabled }) => {
        const dialog = document.querySelector('[data-em-composer="true"]');
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

        for (const label of labels) {
          const el = root.querySelector(`[aria-label="${label}"][role="button"]`) ||
                     root.querySelector(`button[aria-label="${label}"]`) ||
                     root.querySelector(`[aria-label="${label}"]`);
          if (el && enabled(el)) { el.scrollIntoView({ block: 'center', behavior: 'instant' }); humanClick(el); return `E1:"${label}"`; }
        }
        const lower = labels.map(l => l.toLowerCase());
        for (const el of root.querySelectorAll('[role="button"], button')) {
          const txt = (el.textContent ?? '').trim().toLowerCase();
          if (lower.includes(txt) && enabled(el)) { el.scrollIntoView({ block: 'center', behavior: 'instant' }); humanClick(el); return `E2:"${txt}"`; }
        }
        const cands = [...(dialog ?? root).querySelectorAll('[role="button"]')]
          .filter(el => { const r = el.getBoundingClientRect(); return r.width >= 40 && r.height >= 24 && enabled(el); })
          .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
        if (cands[0]) { cands[0].scrollIntoView({ block: 'center', behavior: 'instant' }); humanClick(cands[0]); return `E3:"${(cands[0].textContent ?? '').trim().slice(0, 20)}"`; }
        return `NONE`;
      }, { labels: POST_LABELS, allowDisabled });

      if (result && !result.startsWith('NONE')) {
        posted = true;
        console.log(`[publisher] post=${postId} Post via: ${result}${allowDisabled ? ' (forced)' : ''}`);
        break;
      }
      if (attempt % 5 === 0) console.log(`[publisher] post=${postId} Post button not ready (${attempt}/30): ${result}`);
      await sleep(600);
    }

    if (!posted) throw new Error('Could not find the Post button');

    // Report network activity and take immediate post-click snapshot
    await sleep(2000);
    page.off('request', _reqListener);
    page.off('response', _respListener);
    console.log(`[publisher] post=${postId} POST reqs after click: ${JSON.stringify(_postNetworkLog)}`);
    if (_graphqlResponse) console.log(`[publisher] post=${postId} GraphQL response: ${_graphqlResponse}`);
    try {
      const snapPath = `${ERRORS_DIR}/post-${postId}-after-click.png`;
      await page.screenshot({ path: snapPath });
      console.log(`[publisher] post=${postId} Post-click snapshot: ${snapPath}`);
    } catch {}

    // ── 7. Wait for dialog to close OR a success signal ──────────────────
    const deadline = Date.now() + 43_000; // 45s total (2s already elapsed above)
    let successSignal = null;
    while (!successSignal && Date.now() < deadline) {
      await sleep(500);
      successSignal = await page.evaluate(() => {
        // Case 1: dialog removed from DOM
        const dialog = document.querySelector('[data-em-composer="true"]');
        if (!dialog) return 'dialog-closed';

        // Case 2: composer text cleared — post submitted (may be pending admin review)
        const editor = dialog.querySelector('[contenteditable="true"]');
        const editorText = (editor?.textContent ?? '').trim();
        if (editor && editorText.length === 0) return 'text-cleared';

        // Case 3: success/pending keywords visible in dialog body
        const dialogText = dialog.textContent ?? '';
        const PENDING_SIGNALS = [
          'ממתין', 'pending', 'review', 'נשלח', 'אישור ניהול',
          'הפוסט שלך', 'submitted', 'בדיקה', 'הפוסט נשמר',
          'הפוסט ממתין', 'בהמתנה', 'אישור',
        ];
        const hit = PENDING_SIGNALS.find(s => dialogText.includes(s));
        if (hit) return `pending-msg:${hit}`;

        // Case 4: A second dialog appeared after clicking Post (confirmation step).
        // Click its Post/Continue button if found.
        for (const otherDlg of document.querySelectorAll('[role="dialog"]')) {
          if (otherDlg.hasAttribute('data-em-composer')) continue;
          const CONFIRM_LBLS = ['פרסום', 'פרסם', 'Post', 'שתף', 'שלח', 'אישור', 'המשך', 'Continue', 'בקש לפרסם'];
          for (const lbl of CONFIRM_LBLS) {
            const b = otherDlg.querySelector(`[aria-label="${lbl}"]`);
            if (b && b.getAttribute('aria-disabled') !== 'true') { b.click(); return 'secondary-dlg:' + lbl; }
          }
          for (const b of otherDlg.querySelectorAll('[role="button"]')) {
            const txt = (b.textContent ?? '').trim();
            if (CONFIRM_LBLS.includes(txt) && b.getAttribute('aria-disabled') !== 'true') { b.click(); return 'secondary-dlg-txt:' + txt; }
          }
        }

        return null;
      }).catch(() => 'dialog-closed');
    }

    if (successSignal) {
      console.log(`[publisher] post=${postId} Post submitted (signal: ${successSignal})`);
      // If we clicked a secondary dialog, wait a bit for it to fully close
      if (successSignal.startsWith('secondary-dlg')) {
        await sleep(5000);
      }
    } else {
      const dialogSnapshot = await page.evaluate(() => {
        const d = document.querySelector('[data-em-composer="true"]');
        if (!d) return 'dialog gone';
        const editor = d.querySelector('[contenteditable="true"]');
        return `textLen=${(editor?.textContent ?? '').length} html=${d.innerHTML.slice(0, 400)}`;
      }).catch(() => 'eval failed');
      console.error(`[publisher] post=${postId} Dialog still open. Snapshot: ${dialogSnapshot}`);
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
