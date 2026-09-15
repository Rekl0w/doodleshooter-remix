import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = []; page.on('pageerror', e => errors.push(e.message));
let count = 0;
const check = (name, ok) => { assert.ok(ok, name); count++; console.log('PASS ' + name); };
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:8911');
  await page.waitForFunction(() => !!window.__game, null, {timeout: 60000});
  check('eleven distinct selectable maps', await page.locator('.mapbtn').count() === 11);
  const fixtures = await page.evaluate(async () => {
    const THREE = await import('/vendor/three/three.module.js');
    const { World, makeBody } = await import('/src/physics.js');
    const { buildLevel } = await import('/src/level.js');
    const { NavGrid } = await import('/src/nav.js');
    const out = [], test = (name, pass, detail) => out.push({ name, pass, detail });
    for (const key of ['harbor', 'canyon', 'gardens', 'forest', 'duel', 'meadow', 'deepforest', 'lostwoods', 'dust2', 'skyline']) {
      const world = new World(), scene = new THREE.Scene(), L = buildLevel(scene, world, key), nav = new NavGrid(world, L.bounds, L.navCell || 1).build();
      const valid = p => {
        const b = makeBody(p, .45, 2, .55);
        const floor = world.raycast(p.clone().add(new THREE.Vector3(0, .1, 0)), new THREE.Vector3(0, -1, 0), .3);
        return !world.overlapsBody(b) && !!floor && Math.abs(floor.point.y - p.y) < .11;
      };
      test(key + ': correct map key and player start on clear ground', L.key === key && valid(L.playerStart));
      for (const name of ['spawns', 'snipers', 'arenaSpawns', 'pickups']) {
        const invalid = L[name].filter(p => !valid(p));
        test(key + ': all ' + name + ' have floor and body clearance', L[name].length > 0 && !invalid.length, invalid.map(p => p.toArray()));
      }
      const badPaths = [...L.spawns, ...L.snipers, ...L.pickups].filter(p => !nav.findPath(L.playerStart, p)?.complete);
      test(key + ': ground, sniper and supply routes reachable by bots', !badPaths.length, badPaths.map(p => p.toArray()));
      test(key + ': every enemy spawn can reach the player', L.spawns.every(p => nav.findPath(p, L.playerStart)?.complete));
      if (['harbor','canyon','gardens'].includes(key)) {
      const walk = key === 'harbor' ? { start: [22, 0, 1], dir: [0, 0, -1], distance: 16, height: 6 }
        : key === 'canyon' ? { start: [8, 0, 20], dir: [1, 0, 0], distance: 12, height: 4 }
        : { start: [17, 0, 38], dir: [0, 0, -1], distance: 37, height: 12 };
      const body = makeBody(new THREE.Vector3(...walk.start), .35, 1.75, .55), dir = new THREE.Vector3(...walk.dir);
      body.onGround = true;
      for (let t = 0; t < walk.distance / 4; t += 1 / 120) { body.vel.x = dir.x * 4; body.vel.z = dir.z * 4; body.vel.y -= 26 / 120; world.moveBody(body, 1 / 120); }
      test(key + ': player can physically walk the stairs without jumping or grapple', Math.abs(body.pos.y - walk.height) < .2, body.pos.toArray());
      }
      test(key + ': map has grapple anchors within reach of spawn', L.rings.some(p => p.distanceTo(L.playerStart) < 75 && world.hasLineOfSight(L.playerStart.clone().add(new THREE.Vector3(0, 1.6, 0)), p)));
      const bossSafe = L.spawns.filter(p => !world.overlapsBody(makeBody(p, 1.2, 5.2)));
      test(key + ': distant boss spawns have headroom', bossSafe.some(p => p.distanceTo(L.playerStart) > 20));
      const bounds = world.raycast(new THREE.Vector3(0, 2, L.bounds.maxZ - 7), new THREE.Vector3(0, 0, 1), 20);
      test(key + ': perimeter blocks escape', !!bounds);
      const world2 = new World(), scene2 = new THREE.Scene(), L2 = buildLevel(scene2, world2, key, { arena: true });
      test(key + ': solo and multiplayer share deterministic collision layout', JSON.stringify(world.boxes.map(b => [b.min, b.max])) === JSON.stringify(world2.boxes.map(b => [b.min, b.max])) && L2.arenaSpawns.length >= 10);
      for (const s of [scene, scene2]) s.traverse(m => { m.geometry?.dispose(); if (m.material) m.material.dispose(); });
    }
    return out;
  });
  for (const f of fixtures) check(f.name + (f.pass ? '' : ' ' + JSON.stringify(f.detail)), f.pass);
  for (const key of ['harbor', 'canyon', 'gardens', 'forest', 'duel', 'meadow', 'deepforest', 'lostwoods', 'dust2', 'skyline', 'district']) {
    await page.locator(`[data-map="${key}"]`).click();
    check(key + ': choosing a map keeps menu open', await page.evaluate(key => __game.game.state === 'start' && document.querySelector(`[data-map="${key}"]`).getAttribute('aria-pressed') === 'true', key));
    await page.locator('#soloBtn').click();
    await page.waitForFunction(key => __game.level.key === key && __game.game.state === 'play', key);
    await page.waitForTimeout(500);
    check(key + ': correct world loads with reset support state', await page.evaluate(() => __game.player.alive && __game.player.ordnance.mines.length === 0));
    await page.keyboard.press('b'); await page.waitForFunction(() => __game.player.ordnance.mines.length > 0);
    check(key + ': mine deploys through keyboard input', true);
    const birds = await page.evaluate(() => __game.level.grappleMovers.filter(m => m.id?.startsWith('bird-')).length);
    check(key + ': six flying animals are present', birds === 6);
    // Representative first-person screenshot faces the map's main landmark.
    await page.evaluate(() => { __game.player.yaw = 0; __game.player.pitch = .02; __game.input.mx = __game.input.my = 0; __game.input.look.x = __game.input.look.y = 0; });
    await page.waitForTimeout(1800);
    if (process.env.MAP_SCREENSHOTS) await page.screenshot({ path: resolve(process.env.MAP_SCREENSHOTS, `harita-${key}.png`) });
    await page.keyboard.press('Escape'); await page.waitForFunction(() => __game.game.state === 'pause');
    await page.locator('#menuBtn').click(); await page.waitForFunction(() => __game.game.state === 'start');
  }
  await page.locator('[data-map="harbor"]').click(); await page.reload(); await page.waitForFunction(() => !!window.__game, null, {timeout: 60000});
  check('chosen map survives reload', await page.locator('[data-map="harbor"]').getAttribute('aria-pressed') === 'true');
  if (process.env.MAP_SCREENSHOTS) await page.screenshot({ path: resolve(process.env.MAP_SCREENSHOTS, 'harita-secimi.png') });
  await page.setViewportSize({ width: 640, height: 800 });
  check('compact map picker has no horizontal overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.mapbtn')].every(b => b.getBoundingClientRect().right <= innerWidth)));
  if (process.env.MAP_SCREENSHOTS) await page.screenshot({ path: resolve(process.env.MAP_SCREENSHOTS, 'harita-secimi-dar.png') });
  check('no runtime errors during map selection or transitions', errors.length === 0);
  console.log(`${count} map checks passed.`);
} finally { await browser.close(); }
