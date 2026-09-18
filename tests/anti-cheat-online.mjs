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

  // A forged combat packet cannot pick a stronger weapon than the host's
  // latest weapon-select/snapshot ledger. Aim the camera normally first so
  // this assertion exercises weapon authority rather than silent-ray logic.
  await host.waitForTimeout(1400);
  await guest.evaluate(hostId => {
    const g = __game, target = g.remote.get(hostId), d = target.center.clone().sub(g.player.eye).normalize();
    g.player.yaw = Math.atan2(-d.x, -d.z); g.player.pitch = Math.asin(d.y); g.player.forward.copy(d);
    window.weaponResults = [];
    const original = g.net.handlers.get('combat-result');
    g.net.on('combat-result', (result, from) => { if (result.id === 'forged-weapon') weaponResults.push(result); original(result, from); });
  }, hostId);
  await guest.waitForTimeout(220);
  const targetState = await guest.evaluate(hostId => {
    const g = __game, target = g.remote.get(hostId), point = target.center.toArray(), ray = target.center.clone().sub(g.player.eye).normalize().toArray();
    g.net.send('combat-hit', { id: 'forged-weapon', target: hostId, life: target.lifeId, attackerLife: g.player.lifeId, src: 'sniper', from: g.player.eye.toArray(), point, part: 'torso', aim: ray, ray });
    return { hp: target.hp };
  }, hostId);
  await guest.waitForFunction(() => weaponResults.length === 1, null, { timeout: 5000 });
  check('forged sniper selection is rejected by the host weapon ledger', await guest.evaluate(() => weaponResults[0].reason === 'weapon-state'));
  check('forged weapon packet cannot damage the target', await guest.evaluate(({ hostId, hp }) => __game.remote.get(hostId)?.hp === hp, { hostId, hp: targetState.hp }));

  // A coherent impact ray that does not match any recent host-observed view is
  // rejected before HostCombat applies damage (silent-aim preflight).
  await guest.evaluate(hostId => {
    const g = __game, target = g.remote.get(hostId);
    g.player.yaw += Math.PI; g.player.pitch = 0; g.player.forward.set(-Math.sin(g.player.yaw), 0, -Math.cos(g.player.yaw)); g.input.look.x = 0; g.input.look.y = 0;
    window.silentResults = [];
    const original = g.net.handlers.get('combat-result');
    g.net.on('combat-result', (result, from) => { if (result.id === 'silent-ray') silentResults.push(result); original(result, from); });
  }, hostId);
  await guest.waitForTimeout(700);
  const authoritativeTarget = await host.evaluate(id => { const p = __game.combat.players.get(id); return { pos: p.pos, life: p.life }; }, hostId);
  const silentHp = await guest.evaluate(({ hostId, target }) => {
    const g = __game, remote = g.remote.get(hostId), point = [target.pos[0], target.pos[1] + 1, target.pos[2]], dx = point[0] - g.player.eye.x, dy = point[1] - g.player.eye.y, dz = point[2] - g.player.eye.z, len = Math.hypot(dx, dy, dz), ray = [dx / len, dy / len, dz / len];
    g.net.send('combat-hit', { id: 'silent-ray', target: hostId, life: target.life, attackerLife: g.player.lifeId, src: 'rifle', from: g.player.eye.toArray(), point, part: 'torso', aim: ray, ray });
    return remote.hp;
  }, { hostId, target: authoritativeTarget });
  await guest.waitForFunction(() => silentResults.length === 1, null, { timeout: 5000 });
  check('coherent silent-aim ray is rejected before damage', await guest.evaluate(() => silentResults[0].reason === 'silent-aim'));
  check('silent-aim packet cannot damage the target', await guest.evaluate(({ hostId, hp }) => __game.remote.get(hostId)?.hp === hp, { hostId, hp: silentHp }));

  // Living forged life ids are deterministic and require three confirmations.
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
