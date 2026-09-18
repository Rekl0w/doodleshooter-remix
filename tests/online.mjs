import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const browser = await chromium.launch({ headless: true, channel: process.platform === 'win32' ? 'msedge' : undefined, args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const errors = [], pages = [];
let count = 0;
const check = (name, ok) => { assert.ok(ok, name); count++; console.log('PASS ' + name); };
const open = async () => {
  const p = await browser.newPage({ viewport: { width: 960, height: 720 } }); pages.push(p);
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(process.env.GAME_URL || 'http://127.0.0.1:8911');
  await p.waitForFunction(() => !!window.__game, null, { timeout: 60000 });
  return p;
};
try {
  const host = await open();
  await host.locator('[data-map="forest"]').click();
  await host.locator('#onlineBtn').click();
  await host.locator('input[value="private"]').check();
  await host.locator('#createBtn').click();
  await host.waitForFunction(() => __game.net.active, null, { timeout: 15000 });
  const info = await host.evaluate(() => ({ active: __game.net.active, code: __game.net.code, status: __game.lobby.status }));
  check('private PeerJS room opens: ' + info.status, info.active);
  await host.evaluate(() => { __game.hostStart(); __game.input.usingGamepad = true; __game.game.menu = false; });
  await host.waitForTimeout(600);
  await host.evaluate(() => __game.player.ordnance.placeMine());
  check('host starts forest and places a mine', await host.evaluate(() => __game.level.key === 'forest' && __game.player.ordnance.mines.length === 1));
  const guest = await open();
  await guest.evaluate(() => {
    const n = __game.net, start = n.handlers.get('start'), state = n.handlers.get('combat-state');
    window.startPackets = []; window.vitalPackets = [];
    n.on('start', (d, from) => { startPackets.push(d); start(d, from); });
    n.on('combat-state', (d, from) => { if (d?.id !== n.id) vitalPackets.push(d); state(d, from); });
  });
  await guest.locator('#onlineBtn').click();
  await guest.locator('#codeBox').fill(info.code);
  await guest.locator('#joinBtn').click();
  await guest.waitForFunction(() => __game.game.state === 'play' && __game.net.active, null, { timeout: 20000 });
  check('late join enters the host map', await guest.evaluate(() => __game.level.key === 'forest'));
  check('late-start payload hides remote vitals and spawn indices', await guest.evaluate(() => {
    const d = startPackets[0], remote = d?.vitals?.find(v => v.id !== __game.net.id);
    return !!remote && remote.pos[1] === -100 && !d.spawns && Number.isInteger(d.spawn);
  }));
  await guest.waitForFunction(() => vitalPackets.length > 0, null, { timeout: 5000 });
  check('combat-state side channel never exposes another player position', await guest.evaluate(() => vitalPackets.every(v => v.pos?.[1] === -100 && v.lastHit === null)));
  await guest.waitForFunction(() => __game.sceneClock.samples.length >= 2, null, { timeout: 15000 });
  check('both clients have the same 12 weapon slots', await guest.evaluate(() => __game.player.weapons.length === 12));
  await guest.waitForFunction(() => __game.player.ordnance.remoteMines.size === 1, null, { timeout: 5000 });
  check('late join receives existing mines after loading the map', true);
  const clock = async p => p.evaluate(() => ({ time: __game.sceneClock.time(), wall: Date.now(), samples: __game.sceneClock.samples.length }));
  const [a, b] = await Promise.all([clock(host), clock(guest)]);
  check('host and guest bird clocks agree within 120 ms', Math.abs((a.time - b.time) - (a.wall - b.wall) / 1000) < .12);
  const earlyGuestId = await guest.evaluate(() => __game.net.id);
  await host.evaluate(guestId => {
    const g = __game;
    for (const [id, z] of [[g.net.id, 20], [guestId, 10]]) {
      const p = g.combat.players.get(id); if (p) { p.pos = [0, 0, z]; p.history = []; p.protectedUntil = 0; }
    }
    g.player.body.pos.set(0, 0, 20); g.player.body.vel.set(0, 0, 0); g.player.yaw = Math.PI; g.player.pitch = 0;
  }, earlyGuestId);
  await guest.evaluate(() => { __game.player.body.pos.set(0, 0, 10); __game.player.body.vel.set(0, 0, 0); __game.player.yaw = 0; __game.player.pitch = 0; });
  await guest.waitForTimeout(500);
  for (let i = 6; i < 12; i++) {
    await host.evaluate(i => __game.player.switchTo(i), i);
    await guest.waitForFunction(i => [...__game.remote.values()][0]?.weaponIndex === i, i, { timeout: 5000 });
    check('remote gun slot ' + i + ' synchronizes', true);
    if (i === 8) check('dual pistols appear in both remote hands', await guest.evaluate(() => {const r=[...__game.remote.values()][0];return r.leftGun?.visible&&r.leftGun.parent===r.J.foreL&&r.J.gun.children.length>0;}));
  }
  const guestId=await guest.evaluate(()=>__game.net.id);
  await host.evaluate(id=>{for(const [key,z]of [[__game.net.id,20],[id,10]]){const p=__game.combat.players.get(key);p.pos=[0,0,z];p.history=[];p.protectedUntil=0;}},guestId);
  for (const [p, z] of [[host, 20], [guest, 10]]) await p.evaluate(z => {
    const g = __game; g.game.menu = false; g.hud.hideScreen(); g.player.body.pos.set(0, 0, z); g.player.body.vel.set(0,0,0);
    g.player.shieldT = 0; g.player.yaw = 0; g.player.pitch = 0;
  }, z);
  await host.waitForTimeout(600);
  const hp = await guest.evaluate(() => __game.player.hp);
  check('AK-47 ray hits the remote player', await host.evaluate(() => {
    const g = __game, target = [...g.remote.values()][0]; g.player.switchTo(6);
    return g.player.weapon.fireRay(g.player.eye, g.player.forward.copy(target.center.clone().sub(g.player.eye).normalize()));
  }));
  await guest.waitForFunction(hp => __game.player.hp < hp, hp);
  check('AK-47 PvP damage arrives over WebRTC', await guest.evaluate(hp => hp - __game.player.hp > 0 && hp - __game.player.hp <= 44, hp));
  const hostId = await host.evaluate(() => __game.net.id);
  await guest.evaluate(() => {
    const n = __game.net, shots = n.handlers.get('shots');
    window.shotVisuals = [];
    n.on('shots', (d, from) => { shotVisuals.push({ d, from }); shots(d, from); });
  });
  await host.evaluate(guestId => {
    const g = __game;
    g._visibilityTestWall = g.world.addBox({ x: -20, y: 0, z: -5 }, { x: 20, y: 4, z: -4.5 });
    g.world.finalize();
    for (const [id, z] of [[g.net.id, 0], [guestId, -10]]) {
      const p = g.combat.players.get(id); if (p) { p.pos = [0, 0, z]; p.history = []; p.protectedUntil = 0; }
    }
    g.player.body.pos.set(0, 0, 0); g.player.body.vel.set(0, 0, 0); g.player.yaw = 0; g.player.pitch = 0; g.player.shieldT = 0;
  }, guestId);
  await guest.evaluate(() => { __game.player.body.pos.set(0, 0, -10); __game.player.body.vel.set(0, 0, 0); __game.player.yaw = Math.PI; __game.player.pitch = 0; __game.player.shieldT = 0; });
  await host.waitForTimeout(700);
  check('wall-hidden host snapshot is redacted for the guest', await guest.evaluate(hostId => {
    const r = __game.remote.get(hostId); return !!r && r.away === true && r.root?.visible === false;
  }, hostId));
  await host.evaluate(() => { const g = __game; g.player.switchTo(0); g.player.weapon.fireRay(g.player.eye, g.player.forward); });
  await host.waitForTimeout(220);
  check('wall-hidden shooter tracer is not sent to the guest', await guest.evaluate(() => shotVisuals.length === 0));
  await host.evaluate(() => { __game.world.removeBox(__game._visibilityTestWall); __game._visibilityTestWall = null; });
  await guest.waitForFunction(hostId => __game.remote.get(hostId)?.away === false, hostId, { timeout: 5000 });
  await guest.waitForTimeout(350);
  check('clearing the sight line restores the full remote snapshot', await guest.evaluate(hostId => {
    const r = __game.remote.get(hostId); return !!r && r.away === false && r.body.pos.y > -99;
  }, hostId));
  await host.evaluate(() => {
    const g = __game, p = g.player; g.combat.players.get(g.net.id).pos=[0,0,0]; p.body.pos.set(0,0,0); p.body.vel.set(0,0,0); p.grapStam = 1;
    const b = g.level.grappleMovers.find(b => b.id === 'bird-0');
    const d = b.mesh.position.clone().sub(p.body.pos.clone().add({ x: 0, y: 1.6, z: 0 })).normalize();
    p.yaw = Math.atan2(-d.x, -d.z); p.pitch = Math.asin(d.y); g.game.menu = false; g.hud.hideScreen();
    document.activeElement?.blur();
  });
  await host.waitForTimeout(100);
  await host.keyboard.down('q');
  await host.waitForFunction(() => __game.player.grapple.state === 'on' && __game.player.grapple.mover?.id === 'bird-0');
  check('Q attaches to a flying duck during an online match', true);
  await host.waitForTimeout(1800);
  check('holding Q lifts the player above ground', await host.evaluate(() => __game.player.body.pos.y > 5 && __game.player.grapple.mover?.id === 'bird-0'));
  await guest.waitForFunction(() => [...__game.remote.values()][0]?.grappling);
  check('other client sees the moving grapple rope', await guest.evaluate(() => {
    const r = [...__game.remote.values()][0], bird = __game.level.grappleMovers.find(b => b.id === 'bird-0');
    return r.gPoint.distanceTo(bird.mesh.position) < 2;
  }));
  await host.keyboard.up('q');
  await guest.waitForFunction(() => ![...__game.remote.values()][0]?.grappling);
  check('Q release detaches on both clients', await host.evaluate(() => __game.player.grapple.state === 'idle'));
  for (const map of ['deepforest','lostwoods','dust2','skyline']) {
    await host.evaluate(map => {__game.lobby.map=map;__game.hostStart();},map);
    await guest.waitForFunction(map=>__game.level.key===map&&__game.game.state==='play',map,{timeout:20000});
    check(map+': host choice loads on both online clients',await host.evaluate(map=>__game.level.key===map&&__game.player.alive,map)&&await guest.evaluate(()=>__game.player.alive));
    const layout=async p=>p.evaluate(()=>JSON.stringify(__game.world.boxes.map(b=>[b.min,b.max])));
    check(map+': online collision layouts match',await layout(host)===await layout(guest));
  }
  check('no browser runtime errors', errors.length === 0);
  console.log(count + ' real two-client online checks passed.');
} finally {
  for (const p of pages) await p.evaluate(() => __game.net.leave()).catch(() => {});
  await browser.close();
}
