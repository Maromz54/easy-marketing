import { unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import crypto from 'crypto';

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Download an image URL to a temp file and return the local path.
 * Retries up to maxRetries times with a short random delay between attempts.
 */
export async function downloadImage(url, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      const ext = (url.split('?')[0].split('.').pop() || 'jpg').toLowerCase().slice(0, 4);
      const tmpPath = path.join(tmpdir(), `fb-img-${crypto.randomUUID()}.${ext}`);
      await writeFile(tmpPath, buffer);
      return tmpPath;
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(randomBetween(2000, 5000));
      }
    }
  }
  throw new Error(`Failed to download image after ${maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Delete temp files, ignoring individual errors so one failure
 * doesn't prevent the rest from being cleaned up.
 */
export async function cleanup(...filePaths) {
  for (const p of filePaths) {
    try { await unlink(p); } catch {}
  }
}
