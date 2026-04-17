import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';
import { sleep, randomBetween, downloadImage, cleanup } from './utils.js';

// Absolute paths — survive restarts and redeployments
const SESSION_DIR = '/home/ubuntu/fb-session';
const ERRORS_DIR  = '/home/ubuntu/fb-errors';

// HEADLESS must be false for anti-detection.
// Control the display externally: DISPLAY=:99 pm2 start ...
// Do NOT pass --display inside Playwright args.
const HEADLESS = false;

// ── Selector strategies — ordered by reliability ─────────────────────────────
// Facebook updates its HTML regularly; multiple fallbacks are critical.
// Use aria-label/aria-placeholder — these match ONLY the compose trigger,
// not post content that happens to contain the same text.
const COMPOSE_SELECTORS = [
  '[aria-label="כאן כותבים..."]',
  '[aria-label="מה אתה חושב?"]',
  '[aria-label="Write something..."]',
  '[aria-label="What\'s on your mind?"]',
  '[aria-placeholder="כאן כותבים..."]',
  '[aria-placeholder="Write something..."]',
  '[aria-placeholder="מה אתה חושב?"]',
];

const EDITOR_SELECTORS = [
  'div[contenteditable="true"][data-lexical-editor="true"]',
  'div[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"]',
];

const POST_BUTTON_SELECTORS = [
  'div[aria-label="פרסום"]',
  'div[aria-label="פרסם"]',
  'div[aria-label="Post"]',
  'div[role="button"]:has-text("פרסום")',
  'div[role="button"]:has-text("פרסם")',
  'div[role="button"]:has-text("Post")',
];

let _browser = null;

/**
 * Get (or create) the persistent browser context.
 * The context stores cookies and local storage in SESSION_DIR so the
 * user only needs to log in once.
 */
export async function getBrowser(headless = HEADLESS) {
  if (_browser) return _browser;

  await mkdir(SESSION_DIR, { recursive: true });
  await mkdir(ERRORS_DIR, { recursive: true });

  _browser = await chromium.launchPersistentContext(SESSION_DIR, {
    headless,
    channel: 'chrome',   // system Google Chrome supports headless:false via xvfb
    viewport: { width: 1280, height: 900 },
    userAgent:
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    args: [
      '--disable-blink-features=AutomationControlled',  // hide automation markers
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // IMPORTANT: Do NOT add --display=:99 here.
      // Set DISPLAY=:99 in the environment before launching pm2.
    ],
    // Spoof timezone to Israel Standard Time
    timezoneId: 'Asia/Jerusalem',
    locale: 'he-IL',
  });

  console.log('[browser] Persistent context started (single instance)');
  return _browser;
}

/** Close the browser (called for memory-leak resets and graceful shutdown). */
export async function closeBrowser() {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
    console.log('[browser] Context closed');
  }
}

/**
 * Post to a Facebook group via browser automation.
 * Throws on any failure (caller handles retry / mark-failed logic).
 *
 * @param {string} postId     DB post ID (for logging and screenshot names)
 * @param {string} groupId    Facebook group numeric ID
 * @param {string} content    Post text
 * @param {string[]} imageUrls Array of image URLs to upload (may be empty)
 */
export async function postToGroup(postId, groupId, content, imageUrls = []) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  const tmpFiles = [];

  try {
    // ── 1. Navigate to the group ──────────────────────────────────────────
    console.log(`[publisher] post=${postId} Navigating to group ${groupId}`);
    await page.goto(`https://www.facebook.com/groups/${groupId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // ── 1a. Session / block detection — URL-based ─────────────────────────
    const currentUrl = page.url();
    if (currentUrl.includes('login') || currentUrl.includes('checkpoint')) {
      throw new Error('SESSION_EXPIRED');
    }

    // ── 1b. Session / block detection — content-based ─────────────────────
    // Only match specific Facebook security/block phrases, NOT generic "blocked"
    // which can appear in normal post content and cause false positives.
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

    // ── 1c. Human-like scroll before interacting ──────────────────────────
    await page.mouse.wheel(0, randomBetween(300, 800));
    await sleep(randomBetween(1000, 2000));

    // ── 2. Click the compose trigger ─────────────────────────────────────
    let clicked = false;
    for (const sel of COMPOSE_SELECTORS) {
      try {
        await page.click(sel, { timeout: 6000, force: true });
        clicked = true;
        console.log(`[publisher] post=${postId} Compose button clicked via: ${sel}`);
        break;
      } catch {}
    }
    if (!clicked) throw new Error('Could not find compose button in group');
    await sleep(randomBetween(1500, 2500));

    // ── 3. Focus the Lexical editor ───────────────────────────────────────
    let editorHandle = null;
    for (const sel of EDITOR_SELECTORS) {
      try {
        editorHandle = await page.waitForSelector(sel, { timeout: 6000 });
        await editorHandle.click({ force: true });
        console.log(`[publisher] post=${postId} Editor focused via: ${sel}`);
        break;
      } catch {}
    }
    if (!editorHandle) throw new Error('Could not find composer editor');
    await sleep(randomBetween(500, 1000));

    // ── 4. Insert text ────────────────────────────────────────────────────
    // Primary strategy: clipboard paste (works with Lexical rich text editor)
    await page.evaluate((text) => {
      const el = document.activeElement;
      if (!el) return;
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: dt,
        bubbles: true,
        cancelable: true,
      }));
    }, content);

    // Verify text was inserted; fall back to fast line-by-line insertion
    await sleep(600);
    const editorText = await editorHandle.evaluate(el => el.textContent ?? '');
    if (!editorText.trim()) {
      console.warn(`[publisher] post=${postId} Paste failed — falling back to insertText+Enter`);
      await editorHandle.click();
      // insertText() is instant (no per-char delay); Enter key creates Lexical paragraph breaks
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i]) await page.keyboard.insertText(lines[i]);
        if (i < lines.length - 1) await page.keyboard.press('Enter');
      }
    }

    await sleep(randomBetween(800, 1500));

    // ── 5. Upload images ─────────────────────────────────────────────────
    if (imageUrls.length > 0) {
      console.log(`[publisher] post=${postId} Uploading ${imageUrls.length} image(s)`);
      for (const url of imageUrls) {
        const tmp = await downloadImage(url);
        tmpFiles.push(tmp);
      }
      try {
        const photoBtn = await page.waitForSelector(
          '[aria-label*="תמונה"], [aria-label*="Photo"], [aria-label*="photo"]',
          { timeout: 5000 }
        );
        await photoBtn.click();
        await sleep(1000);
        const fileInput = await page.waitForSelector('input[type="file"]', { timeout: 6000 });
        await fileInput.setInputFiles(tmpFiles);
        await sleep(randomBetween(2000, 4000));
        console.log(`[publisher] post=${postId} Images uploaded`);
      } catch (imgErr) {
        console.warn(`[publisher] post=${postId} Image upload skipped: ${imgErr.message}`);
      }
    }

    // ── 6. Click Post button ──────────────────────────────────────────────
    let posted = false;
    for (const sel of POST_BUTTON_SELECTORS) {
      try {
        const btn = await page.waitForSelector(sel, { timeout: 5000 });
        await btn.click({ force: true });
        posted = true;
        console.log(`[publisher] post=${postId} Post button clicked via: ${sel}`);
        break;
      } catch {}
    }
    if (!posted) throw new Error('Could not find the Post button');

    // ── 7. Wait for composer to close (success indicator) ─────────────────
    // Facebook closes the dialog after a successful post.
    await sleep(randomBetween(12_000, 18_000));
    const composerStillOpen = await page
      .isVisible(EDITOR_SELECTORS[0])
      .catch(() => false);
    if (composerStillOpen) {
      throw new Error('Composer still open after Post click — publish may have failed');
    }

    console.log(`[publisher] post=${postId} ✓ Successfully posted to group ${groupId}`);

  } catch (err) {
    // ── Save screenshot for debugging ─────────────────────────────────────
    try {
      const screenshotPath = `${ERRORS_DIR}/post-${postId}-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });
      console.error(`[publisher] post=${postId} Screenshot saved: ${screenshotPath}`);
    } catch {}

    throw err;  // re-throw so index.js handles retry / mark-failed
  } finally {
    await page.close().catch(() => {});
    await cleanup(...tmpFiles);
  }
}
