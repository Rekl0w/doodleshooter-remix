import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const {
  chromium
} = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const browser = await chromium.launch({
  headless: true,
  channel: process.platform === 'win32' ? 'msedge' : undefined,
  args: ['--enable-unsafe-swiftshader', '--disable-background-timer-throttling', '--disable-renderer-backgrounding']
});
const pages = [],
  errors = [];
let count = 0,
  host;
const check = (name, v) => {
  assert.ok(v, name);
  count++;
  console.log('PASS ' + name);
};
async function open(name) {
  const p = await browser.newPage({
    viewport: {
      width: 1280,
      height: 960
    }
  });
  pages.push(p);
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(process.env.GAME_URL || 'http://127.0.0.1:8911');
  await p.waitForFunction(() => window.__game);
  await p.locator('[data-map="forest"]').click();
  await p.locator('#onlineBtn').click();
  await p.locator('#setName').fill(name);
  return p;
}
async function free(p) {
  await p.evaluate(() => {
    const g = __game;
    g.game.menu = false;
    g.hud.hideScreen();
    g.input.usingGamepad = true;
    g.input.keys = {};
    g.input.mouseBtns = {};
    document.activeElement?.blur();
  });
}
async function place(p, x, z) {
  const id = await p.evaluate(() => __game.net.id);
  await host.evaluate(({
    id,
    x,
    z
  }) => {
    const v = __game.combat.players.get(id);
    v.pos = [x, 0, z];
    v.history = [];
    v.protectedUntil = 0;
    v.lastSnap = performance.now() / 1000;
  }, {
    id,
    x,
    z
  });
  await p.evaluate(({
    x,
    z
  }) => {
    const g = __game;
    g.player.body.pos.set(x, 0, z);
    g.player.body.vel.set(0, 0, 0);
    g.player.yaw = 0;
    g.player.pitch = 0;
  }, {
    x,
    z
  });
  await free(p);
}
async function join(p, code, state = 'lobby') {
  await p.locator('#codeBox').fill(code);
  await p.locator('#joinBtn').click();
  await p.waitForFunction(state => __game.game.state === state, state);
}
try {
  host = await open('Host');
  await host.locator('input[value="private"]').check();
  await host.locator('#createBtn').click();
  await host.waitForFunction(() => __game.net.active);
  const code = await host.evaluate(() => __game.net.code),
    hostId = await host.evaluate(() => __game.net.id);
  const guest = await open('Guest <safe>');
  await join(guest, code);
  const guestId = await guest.evaluate(() => __game.net.id);
  check('host has katana checkbox and kick controls in lobby', (await host.locator('#katanaRule').isChecked()) && (await host.locator('[data-kick]').count()) === 1);
  check('guest has no moderation controls', (await guest.locator('#katanaRule').count()) === 0 && (await guest.locator('[data-kick]').count()) === 0);
  check('player name escaped inside kick row', (await host.locator('.moderation-row').innerText().then(s => s.includes('Guest <safe>'))) && (await host.locator('.moderation-row safe').count()) === 0);
  await host.locator('#katanaRule').uncheck();
  await guest.waitForFunction(() => __game.lobby.katana === false);
  check('host rule broadcasts to guest', await guest.locator('#moderation').innerText().then(s => s.includes('Katana disabled')));
  if (process.env.QA_OUTPUT) await host.screenshot({
    path: resolve(process.env.QA_OUTPUT, 'host-lobby-moderation.png')
  });
  await guest.evaluate(() => {
    __game.net.broadcast('start', {
      map: 'dust2',
      katana: true
    });
    __game.net.broadcast('lobby', {
      katana: true
    });
    __game.net.broadcast('kick', {
      reason: 'host'
    });
  });
  await host.waitForTimeout(200);
  check('guest cannot start, change rules or kick host', await host.evaluate(() => __game.game.state === 'lobby' && !__game.lobby.katana && __game.net.active));
  await host.locator('#startBtn').click();
  for (const p of pages) {
    await p.waitForFunction(() => __game.game.state === 'play');
    await free(p);
  }
  const rival = await open('Late join');
  await join(rival, code, 'play');
  const rivalId = await rival.evaluate(() => __game.net.id);
  await free(rival);
  check('late join gets the same disabled katana rule and authoritative life', await rival.evaluate(() => __game.game.katanaAllowed === false && __game.player.lifeId > 0));
  await place(host, 0, 20);
  await place(guest, 0, 10);
  await place(rival, 8, 10);
  await host.waitForTimeout(500);
  await guest.keyboard.press('4');
  await guest.keyboard.press('f');
  await guest.keyboard.press('v');
  check('disabled katana rejects number key and quick melee', await guest.evaluate(() => __game.player.weapon.kind !== 'katana' && __game.player.weapons[3].slashT === 0));
  check('weapon wheel skips disabled katana', await guest.evaluate(() => {
    __game.player.switchTo(2);
    __game.player.cycleWeapon(1);
    return __game.player.weaponIndex === 4;
  }));
  await guest.evaluate(() => {
    __game.player.weapons[3].startSlash({});
  });
  check('direct slash invocation honors rule', await guest.evaluate(() => __game.player.weapons[3].slashT === 0));
  const claim = await guest.evaluate(id => {
    const g = __game,
      t = g.remote.get(id);
    return {
      id: 'disabled-blade',
      target: id,
      life: t.lifeId,
      attackerLife: g.player.lifeId,
      src: 'katana',
      from: g.player.eye.toArray(),
      point: t.center.toArray(),
      part: 'torso'
    };
  }, hostId);
  await guest.evaluate(d => __game.net.send('combat-hit', d), claim);
  await host.waitForTimeout(200);
  check('forged katana packet cannot damage host', await host.evaluate(() => __game.player.hp === 110));
  // Spoof every privileged route with both relay and direct addressing.
  await guest.evaluate(({
    hostId,
    rivalId
  }) => {
    const n = __game.net;
    for (const t of ['start', 'end', 'kick', 'refused', 'score', 'lobby', 'combat-state', 'combat-death', 'combat-result', 'pickup', 'taken', 'feed', 'pdead', 'pdmg', 'phit']) {
      const d = {
        id: hostId,
        victim: hostId,
        hp: 0,
        life: 99999,
        amount: 99999,
        map: 'dust2',
        katana: true,
        reason: 'host'
      };
      n.broadcast(t, d);
      n.sendTo(rivalId, t, d);
    }
  }, {
    hostId,
    rivalId
  });
  await host.waitForTimeout(250);
  check('spoofed host controls and legacy combat do not reach other clients', (await rival.evaluate(() => __game.net.active && __game.game.state === 'play' && !__game.game.katanaAllowed && __game.player.hp === 110)) && (await host.evaluate(() => __game.net.active && __game.player.hp === 110)));
  // Real mines and grenades remain host-simulated across a host respawn.
  check('guest places a legitimate mine', await guest.evaluate(() => __game.player.ordnance.placeMine()));
  await host.waitForFunction(() => __game.player.ordnance.remoteMines.size === 1);
  const guestMine = await guest.evaluate(() => { const m=__game.player.ordnance.mines[0]; return { id:m.id, pos:m.pos.toArray(), map:__game.level.key }; });
  await rival.evaluate(d => __game.net.send('ordnance', { op:'remove', ...d }), guestMine);
  await host.waitForTimeout(180);
  check('a rival cannot retract another player mine', await host.evaluate(() => __game.player.ordnance.remoteMines.size === 1));
  await guest.evaluate(d => __game.net.send('ordnance', { op:'place', id:'floating-cheat', pos:[d.pos[0],d.pos[1]+8,d.pos[2]], map:d.map }), guestMine);
  await host.waitForTimeout(180);
  check('host rejects floating mine placement', await host.evaluate(() => __game.player.ordnance.remoteMines.size === 1));
  await host.evaluate(() => {
    const g = __game,
      c = g.combat,
      v = c.players.get(g.net.id);
    v.protectedUntil = 0;
    c.damage(v, 999);
    v.deadAt = performance.now() / 1000 - 3;
    g.net._emit('combat-respawn', {
      life: v.life
    }, g.net.id);
  });
  check('host respawn preserves other players mine visuals', await host.evaluate(() => __game.player.alive && __game.player.ordnance.remoteMines.size === 1));
  await place(host, 0, 7);
  await host.waitForFunction(() => __game.player.hp < 110);
  check('host triggers remote mine and applies bounded damage', await host.evaluate(() => __game.player.hp >= 20 && __game.player.ordnance.remoteMines.size === 0));
  await guest.waitForFunction(() => __game.player.ordnance.mines.length === 0);
  check('host detonation removes the owners mine too', true);
  await host.evaluate(() => {
    for (const p of __game.combat.players.values()) __game.combat.heal(p.id, 999);
  });
  await guest.evaluate(() => {
    __game.player.pitch = -1.4;
    const original = __game.player.onThrow;
    __game.player.onThrow = d => {
      window.lastThrow = d;
      original(d);
    };
  });
  await guest.waitForTimeout(100);
  await guest.evaluate(() => __game.player.throwGrenade(null, 0));
  await host.waitForFunction(() => __game.player.nades.length === 1);
  await guest.evaluate(() => __game.net.broadcast('nade', lastThrow));
  check('duplicate grenade does not consume another host stock', await host.evaluate(id => __game.combat.players.get(id).grenades === 2, guestId));
  await host.waitForFunction(() => __game.player.hp < 110);
  await host.waitForFunction(() => __game.player.nades.length === 0);
  check('host projectile simulation applies grenade damage once', await host.evaluate(() => __game.player.hp >= 25 && __game.player.hp < 110));
  await host.evaluate(() => {
    for (const p of __game.combat.players.values()) __game.combat.heal(p.id, 999);
  });
  await place(host, 0, 20);
  await place(guest, 0, 10);
  await host.waitForTimeout(300);
  // A hostile snapshot tries to hide the player and extend spawn protection.
  await guest.evaluate(() => {
    window.originalState = __game.net.handlers.get('combat-state');
    __game.net.on('combat-state', () => {});
    __game.player.hp = 999999;
    __game.player.shieldT = 999999;
    const n = __game.net;
    const s = [...__game.player.body.pos.toArray(), 0, 0, 0, 8191, 999999, 0, 0, 0, 0, 0, 0, __game.player.lifeId];
    n.broadcast('ps', s);
  });
  await host.waitForTimeout(300);
  check('guest health and protection claims are overwritten', await host.evaluate(id => {
    const r = __game.remote.get(id);
    return r.hp === 110 && !r.protected && !r.away && !r.blocking;
  }, guestId));
  check('third player sees the sanitized guest', await rival.evaluate(id => {
    const r = __game.remote.get(id);
    return r.hp === 110 && !r.protected && !r.away;
  }, guestId));
  await guest.evaluate(() => {
    __game.player.takeDamage = () => {};
    __game.player.die = () => {};
    __game.net.on('combat-death', () => {});
    window.cheat = setInterval(() => {
      __game.player.alive = true;
      __game.player.hp = 999999;
      __game.player.lifeId = 999999;
      __game.player.shieldT = 999999;
    }, 20);
  });
  check('real sniper ray hits modified invulnerable client', await host.evaluate(id => {
    const g = __game,
      t = g.remote.get(id);
    g.player.switchTo(2);
    return g.player.weapon.fireRay(g.player.eye, g.player.forward.copy(t.center.clone().sub(g.player.eye).normalize()));
  }, guestId));
  await host.waitForFunction(id => __game.combat.players.get(id).hp === 0, guestId);
  await rival.waitForFunction(id => !__game.remote.get(id).alive, guestId);
  check('host death and score survive victim ignoring all damage', await host.evaluate(id => __game.scores.get(id).deaths === 1 && __game.scores.get(__game.net.id).kills === 1, guestId));
  await host.waitForTimeout(300);
  check('fake living snapshots cannot resurrect the cheater for others', await rival.evaluate(id => !__game.remote.get(id).alive && __game.remote.get(id).hp === 0, guestId));
  await guest.evaluate(d => {
    for (let i = 0; i < 10; i++) __game.net.send('combat-hit', {
      ...d,
      id: 'dead-' + i,
      src: 'sniper'
    });
    __game.net.send('combat-respawn', {
      life: d.attackerLife
    });
  }, claim);
  await host.waitForTimeout(200);
  check('dead guest cannot attack or respawn early', await host.evaluate(id => __game.player.hp === 110 && __game.combat.players.get(id).hp === 0, guestId));
  // Host can kick even when the victim ignores the kick message itself.
  await guest.evaluate(() => {
    clearInterval(cheat);
    __game.net.on('kick', () => {});
  });
  await host.keyboard.press('Escape');
  await host.waitForFunction(() => __game.game.menu);
  check('host pause menu exposes kick without a mid-match rule toggle', (await host.locator('[data-kick]').count()) === 2 && (await host.locator('#katanaRule').count()) === 0);
  if (process.env.QA_OUTPUT) await host.screenshot({
    path: resolve(process.env.QA_OUTPUT, 'host-match-moderation.png')
  });
  await host.locator(`[data-kick="${guestId}"]`).click();
  await host.waitForFunction(id => !__game.net.conns.has(id) && !__game.remote.has(id), guestId);
  await rival.waitForFunction(id => !__game.remote.has(id), guestId);
  check('host closes connection and removes kicked player from every roster', true);
  const rejected = await guest.evaluate(async code => {
    try {
      await __game.net.join(code, {
        name: 'New name'
      });
      return false;
    } catch (e) {
      return String(e).includes('removed from this room');
    }
  }, code);
  check('same browser cannot evade room removal with a new peer ID or name', rejected);
  await free(host);
  await host.evaluate(() => {
    __game.lobby.katana = true;
    __game.hostStart();
  });
  await rival.waitForFunction(() => __game.game.katanaAllowed === true);
  check('next round can enable katana again', await rival.evaluate(() => {
    __game.player.switchTo(3);
    return __game.player.weapon.kind === 'katana';
  }));
  // The host leaving must not promote an untrusted peer into the combat authority.
  await host.evaluate(() => __game.leaveOnline(''));
  await rival.waitForFunction(() => !__game.net.active && __game.game.state === 'start');
  check('host departure ends the room instead of transferring trust', await rival.locator('#panel').innerText().then(t => t.includes('The host left')));
  check('no browser runtime errors: ' + errors.join('; '), errors.length === 0);
  console.log(count + ' hostile-client and moderation checks passed');
} finally {
  for (const p of pages) await p.evaluate(() => {
    if (window.cheat) clearInterval(window.cheat);
    __game.net.leave();
  }).catch(() => {});
  await browser.close();
}
