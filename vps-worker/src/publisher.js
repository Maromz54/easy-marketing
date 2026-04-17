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
export async function postToGroup(postId, groupId, content, imageUrls = []) {
  const browser  = await getBrowser();
  const page     = await browser.newPage();
  const tmpFiles = [];

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
    // Scoping to div[role="dialog"] prevents accidentally targeting comment boxes,
    // which also use Lexical editors.
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

    // Focus the editor with mouse events (same as extension)
    await page.evaluate(el => {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
      el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));
      el.focus();
    }, composerEl);
    await sleep(400);

    // ── 4. Inject text (mirrors extension STEP 3) ─────────────────────────
    // Primary: insertText + insertParagraph per line (preserves line breaks in Lexical)
    const textOk = await page.evaluate(({ el, text }) => {
      el.focus();
      document.execCommand('selectAll', false);
      const lines = text.split('\n');
      let ok = false;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]) ok = document.execCommand('insertText', false, lines[i]) || ok;
        if (i < lines.length - 1) document.execCommand('insertParagraph', false);
      }
      return ok || (el.textContent ?? '').trim().length > 0;
    }, { el: composerEl, text: content });

    if (!textOk) {
      // Fallback: DataTransfer clipboard paste (same as extension Method 2)
      console.warn(`[publisher] post=${postId} execCommand failed — trying clipboard paste`);
      await page.evaluate(({ el, text }) => {
        el.focus();
        document.execCommand('selectAll', false);
        document.execCommand('delete', false);
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      }, { el: composerEl, text: content });
      await sleep(2000);
    }

    console.log(`[publisher] post=${postId} Text injected`);
    // Give Lexical time to process and enable the Post button
    await sleep(2000);

    // ── 5. Upload images (mirrors extension STEP 3b) ──────────────────────
    if (imageUrls.length > 0) {
      console.log(`[publisher] post=${postId} Uploading ${imageUrls.length} image(s)`);
      for (const url of imageUrls) {
        const tmp = await downloadImage(url);
        tmpFiles.push(tmp);
      }

      try {
        // Click the photo toolbar button (same as extension S-IMG-3)
        const photoBtnLabel = await page.evaluate(() => {
          const PHOTO_LABELS = ['תמונה/סרטון', 'Photo/video', 'Photo', 'תמונה', 'Add photos/videos'];
          const dialog = document.querySelector('div[role="dialog"]');
          const root   = dialog ?? document;
          for (const label of PHOTO_LABELS) {
            const el = root.querySelector(`[aria-label="${label}"]`);
            if (el) { el.click(); return label; }
          }
          for (const el of root.querySelectorAll('[role="button"]')) {
            const txt = (el.textContent ?? '').trim();
            if (PHOTO_LABELS.some(l => txt.includes(l))) { el.click(); return txt; }
          }
          return null;
        });
        if (photoBtnLabel) {
          console.log(`[publisher] post=${postId} Photo button clicked: ${photoBtnLabel}`);
          await sleep(1500);
        }

        // Find file input — try most specific accept patterns first (S-IMG-4 order)
        // state:'attached' works on hidden inputs (Facebook keeps inputs hidden in the DOM)
        const FB_PATTERNS = [
          'input[type="file"][accept="image/*,image/heif,image/heic"]',
          'input[type="file"][accept*="image/heic"]',
          'input[type="file"][accept^="image"]',
          'input[type="file"][accept*="image/"]',
          'input[type="file"]',
        ];

        let uploaded = false;
        for (const pattern of FB_PATTERNS) {
          try {
            const count = await page.locator(pattern).count();
            if (count === 0) continue;
            const input = page.locator(pattern).first();
            await input.setInputFiles(tmpFiles);
            uploaded = true;
            console.log(`[publisher] post=${postId} Files set via: ${pattern}`);
            break;
          } catch {}
        }

        if (uploaded) {
          const uploadWait = Math.max(5000, tmpFiles.length * 3000);
          console.log(`[publisher] post=${postId} Waiting ${Math.round(uploadWait / 1000)}s for upload`);
          await sleep(uploadWait);
          console.log(`[publisher] post=${postId} Upload complete`);
        } else {
          console.warn(`[publisher] post=${postId} No file input found — images skipped`);
        }
      } catch (imgErr) {
        console.warn(`[publisher] post=${postId} Image upload error: ${imgErr.message}`);
      }
    }

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
