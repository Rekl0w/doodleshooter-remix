import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');

const browser = await chromium.launch({
  headless: true,
  channel: process.platform === 'win32' ? 'msedge' : undefined,
  args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
});
const pages = [];
const open = async () => {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  pages.push(page);
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:8911');
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  return page;
};
const free = page => page.evaluate(() => {
  __game.game.menu = false;
  __game.hud.hideScreen();
  __game.input.usingGamepad = true;
  __game.input.mouseBtns = {};
  document.activeElement?.blur();
});

try {
  const host = await open();
  await host.locator('[data-map="forest"]').click();
  await host.locator('#onlineBtn').click();
  await host.locator('input[value="private"]').check();
  await host.locator('#createBtn').click();
  await host.waitForFunction(() => __game.net.active, null, { timeout: 15000 });
  const code = await host.evaluate(() => __game.net.code);

  const guest = await open();
  await guest.locator('#onlineBtn').click();
  await guest.locator('#codeBox').fill(code);
  await guest.locator('#joinBtn').click();
  await guest.waitForFunction(() => __game.game.state === 'lobby' && __game.net.active, null, { timeout: 20000 });
  await host.evaluate(() => __game.hostStart());
  await Promise.all([
    host.waitForFunction(() => __game.game.state === 'play', null, { timeout: 20000 }),
    guest.waitForFunction(() => __game.game.state === 'play', null, { timeout: 20000 })
  ]);
  await free(host);
  await free(guest);
  const guestId = await guest.evaluate(() => __game.net.id);
  // Reproduce the route that previously hit the forest's west boundary after
  // about ten seconds. This is still real local movement; only the spawn is
  // made deterministic so the regression is repeatable.
  await host.evaluate(id => {
    const p = __game.combat.players.get(id);
    p.pos = [-44, 0, 38]; p.history = []; p.lastSnap = performance.now() / 1000;
    p.movementGraceUntil = performance.now() / 1000 + 1.2;
  }, guestId);
  await guest.evaluate(() => {
    const g = __game;
    g.player.body.pos.set(-44, 0, 38); g.player.body.vel.set(0, 0, 0); g.player.body.onGround = true;
    g.player.yaw = 0; g.player.pitch = 0;
  });
  const start = await guest.evaluate(() => ({ pos: __game.player.body.pos.toArray(), yaw: __game.player.yaw, map: __game.level.key }));
  console.log('START', JSON.stringify(start));

  // Drive the real local input and physics for 30 seconds. Rotate the view in
  // place between legs so this exercises corners without teleporting state.
  const legs = [
    { yaw: 0, key: 'forward', ms: 7000 },
    { yaw: Math.PI / 2, key: 'forward', ms: 7000 },
    { yaw: Math.PI, key: 'forward', ms: 7000 },
    { yaw: -Math.PI / 2, key: 'forward', ms: 7000 },
    { yaw: 0, key: 'forward', ms: 3000 }
  ];
  for (const leg of legs) {
    await guest.evaluate(({ yaw, key }) => { __game.player.yaw = yaw; __game.input.keys = { [key]: true }; }, leg);
    await guest.waitForTimeout(leg.ms);
    await guest.evaluate(() => { __game.input.keys = {}; });
    console.log('LEG', JSON.stringify(await guest.evaluate(() => ({ pos: __game.player.body.pos.toArray(), alive: __game.player.alive, state: __game.game.state }))));
  }
  await guest.waitForTimeout(500);
  const result = await host.evaluate(id => {
    const p = __game.combat.players.get(id);
    return {
      active: __game.net.conns.has(id),
      state: __game.game.state,
      pos: p?.pos,
      evidence: __game.antiCheat.evidence(id),
      guestStatus: __game.lobby.players.get(id)
    };
  }, guestId);
  const end = await guest.evaluate(() => ({ pos: __game.player.body.pos.toArray(), alive: __game.player.alive, state: __game.game.state }));
  console.log('END', JSON.stringify(end));
  console.log('HOST', JSON.stringify(result));
  assert.equal(result.active, true, 'legitimate 30-second movement must not kick the guest');
  assert.equal(result.evidence.movementViolations, 0, 'legitimate movement must not create hard movement violations');
  assert.equal(result.evidence.protocol['noclip-path'] || 0, 0, 'legitimate movement must not create noclip evidence');
  console.log('PASS legitimate 30-second movement remains connected');
} finally {
  for (const page of pages) await page.evaluate(() => __game?.net?.leave?.()).catch(() => {});
  await browser.close();
}
