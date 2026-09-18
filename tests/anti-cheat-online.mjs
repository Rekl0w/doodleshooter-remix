import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined, args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const pages = [];
let checks = 0;
const check = (name, value) => { assert.ok(value, name); checks++; console.log(`PASS ${name}`); };
async function open(name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  pages.push(page);
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:8911');
  await page.waitForFunction(() => !!window.__game);
  await page.locator('[data-map="forest"]').click();
  await page.locator('#onlineBtn').click();
  await page.locator('#setName').fill(name);
  return page;
}
try {
  const host = await open('Authority'), guest = await open('Guest');
  await host.locator('input[value="private"]').check();
  await host.locator('#createBtn').click();
  await host.waitForFunction(() => __game.net.active);
  const code = await host.evaluate(() => __game.net.code), hostId = await host.evaluate(() => __game.net.id);
  await guest.locator('#codeBox').fill(code); await guest.locator('#joinBtn').click();
  await guest.waitForFunction(() => __game.game.state === 'lobby');
  const guestId = await guest.evaluate(() => __game.net.id);
  await host.locator('#startBtn').click();
  await host.waitForFunction(() => __game.game.state === 'play');
  await guest.waitForFunction(() => __game.game.state === 'play');
  check('host sees the connected combat record before enforcement', await host.evaluate(id => __game.combat.players.has(id), guestId));

  // A guest cannot invoke moderation routes, even when it addresses the host.
  await guest.evaluate(id => __game.net.sendTo(id, 'anti-cheat-kick', { target: id }), hostId);
  await host.waitForTimeout(150);
  check('guest cannot forge an anti-cheat kick', await host.evaluate(() => __game.net.active && __game.combat.players.size === 2));

  // Living forged life ids are deterministic and require three confirmations.
  await host.waitForTimeout(1400); // allow the legitimate spawn transition grace window to close
  await guest.evaluate(() => {
    const g = __game, p = g.player, s = [...p.body.pos.toArray(), 0, 0, 0, 64, 110, 0, 0, 0, 0, 0, 0, p.lifeId + 999];
    for (let i = 0; i < 3; i++) g.net.send('ps', s);
  });
  await host.waitForFunction(id => !__game.net.conns.has(id) && !__game.remote.has(id), guestId, { timeout: 10000 });
  check('repeated forged life snapshots auto-kick the guest', true);
  check('kicked combat authority record is removed', await host.evaluate(id => !__game.combat.players.has(id), guestId));
  check('host retains detailed evidence after removal', await host.evaluate(id => {
    const e = __game.antiCheat.evidence(id); return e && e.protocol['forged-life'] >= 3 && e.strikes >= 3;
  }, guestId));
  check('kicked guest receives only the generic anti-cheat message', await guest.waitForFunction(() => document.body.innerText.includes('Removed from match: anti-cheat violation'), null, { timeout: 10000 }).then(() => true));

  const rejoin = await guest.evaluate(async code => {
    try { await __game.net.join(code, { name: 'new identity name' }); return { ok: true, error: '' }; }
    catch (error) { return { ok: false, error: String(error) }; }
  }, code);
  check('room ban rejects the same stable client identity', !rejoin.ok);

  console.log(`anti-cheat online: ${checks} checks passed`);
} finally {
  for (const page of pages) await page.evaluate(() => __game?.net.leave()).catch(() => {});
  await browser.close();
}
