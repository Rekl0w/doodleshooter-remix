import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto(process.env.PRODUCTION_URL || 'https://doodleshooter-remix.netlify.app/');
  await page.waitForSelector('#c', { timeout: 30000 });
  assert.equal(await page.evaluate(() => typeof window.__game), 'undefined', 'production must not expose window.__game');
  assert.equal(errors.length, 0, errors.join('; '));
  console.log('PASS production hides full window.__game debug object');
  console.log('PASS production page has no runtime errors');
} finally {
  await browser.close();
}

