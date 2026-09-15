// Run against the local server: PLAYWRIGHT_MODULE can point to a bundled Playwright package.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const modulePath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = await import(modulePath ? pathToFileURL(resolve(modulePath)).href : 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined), args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let assertions = 0;
function check(name, result) { assert.ok(result, name); assertions++; console.log(`PASS ${name}`); }
try {
  await page.goto(process.env.GAME_URL || 'http://127.0.0.1:8911');
  await page.waitForFunction(() => !!window.__game);
  check('English default menu renders', (await page.locator('#soloBtn').innerText()).includes('PLAY'));
  await page.locator('.controls summary').click();
  check('opening controls does not start the game', await page.evaluate(() => __game.game.state === 'start' && document.querySelector('.controls').open));
  check('expanded menu stays inside viewport', await page.evaluate(() => { const r = document.querySelector('.panel').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
  await page.locator('.controls summary').click();
  await page.locator('#soloBtn').click();
  await page.waitForFunction(() => __game.game.state === 'play');
  for (const [key, kind] of [['1', 'rifle'], ['2', 'shotgun'], ['3', 'sniper'], ['4', 'katana'], ['5', 'revolver'], ['6', 'smg'], ['7', 'ak47'], ['8', 'm4a1'], ['9', 'dual'], ['0', 'famas']]) {
    await page.keyboard.press(key);
    await page.waitForFunction(kind => __game.player.weapon.kind === kind, kind);
    check(`keyboard slot ${key}: ${kind}`, true);
  }
  await page.keyboard.press('5');
  await page.waitForFunction(() => document.querySelector('#reserve').textContent === '/∞');
  check('solo revolver displays unlimited reserve', true);
  await page.keyboard.press('6');
  await page.mouse.down(); await page.waitForTimeout(350); await page.mouse.up();
  check('SMG fires through mouse input', await page.evaluate(() => __game.player.weapon.mag < 28));
  await page.keyboard.press('f');
  await page.waitForFunction(() => __game.player.weapon.kind === 'katana');
  await page.waitForFunction(() => __game.player.weapon.kind === 'smg');
  check('quick melee returns to the SMG', true);
  const before = await page.evaluate(() => __game.player.body.pos.toArray());
  await page.keyboard.down('w'); await page.waitForTimeout(250); await page.keyboard.up('w');
  check('W moves the player', await page.evaluate(before => __game.player.body.pos.distanceTo(new __game.player.body.pos.constructor(...before)) > 0.2, before));
  await page.keyboard.down('g');
  await page.waitForFunction(() => __game.player._arc?.area.visible);
  check('grenade preview shows the actual blast radius', await page.evaluate(() => __game.player._arc.area.geometry.parameters.radius === 8.5));
  await page.keyboard.up('g');
  await page.waitForFunction(() => __game.player.nades.length > 0);
  check('releasing G throws a grenade', true);
  await page.waitForFunction(() => __game.player.nades.length === 0);
  check('grenade explodes and is removed', true);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => __game.game.state === 'pause');
  check('Escape pauses solo', true);

  const results = await page.evaluate(async () => {
    const THREE = await import('/vendor/three/three.module.js');
    const { World } = await import('/src/physics.js');
    const { Player } = await import('/src/player.js');
    const { EnemyManager } = await import('/src/enemies.js');
    const { RemotePlayer } = await import('/src/players.js');
    const { WEAPON_ORDER, GRENADE, MELEE, blastDamage, ropeCorrection } = await import('/src/combat.js');
    const { pickupPosition, needsPickup } = await import('/src/supplies.js');
    const { HUD } = await import('/src/hud.js');
    const out = [], test = (name, result, detail) => out.push({ name, pass: !!result, detail });
    const v = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
    const noops = () => new Proxy({ shakeAmt: 0 }, { get: (target, key) => key in target ? target[key] : () => {} });
    const held = new Set(), pressed = new Set();
    const world = new World();
    const ctx = { scene: new THREE.Scene(), camera: new THREE.PerspectiveCamera(), world,
      level: { playerStart: v(), pickups: [v()], rings: [], grappleMovers: [], bounds: {minX:-90,maxX:90,minZ:-90,maxZ:90} },
      input: { down: key => held.has(key), pressed: key => pressed.has(key), look: { x: 0, y: 0 }, move: { x: 0, y: 0 }, rumble() {} },
      game: { mode: 'solo', hitstop() {}, addScore() {}, onPlayerDeath() {} }, effects: noops(), hud: noops() };
    const P = ctx.player = new Player(ctx); P.reset(v()); P.eye.set(0, 1.6, 0); P.center.set(0, 1, 0);
    const enemies = ctx.enemies = new EnemyManager(ctx);
    const state = () => P._weaponState(false, false, 0);
    const advance = (weapon, seconds) => { for (let t = 0; t < seconds; t += 1 / 120) weapon.update(1 / 120, state()); };
    for (const w of P.weapons.filter(w => w.isGun)) {
      ctx.game.mode = 'ffa'; w.reset(); w.mag = 0; w.reserve = 2; w.startReload(); advance(w, w.reloadDur * 3 + 0.1);
      test(`${w.kind}: partial reload conserves ammo`, w.mag === Math.min(2, w.magSize) && w.reserve === Math.max(0, 2 - w.magSize), [w.mag, w.reserve]);
      w.mag = 0; w.reserve = 0; w.startReload(); test(`${w.kind}: finite empty reserve cannot reload`, !w.reloading);
      w.reserve = 20; w.startReload(); w.update(w.reloadDur * 0.4, state()); w.unequip();
      test(`${w.kind}: switch cancels reload cleanly`, !w.reloading && (!w.magMesh || w.magMesh.position.y === w.magY));
      w.reset(); test(`${w.kind}: respawn clears reload/cycle/cooldown`, w.mag === w.magSize && !w.reloading && w.fireT === 0 && w.pumpT === 0);
    }
    ctx.game.mode = 'solo'; const revolver = P.weapons[4]; revolver.mag = 0; revolver.reserve = 0; advance(revolver, 2);
    test('empty solo revolver recovers without pickups', revolver.mag === 6 && revolver.reserve === 0);
    for (const w of P.weapons.filter(w => w.isGun)) w.reserve = w.maxReserve;
    P.grenades = P.maxGrenades;
    test('full ammo and grenades preserve pickup', !needsPickup('ammo', P));
    P.ordnance.mineStock = 2; test('missing mines alone allow collecting an ammo box', needsPickup('ammo', P)); P.ordnance.mineStock = 3;
    P.grenades--; test('ammo pickup still supplies a missing grenade', needsPickup('ammo', P));
    test('full health preserves health pickup', !needsPickup('health', P));

    world.addBox(v(-20, -1, -20), v(20, 0, 20)); world.finalize();
    const drop = pickupPosition(world, v(0, 15, 0), [v()]);
    test('aerial pickup lands on ground', Math.abs(drop.y - 0.6) < 1e-8, drop.toArray());
    const outside = pickupPosition(world, v(80, -30, 80), [v()]);
    test('out-of-bounds pickup recovers at safe spot', outside.distanceTo(v(0, 0.6, 0)) < 1e-8);
    world.addBox(v(-2, 4, -2), v(2, 5, 2)); world.finalize();
    test('rooftop pickup stays on its roof', Math.abs(pickupPosition(world, v(0, 8, 0), [v()]).y - 5.6) < 1e-8);
    world.clear();

    const spawn = (x, y, z) => { const e = enemies.spawn('heavy', v(x, y - 1, z)); e.center.set(x, y, z); e.state = 'hunt'; e.root.scale.setScalar(1); return e; };
    const a = spawn(0, 1.6, -3.7), late = spawn(0, 1.6, -8);
    const katana = P.weapons[3]; katana.reset(); katana.startSlash(state());
    advance(katana, 0.09); test('katana reaches farther than original range', a.hp < 320, a.hp);
    const afterFirst = a.hp; late.center.z = -3;
    advance(katana, 0.08); test('katana catches a target entering late in active window', late.hp < 320, late.hp);
    test('katana hits each target once per swing', a.hp === afterFirst, a.hp);
    advance(katana, 0.2); const recovery = spawn(0, 1.6, -2); advance(katana, 0.04);
    test('katana recovery does not damage new targets', recovery.hp === 320);
    const wall = world.addBox(v(-2, 0, -1.7), v(2, 4, -1.5)); world.finalize();
    test('solid wall blocks bot melee', enemies.inArc(P.eye, P.forward, MELEE.range, MELEE.cosHalf).length === 0);
    const hp = recovery.hp; enemies.blastEnemies(v(0, 1.6, 0), GRENADE.radius, GRENADE.damage, null, GRENADE.innerRadius, GRENADE.edgeDamage);
    test('solid wall blocks grenade damage to bots', recovery.hp === hp);
    world.removeBox(wall);
    const oldDamage = enemies.mods.damage; enemies.mods.damage = 99; enemies.mods.incomingDamage = 1.2;
    enemies.damage(recovery, 10, { source: 'rifle', part: 'torso', point: recovery.center.clone(), dir: v(0, 0, -1) });
    test('enemy outgoing multiplier does not affect damage received', recovery.hp === hp - 12);
    enemies.mods.damage = oldDamage;
    test('grenade inner area is lethal to a standard grunt', blastDamage(4.2, 8.5, 125, 4.2, 25) * 1.2 >= 100);
    test('grenade damages outer area and respects outer boundary', blastDamage(7.5, 8.5, 125, 4.2, 25) > 25 && blastDamage(8.6, 8.5, 125, 4.2, 25) === 0);

    for (const index of [0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11]) {
      const remote = new RemotePlayer(ctx, 'fixture', 'fixture', 0, 1); remote.setWeapon(index);
      for (const pitch of [-0.6, 0, 0.6]) {
        remote.pitch = pitch; remote.forward.set(0, Math.sin(pitch), -Math.cos(pitch));
        remote._animate(1 / 60); remote.root.updateMatrixWorld(true);
        const barrel = v(0, 0, 1).transformDirection(remote.J.gun.matrixWorld);
        test(`${WEAPON_ORDER[index]} remote barrel follows pitch ${pitch}`, barrel.dot(remote.forward) > 0.99999, barrel.toArray());
      }
      remote.setWeapon(3); remote._animate(0);
      test('katana retains a distinct carried pose after switching', remote.J.gun.rotation.x === 0);
      remote.dispose();
    }
    // Same stretched-rope correction integrated over one second at different render rates.
    const travel = [30, 60, 144].map(fps => { let n = 0; for (let i = 0; i < fps; i++) n += ropeCorrection(100, 1 / fps); return n; });
    test('rope correction has the same rate at 30/60/144 FPS', Math.max(...travel) - Math.min(...travel) < 1e-8, travel);
    enemies.clear(); P.eye.set(0, 1.6, 0); P.center.set(0, 1, 0);
    ctx.level.rings = [v(0.6, 1.6, -10)]; world.addBox(v(0.2, 0, -6), v(1, 3, -4)); world.finalize();
    test('obstructed assisted ring cannot be hooked', P._findGrappleTarget() === null);
    world.clear(); ctx.level.rings = [v(0, 8, -12)]; P.forward.copy(ctx.level.rings[0]).sub(P.eye).normalize();
    held.add('grapple'); pressed.add('grapple'); P._updateGrapple(1 / 60); pressed.clear();
    test('holding grapple launches hook', P.grapple.state === 'fly');
    for (let i = 0; i < 90; i++) P._updateGrapple(1 / 120);
    test('visible grapple target attaches', P.grapple.state === 'on');
    const length = P.grapple.len; P._updateGrapple(0.02);
    test('holding Q alone reels in an attached rope', P.grapple.len < length);
    P.body.vel.set(5, -3, -4); held.delete('grapple'); P._updateGrapple(0.01);
    test('releasing grapple detaches and preserves momentum', P.grapple.state === 'idle' && P.body.vel.distanceTo(v(5, -3, -4)) < 1e-8);

    P.center.set(0, 1, 0); P.hp = 120; const grenadePoint = v(0, 0.75, 0);
    P.explodeNade({ mine: false, pos: grenadePoint, id: 'remote' });
    test('remote grenade simulation cannot apply duplicate local damage', P.hp === 120);
    const target = { isLocal: false, alive: true, center: v(0, 1, -2), id: 'opponent' }; let applications = 0;
    ctx.targets = () => [P, target]; ctx.canHurt = t => t !== P;
    ctx.hitGrenadePlayer = () => applications++;
    const owned = { mine: true, pos: grenadePoint, id: 'owned' }; P.explodeNade(owned); P.explodeNade(owned);
    test('owned explosion applies opponent damage once', applications === 1);
    test('owned explosion still applies bounded self damage', P.hp === 84, P.hp);
    P.throwGrenade({ id: 'dedup', pos: [0, 3, 0], vel: [0, 0, -2] }); const count = P.nades.length;
    P.throwGrenade({ id: 'dedup', pos: [0, 3, 0], vel: [0, 0, -2] });
    test('duplicate grenade network event creates one projectile', P.nades.length === count);
    P.throwGrenade({ id: 'invalid', pos: [NaN, 3, 0], vel: [0, 0, -2] });
    test('invalid grenade coordinates are rejected', P.nades.length === count);
    P.reset(v()); test('respawn cancels katana and pending auto-return', katana.slashT === 0 && !katana.blocking && P.returnT === 0);

    const { supportFixtures } = await import('/tests/support-fixtures.js');
    await supportFixtures({ ctx, P, world, enemies, held, pressed, spawn, test, v, state });
    const root = document.createElement('div'), hud = new HUD(root);
    hud.kill('<b>literal player name</b>', 10);
    test('kill feed treats player text as text, not HTML', !root.querySelector('#killfeed b') && root.querySelector('#killfeed').textContent.includes('<b>'));
    // Registered network receiver: duplicate grenade damage is ignored, malformed damage rejected.
    const live = window.__game; const savedState = live.game.state; live.game.state = 'play'; live.player.hp = 120; live.player.alive = true; live.player.shieldT = 0;
    const receive = live.net.handlers.get('pdmg');
    receive({ amount: 30, from: [0, 1, 0], src: 'grenade', explosionId: 'test-event' }, 'fixture');
    receive({ amount: 30, from: [0, 1, 0], src: 'grenade', explosionId: 'test-event' }, 'fixture');
    test('network damage receiver deduplicates explosion IDs', live.player.hp === 90, live.player.hp);
    receive({ amount: -10 }, 'fixture'); receive({ amount: NaN }, 'fixture');
    test('malformed damage cannot heal or poison health', live.player.hp === 90);
    receive({ amount: 20, from: [0, 1, 0], src: 'mine', explosionId: 'mine-event' }, 'fixture');
    receive({ amount: 20, from: [0, 1, 0], src: 'mine', explosionId: 'mine-event' }, 'fixture');
    test('network receiver deduplicates mine damage too', live.player.hp === 70);
    live.game.state = savedState;
    return out;
  });
  for (const result of results) check(`${result.name}${result.pass ? '' : ` (${JSON.stringify(result.detail)})`}`, result.pass);
  check('no browser runtime errors', errors.length === 0);
  console.log(`\n${assertions} checks passed.`);
} finally { await browser.close(); }
