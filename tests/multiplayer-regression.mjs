import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const browser=await chromium.launch({headless:true,channel:process.platform === 'win32' ? 'msedge' : undefined,args:['--enable-unsafe-swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const pages=[],errors=[];let count=0,authorityHost;
const check=(n,v)=>{assert.ok(v,n);console.log('PASS '+n);count++;};
const open=async name=>{const context=await browser.newContext({viewport:{width:1100,height:760}});const p=await context.newPage();pages.push(p);p.on('pageerror',e=>errors.push(e.message));await p.goto(process.env.GAME_URL||'http://127.0.0.1:8911');await p.waitForFunction(()=>window.__game);await p.locator('[data-map="forest"]').click();await p.locator('input[name="appearance"][value="solid"]').check();await p.locator('#onlineBtn').click();await p.locator('#setName').fill(name);return p;};
const free=async p=>p.evaluate(()=>{const g=__game;g.game.menu=false;g.hud.hideScreen();g.input.usingGamepad=true;g.input.keys={};g.input.mouseBtns={};g.input.pendingActions.clear();document.activeElement?.blur();});
const waitAlive=p=>p.waitForFunction(()=>__game.player.alive&&__game.game.state==='play'&&!__game.game.menu);
const die=async(p,fast=true)=>{await free(p);const id=await p.evaluate(()=>__game.net.id);await authorityHost.evaluate(({id,fast})=>{const c=__game.combat,v=c.players.get(id);v.protectedUntil=0;c.damage(v,1000);if(fast)v.deadAt=performance.now()/1000-2.35;},{id,fast});await p.waitForFunction(()=>__game.game.state==='dying');};
const ready=p=>p.waitForFunction(()=>{const b=document.querySelector('#respawnBtn');return b&&!b.disabled&&!b.parentElement.hidden;});
const place=async(p,x,z)=>{const id=await p.evaluate(()=>__game.net.id);await authorityHost.evaluate(({id,x,z})=>{const v=__game.combat.players.get(id);v.pos=[x,0,z];v.history=[];v.protectedUntil=0;v.lastSnap=performance.now()/1000;},{id,x,z});await p.evaluate(({x,z})=>{const g=__game;g.player.body.pos.set(x,0,z);g.player.body.vel.set(0,0,0);g.player.yaw=0;g.player.pitch=0;g.input.usingGamepad=true;g.game.menu=false;g.hud.hideScreen();},{x,z});};
try {
 const host=authorityHost=await open('Host');await host.locator('input[value="private"]').check();await host.locator('#createBtn').click();await host.waitForFunction(()=>__game.net.active);const code=await host.evaluate(()=>__game.net.code);
 const guest=await open('Can <3');await guest.locator('#codeBox').fill(code);await guest.locator('#joinBtn').click();await guest.waitForFunction(()=>__game.game.state==='lobby');
 const rival=await open('Rival');await rival.locator('#codeBox').fill(code);await rival.locator('#joinBtn').click();await rival.waitForFunction(()=>__game.game.state==='lobby');
 await host.locator('#startBtn').click();for(const p of pages){await p.waitForFunction(()=>__game.game.state==='play');await free(p);}
 await host.waitForTimeout(400);for(const p of pages)await free(p);
 check('three clients start a real WebRTC match',await host.evaluate(()=>__game.remote.size===2));
 const guestId=await guest.evaluate(()=>__game.net.id),rivalId=await rival.evaluate(()=>__game.net.id);
 await place(host,0,20);await place(guest,0,10);await place(rival,10,10);await host.waitForTimeout(700);
 check('visible player name renders as text',await host.locator('.player-name').filter({hasText:'Can <3'}).isVisible());
 await host.evaluate(()=>__game.hud.clearMessage()); if(process.env.QA_OUTPUT) await host.screenshot({path:resolve(process.env.QA_OUTPUT,'online-player-names.png')});
 await guest.evaluate(()=>{__game.player.crouching=true;__game.input.keys.crouch=true;});await host.waitForTimeout(300);
 check('name follows crouched player',await host.locator('.player-name').filter({hasText:'Can <3'}).isVisible());await guest.evaluate(()=>__game.input.keys={});
 await host.evaluate(()=>{const g=__game;window.wall=g.world.addBox({x:-2,y:0,z:14},{x:2,y:5,z:16});g.world.finalize();});
 await host.waitForTimeout(100);check('names hidden behind cover',!await host.locator('.player-name').filter({hasText:'Can <3'}).isVisible());
 await host.evaluate(()=>{__game.world.removeBox(window.wall);});await host.waitForTimeout(100);
 // Real guest packets with inconsistent aim or fabricated impact rays must be rejected.
 const hostId=await host.evaluate(()=>__game.net.id);
 await guest.evaluate(id=>{const g=__game,n=g.net,original=n.handlers.get('combat-result');window.aimRejections=[];n.on('combat-result',(d,from)=>{if(d.id?.startsWith('aim-check-'))aimRejections.push(d.reason);original(d,from);});
  const t=g.remote.get(id),ray=t.center.clone().sub(g.player.eye).normalize();
  const d={target:id,life:t.lifeId,attackerLife:g.player.lifeId,src:'rifle',from:g.player.eye.toArray(),point:t.center.toArray(),part:'torso'};
  n.send('combat-hit',{...d,id:'aim-check-direction',aim:[1,0,0],ray:ray.toArray()});
  n.send('combat-hit',{...d,id:'aim-check-impact',aim:ray.toArray(),ray:ray.clone().add({x:.08,y:0,z:0}).normalize().toArray()});
 },hostId);
 await guest.waitForFunction(()=>window.aimRejections.length===2);
 check('host rejects inconsistent guest aim and off-ray impacts over WebRTC',await guest.evaluate(()=>aimRejections.includes('aim')&&aimRejections.includes('ray'))&&await host.evaluate(()=>__game.player.hp===110));
 // Feedback spy counts actual HUD calls, while the real rendering remains active.
 for(const p of pages)await p.evaluate(()=>{window.hitCalls=[];const h=__game.hud,original=h.hitmarker.bind(h);h.hitmarker=(...args)=>{hitCalls.push(args);original(...args);};});
 await host.evaluate(()=>{const n=__game.net;window.damageHandler=n.handlers.get('combat-hit');n.on('combat-hit',(d,f)=>setTimeout(()=>damageHandler(d,f),350));});
 const shot=async(p,id)=>p.evaluate(id=>{const g=__game,t=g.remote.get(id);g.player.switchTo(6);return g.player.weapon.fireRay(g.player.eye,g.player.forward.copy(t.center.clone().sub(g.player.eye).normalize()));},id);
 const hp=await guest.evaluate(()=>__game.player.hp);
 check('ray hits opponent geometry',await shot(host,guestId));
 check('no speculative X before damage arrives',await host.evaluate(()=>hitCalls.length===0));
 await guest.waitForFunction(hp=>__game.player.hp<hp,hp);await host.waitForFunction(()=>hitCalls.length===1);
 check('X arrives after accepted damage',true);
 await host.evaluate(()=>__game.net.on('combat-hit',damageHandler));
 await host.evaluate(id=>__game.combat.players.get(id).protectedUntil=performance.now()/1000+5,guestId);const protectedHp=await guest.evaluate(()=>__game.player.hp);
 await shot(host,guestId);await host.waitForFunction(()=>document.querySelector('#tip').textContent==='Spawn protected');
 check('protected target loses no health and causes no X',await guest.evaluate(hp=>__game.player.hp===hp,protectedHp)&&await host.evaluate(()=>hitCalls.length===1));
 await host.evaluate(id=>__game.combat.players.get(id).protectedUntil=0,guestId);
 await shot(rival,guestId);await rival.waitForFunction(()=>hitCalls.length===1);check('guest-to-guest hit acknowledgement relays through host',true);
 // Legacy victim-owned damage is rejected even when addressed directly to a peer.
 const packet={id:'legacy-test',amount:999999,src:'rifle',by:'forged'};
 const before=await guest.evaluate(()=>__game.player.hp);await rival.evaluate(({id,d})=>{__game.net.sendTo(id,'pdmg',d);__game.net.sendTo(id,'pdmg',d);},{id:guestId,d:packet});await guest.waitForTimeout(250);
 check('legacy damage packets cannot alter victim health',await guest.evaluate(hp=>__game.player.hp===hp,before));
 // Real countdown and a single actual button click.
 await die(guest,false);check('countdown button is disabled',await guest.locator('#respawnBtn').isDisabled());await ready(guest);
 await guest.mouse.move(100,200);await guest.waitForTimeout(150);check('mouse movement alone does not respawn',await guest.evaluate(()=>!__game.player.alive));
 await guest.locator('#respawnBtn').click();await waitAlive(guest);check('one button click restores life, HUD and menu state',await guest.evaluate(()=>__game.player.hp===__game.player.maxHp&&!document.querySelector('#screen').classList.contains('show')&&document.querySelector('.respawn').hidden));
 await host.waitForFunction(id=>{const r=__game.remote.get(id);return r.alive&&r.root&&r.J.gun.children.length>0;},guestId);check('remote body and gun rebuilt on first living snapshot',true);
 const newHp=await guest.evaluate(()=>__game.player.hp);await host.evaluate(id=>__game.combat.players.get(id).protectedUntil=0,guestId);
 await rival.evaluate(({id,d})=>__game.net.sendTo(id,'pdmg',{...d,id:'old-life'}),{id:guestId,d:packet});await guest.waitForTimeout(250);check('delayed damage from previous life cannot hit respawn',await guest.evaluate(hp=>__game.player.hp===hp,newHp));
 for(const key of ['Space','Enter']) {await die(guest);await ready(guest);await guest.keyboard.press(key);await waitAlive(guest);check(key+' respawns after repeated death',true);}
 await die(guest);await ready(guest);await guest.mouse.click(50,400);await waitAlive(guest);check('unlocked canvas click respawns',true);
 await die(guest,false);await guest.keyboard.press('Escape');await guest.waitForFunction(()=>__game.game.menu);await guest.waitForTimeout(2700);await guest.locator('.go').click();await waitAlive(guest);check('death countdown continues in menu and resume click respawns',true);
 await die(guest);await guest.mouse.down();await ready(guest);await guest.waitForTimeout(200);check('held fire cannot automatically respawn at countdown end',await guest.evaluate(()=>!__game.player.alive));await guest.mouse.up();await guest.mouse.click(60,400);await waitAlive(guest);check('fresh click after held fire respawns',true);
 await die(guest);await ready(guest);await guest.evaluate(()=>{window.dispatchEvent(new Event('blur'));__game.input.usingGamepad=false;__game.input.onLockChange(false);});await guest.locator('#respawnBtn').click();await waitAlive(guest);check('focus/pointer-lock loss recovers with one resume click',true);
 // Gamepad: holding Cross during countdown is not a fresh press.
 await die(guest);await guest.evaluate(()=>{window.padHeld=true;__game.input._getPad=()=>({connected:true,axes:[0,0,0,0],buttons:[{pressed:padHeld,value:padHeld?1:0}]});});await ready(guest);await guest.waitForTimeout(200);
 check('held gamepad Cross does not respawn',await guest.evaluate(()=>!__game.player.alive));
 await guest.evaluate(()=>padHeld=false);await guest.waitForTimeout(80);await guest.evaluate(()=>padHeld=true);await waitAlive(guest);check('fresh gamepad Cross respawns',true);
 await guest.waitForTimeout(150);check('respawn Cross is not reused as a jump',await guest.evaluate(()=>__game.player.body.vel.y<=0));await guest.evaluate(()=>{padHeld=false;delete __game.input._getPad;});
 // Ctrl+C/W/R must not control the player; C remains a normal action.
 await guest.evaluate(()=>{document.activeElement?.blur();__game.input.keys={};for(const code of ['ControlLeft','KeyW','KeyC','KeyR'])window.dispatchEvent(new KeyboardEvent('keydown',{code,ctrlKey:true,bubbles:true,cancelable:true}));});
 await guest.waitForTimeout(100);check('Ctrl shortcuts do not move, crouch or reload',await guest.evaluate(()=>!__game.input.down('forward')&&!__game.input.down('crouch')&&!__game.input.down('reload')));
 await guest.keyboard.down('c');await guest.waitForFunction(()=>__game.input.down('crouch'));check('C still crouches',true);await guest.keyboard.up('c');
 // A scoped death clears the scope immediately; names disappear with the body.
 await guest.evaluate(()=>{__game.player.switchTo(2);__game.input.keys.aim=true;});await guest.waitForFunction(()=>__game.hud._scope);
 await die(guest);check('dying closes the scope',await guest.evaluate(()=>!__game.hud._scope));await host.waitForFunction(id=>!__game.remote.get(id).alive,guestId);
 await host.locator('.player-name').filter({hasText:'Can <3'}).waitFor({state:'hidden'});check('dead player name is hidden',true);await ready(guest);await guest.locator('#respawnBtn').click();await waitAlive(guest);
 // Receiving a lethal online shot while the pause panel is already open.
 await place(host,0,20);await place(guest,0,10);await host.waitForTimeout(400);await guest.keyboard.press('Escape');await guest.waitForFunction(()=>__game.game.menu);
 await host.evaluate(id=>{const g=__game,t=g.remote.get(id);g.player.switchTo(2);g.player.weapon.fireRay(g.player.eye,g.player.forward.copy(t.center.clone().sub(g.player.eye).normalize()));},guestId);
 await guest.waitForFunction(()=>!__game.player.alive);await host.waitForFunction(()=>hitCalls.some(args=>args[0]===true));check('lethal network hit confirms a kill while victim is in menu',true);
 await guest.waitForFunction(()=>__game.game.respawnT===0);await guest.locator('.go').click();await waitAlive(guest);check('one resume click recovers after dying inside menu',true);
 // Reserved browser close shortcuts use the native leave confirmation.
 const leaveDialog=guest.waitForEvent('dialog');await guest.close({runBeforeUnload:true});const dialog=await leaveDialog;
 check('active match asks before closing the tab',dialog.type()==='beforeunload');await dialog.dismiss();check('cancel keeps the player connected',!guest.isClosed()&&await guest.evaluate(()=>__game.net.active));
 // Both scope types, both styles, both palettes, zoom steps.
 for(const map of ['forest','dust2']) {
  await host.evaluate(map=>{__game.lobby.map=map;__game.hostStart();},map);for(const p of pages){await p.waitForFunction(map=>__game.level.key===map&&__game.game.state==='play',map);await free(p);}
  for(const mode of ['solid','notebook'])for(const kind of ['sniper','dmr']) {
   await guest.evaluate(({mode,kind})=>{const g=__game;g.ctx.renderer.setAppearance(mode);g.player.switchTo(g.player.weapons.findIndex(w=>w.kind===kind));g.input.keys.aim=true;}, {mode,kind});
   await guest.waitForFunction(()=>document.querySelector('.scope').classList.contains('on'));
   const gradient=await guest.locator('.scope .mask').evaluate(el=>getComputedStyle(el).backgroundImage);
   check(map+' '+mode+' '+kind+' scope uses matching mask',gradient.includes(mode==='notebook'?'246, 243, 230':map==='dust2'?'196, 173, 134':'174, 188, 179'));
   await guest.keyboard.press('Equal');await guest.keyboard.press('Minus');check(kind+' zoom stays in range',await guest.evaluate(()=>__game.player.weapon.scopeZoom>=2&&__game.player.weapon.scopeZoom<=8));
   if(process.env.QA_OUTPUT&&mode==='solid'&&kind==='sniper') {await guest.evaluate(()=>__game.hud.clearMessage());await guest.waitForTimeout(200);await guest.screenshot({path:resolve(process.env.QA_OUTPUT,'scope-'+map+'-solid.png')});}
   await guest.evaluate(()=>{__game.input.keys={};__game.player.switchTo(0);});await guest.waitForFunction(()=>!document.querySelector('.scope').classList.contains('on'));
  }
 }
 // Host dies to final winning hit: result must not be replaced by a death screen.
 await host.evaluate(id=>{const g=__game;g.scores.get(id).kills=19;const p=g.combat.players.get(g.net.id);p.protectedUntil=0;g.combat.damage(p,150,id,{src:'sniper'});},guestId);
 await host.waitForFunction(()=>__game.game.state==='over');check('host death on winning kill preserves match results',await host.locator('#screen.show').isVisible());
 check('no browser runtime errors: '+errors.join('; '),errors.length===0);
 console.log(count+' multiplayer regression checks passed');
} finally {for(const p of pages)await p.evaluate(()=>__game.net.leave()).catch(()=>{});await browser.close();}
