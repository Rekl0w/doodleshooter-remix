// Browser fixtures use the actual physics, weapons and damage classes.
export async function supportFixtures({ ctx, P, world, enemies, held, pressed, spawn, test, v, state }) {
  const { SUPPORT } = await import('/src/ordnance.js');
  const o = P.ordnance;
  const clean = () => {
    held.clear(); pressed.clear(); enemies.clear(); world.clear();
    world.addBox(v(-90, -1, -90), v(90, 0, 90)); world.finalize();
    P.reset(v()); P.eye.set(0, 1.6, 0); P.center.set(0, 1, 0); P.forward.set(0, 0, -1); P.right.set(1, 0, 0);
    ctx.targets = () => [P]; ctx.canHurt = t => t !== P; enemies.mods.incomingDamage = 1;
  };
  const tick = seconds => { for (let t = 0; t < seconds; t += 1 / 120) o.update(1 / 120); };
  clean();
  world.addBox(v(-2, 0, -1), v(2, 40, -.8)); world.finalize();
  P.body.onGround = false; P.body.pos.y = 10; P.body.vel.set(0, 0, 0); P.airJumps = 0; P.coyote = 0; P.body.hitWall = true;
  P.body.wallNormal.set(0, 0, 1);
  let restoredJump = false, upward = false;
  for (let i = 0; i < 90; i++) {
    if (i % 10 === 0) pressed.add('jump'); else pressed.clear();
    P.update(1 / 120); if (P.airJumps > 0) restoredJump = true; if (P.body.vel.y > 0) upward = true;
  }
  test('repeated Space against a tall wall cannot restore air jumps or launch upward', !restoredJump && !upward);
  clean(); P.body.onGround = true; pressed.add('jump'); P.update(1 / 120); pressed.clear();
  test('normal ground jump remains available', P.body.vel.y > 9 && P.airJumps === 1);
  P.update(.03); pressed.add('jump'); P.update(1 / 120); pressed.clear();
  test('exactly one double jump remains available', P.body.vel.y > 8 && P.airJumps === 0);

  clean(); test('mine can be placed on nearby open ground', o.placeMine());
  const mineTarget = spawn(0, 1, -2); tick(.5);
  test('mine arming delay prevents immediate detonation', mineTarget.hp === 320 && o.mines.length === 1);
  tick(.55); const mineHP = mineTarget.hp;
  test('armed mine detects nearby enemy and detonates once', o.mines.length === 0 && mineHP < 320);
  tick(1); test('removed mine cannot apply another blast', mineTarget.hp === mineHP);
  clean(); o.placeMine(); const mineCovered = spawn(0, 1, -3);
  world.addBox(v(-3, 0, -2.2), v(3, 4, -2)); world.finalize(); tick(2);
  test('mine detection cannot see through walls', o.mines.length === 1 && mineCovered.hp === 320);
  clean(); P.body.pos.y = 15; P.eye.y = 16.6;
  test('mine cannot be placed in mid-air and keeps stock', !o.placeMine() && o.mineStock === 3);
  clean();
  for (let i = 0; i < 4; i++) { P.body.pos.x = i * 2; P.eye.x = i * 2; o.mineCd = 0; o.resupply(); o.placeMine(); }
  o.mineCd = 0; o.resupply(); P.body.pos.x = P.eye.x = 10;
  test('active mine cap prevents unlimited traps', o.mines.length === 4 && !o.placeMine());
  const stock = o.mineStock; o.resupply(); test('resupply replenishes a mine within stock cap', o.mineStock === Math.min(3, stock + 1));


  clean(); const famas = P.weapons.find(w => w.kind === 'famas'); P.switchTo(P.weapons.indexOf(famas), true);
  famas.fire(state()); for (let i = 0; i < 70; i++) famas.update(1 / 120, state());
  test('FAMAS tap fires exactly three rounds', famas.mag === 27 && famas.burstLeft === 0);
  famas.fireT = 0; famas.fire(state()); famas.unequip();
  for (let i = 0; i < 70; i++) famas.update(1 / 120, state());
  test('switching weapons cancels pending burst', famas.mag === 26 && famas.burstLeft === 0);
  famas.reset(); famas.mag = 2; famas.fire(state()); for (let i = 0; i < 28; i++) famas.update(1 / 120, state());
  test('partial burst never consumes negative ammunition', famas.mag === 0 && famas.burstLeft === 0);
  test('removed equipment has no weapon slots or active methods', !P.weapons.some(w => ['rpg','mortar','drone'].includes(w.kind)) && !o.deployDrone && !o.launch);
  test('arsenal includes six distinct additional firearms', ['ak47','m4a1','dual','famas','m249','dmr'].every(k => P.weapons.some(w => w.kind === k && w.isGun)));
  clean();
  o.receive({op:'place',id:'m1',pos:[1,.13,1]}, 'peer'); o.receive({op:'place',id:'m1',pos:[1,.13,1]}, 'peer');
  test('peer mine placements render exactly once', o.remoteMines.size === 1);
  const hp = P.hp; o.receive({op:'boom',id:'m1',pos:[1,.13,1]}, 'peer');
  test('remote mine explosion is visual only', o.remoteMines.size === 0 && P.hp === hp);
  o.receive({op:'place',id:'m1',pos:[1,.13,1]}, 'peer');
  test('late duplicate cannot resurrect exploded mine', o.remoteMines.size === 0);
  o.receive({op:'place',id:'bad',pos:[NaN,0,1]}, 'peer');
  test('malformed mine packet is rejected', o.remoteMines.size === 0);
  const { SceneClock, addSkyAnimals, birdPosition } = await import('/src/sky.js');
  let now = 10; const clock = new SceneClock(() => now); const ping = clock.request(); now = 10.2;
  test('host clock applies half-RTT correction', clock.accept({id:ping.id,time:80}) && Math.abs(clock.time()-80.1)<1e-8);
  test('unsolicited clock replies are ignored', !clock.accept({id:999,time:1}));
  const stale = clock.request(); now += 4; test('excessively delayed clock sample is ignored', !clock.accept({id:stale.id,time:100}));
  const pt1 = birdPosition(123,2,15), pt2=birdPosition(123,2,15);
  test('bird trajectories are deterministic across peers', pt1.equals(pt2));
  const L={ key:'forest', meshes:[], animated:[], grappleMovers:[], rings:[], playerStart:v(), bounds:ctx.level.bounds }; addSkyAnimals({L,scene:ctx.scene});
  test('six visible birds are grapple targets', L.grappleMovers.length === 6 && L.grappleMovers.every(m=>m.radius>1 && m.mesh.children.length>0));
  const oldLevel=ctx.level; ctx.level=L; const mover=L.grappleMovers[0];
  P.body.pos.copy(mover.mesh.position).add(v(0,-4,0)); P.center.copy(P.body.pos).add(v(0,1,0)); P.eye.copy(P.body.pos).add(v(0,1.6,0));
  Object.assign(P.grapple,{state:'on',mover,len:2.5,blockedT:0}); P.grapple.anchor.copy(mover.mesh.position); held.add('grapple');
  const before=P.body.pos.clone();
  for(let i=0;i<240;i++){ for(const a of L.animated)a.update(i/120); P.update(1/120); }
  test('holding Q follows a flying bird without releasing at arrival', P.grapple.state==='on' && P.body.pos.distanceTo(before)>2);
  P.center.copy(mover.mesh.position).add(v(0,-.5,0)); P._updateGrapple(.01);
  test('nearby moving anchor does not trigger automatic detach', P.grapple.state==='on');
  held.clear(); P._updateGrapple(.01); test('releasing Q lets go of bird',P.grapple.state==='idle');
  ctx.level=oldLevel; for(const mesh of L.meshes)ctx.scene.remove(mesh); clean();
}
