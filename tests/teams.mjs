import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href:'playwright');
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined,args:['--enable-unsafe-swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const pages=[],errors=[];let count=0;
const check=(name,ok)=>{assert.ok(ok,name);console.log('PASS '+name);count++;};
async function open(name){const p=await browser.newPage({viewport:{width:1400,height:1000}});pages.push(p);p.on('pageerror',e=>errors.push(e.message));await p.goto(process.env.GAME_URL||'http://127.0.0.1:8911');await p.waitForFunction(()=>window.__game);await p.locator('#onlineBtn').click();await p.locator('#setName').fill(name);await p.evaluate(()=>__game.input.usingGamepad=true);return p;}
async function join(p,code){await p.locator('#codeBox').fill(code);await p.locator('#joinBtn').click();await p.waitForFunction(()=>__game.net.active&&__game.lobby.players.size>1);}
async function aliveRound(host,n){await host.waitForFunction(n=>__game.game.round?.round===n,n);await host.evaluate(()=>__game.teamMatch.deadline=performance.now()/1000-.01);for(const p of pages)await p.waitForFunction(n=>__game.game.round?.round===n&&__game.game.round.phase==='live',n);}
async function eliminate(host,ids,killer){await host.evaluate(({ids,killer})=>{for(const id of ids){const p=__game.combat.players.get(id),sameTeam=__game.lobby.players.get(id)?.team===__game.lobby.players.get(killer)?.team; p.protectedUntil=0;__game.combat.damage(p,110,sameTeam?null:killer,{src:'sniper'});}}, {ids,killer});}
try{
 const host=await open('Host');await host.locator('input[value="private"]').check();await host.locator('#createBtn').click();await host.waitForFunction(()=>__game.net.active);const code=await host.evaluate(()=>__game.net.code),hostId=await host.evaluate(()=>__game.net.id);
 await host.locator('#matchMode').selectOption('teams');check('team mode defaults to first 16 rounds',await host.locator('#roundTarget').inputValue()==='16');
 check('team picker offers only enclosed team maps',await host.locator('.mapbtn').evaluateAll(bs=>bs.length===3&&bs.every(b=>['dust2','foundry','quarter'].includes(b.dataset.map))));
 await host.locator('#startBtn').click();check('cannot start an empty opposing team',await host.evaluate(()=>__game.game.state==='lobby'));
 const guest=await open('Blue'),mate=await open('Red');await join(guest,code);await join(mate,code);const guestId=await guest.evaluate(()=>__game.net.id),mateId=await mate.evaluate(()=>__game.net.id);
 await host.waitForFunction(()=>__game.lobby.players.size===3);check('arrivals are balanced red/blue',await host.evaluate(({guestId,mateId})=>__game.lobby.players.get(guestId).team==='blue'&&__game.lobby.players.get(mateId).team==='red',{guestId,mateId}));
 check('guest only controls their own team selector',await guest.locator('[data-team-player]').count()===1&&await guest.locator('#matchMode').count()===0);
 await guest.locator('[data-team-player]').selectOption('red');await host.waitForFunction(id=>__game.lobby.players.get(id).team==='red',guestId);check('player can choose a team',true);
 await host.locator(`[data-team-player="${guestId}"]`).selectOption('blue');await guest.waitForFunction(()=>__game.lobby.players.get(__game.net.id).team==='blue');check('host can arrange every team',true);
 await guest.evaluate(()=>__game.net.broadcast('team-round',{state:{phase:'over',scores:{red:99,blue:0}}}));check('guest cannot forge a round start',await host.evaluate(()=>__game.game.state==='lobby'));
 await host.locator('[data-map="foundry"]').click();for(const p of pages)await p.locator('[name="appearance"][value="solid"]').check();
 if(process.env.QA_OUTPUT)await host.screenshot({path:resolve(process.env.QA_OUTPUT,'team-lobby.png')});
 await host.locator('#roundTarget').fill('2');await host.locator('#startBtn').click();for(const p of pages)await p.waitForFunction(()=>__game.game.matchMode==='teams'&&__game.game.round?.round===1);
 check('start click commits edited round target for all peers',(await Promise.all(pages.map(p=>p.evaluate(()=>__game.game.round.target===2)))).every(Boolean));
 check('spawn freeze prevents damage',await host.evaluate(id=>__game.combat.damage(__game.combat.players.get(id),110,__game.net.id)===0,guestId));
 await aliveRound(host,1);
 check('characters carry actual red/blue materials',await host.evaluate(({guestId,mateId})=>__game.remote.get(guestId).mat.inkId===7&&__game.remote.get(mateId).mat.inkId===6,{guestId,mateId}));
 check('teammates cannot be hit',await host.evaluate(id=>!__game.ctx.canHurt(__game.remote.get(id))&&__game.combat.damage(__game.combat.players.get(id),110,__game.net.id)===0,mateId));
 await guest.evaluate(()=>__game.net.send('team-select',{team:'red'}));await guest.waitForTimeout(120);check('team selection is locked mid-match',await host.evaluate(id=>__game.lobby.players.get(id).team==='blue',guestId));
 await eliminate(host,[mateId],guestId);await mate.waitForFunction(()=>__game.game.state==='dying');check('one teammate dying does not end a round',await host.evaluate(()=>__game.game.round.phase==='live'&&__game.game.round.scores.blue===0));
 await mate.evaluate(()=>{__game.net.send('combat-respawn',{life:__game.player.lifeId});__game.hud.onRespawn();});await mate.waitForTimeout(300);check('dead teammate cannot respawn by UI or forged packet',await mate.evaluate(()=>!__game.player.alive&&__game.game.state==='dying'));
 check('spectator camera has no enemy-view/free-camera control',await mate.evaluate(()=>!__game.player.rig.visible));
 const late=await open('LateBlue');await join(late,code);const lateId=await late.evaluate(()=>__game.net.id);await late.waitForFunction(()=>__game.game.matchMode==='teams'&&__game.game.state==='dying');check('late arrival waits until next round',await late.evaluate(()=>!__game.player.alive&&__game.game.round.round===1));
 await eliminate(host,[hostId],guestId);for(const p of pages)await p.waitForFunction(()=>__game.game.round.phase==='intermission'&&__game.game.round.scores.blue===1);
 check('team elimination awards the same round score to all peers',true);
 await host.evaluate(()=>__game.teamMatch.deadline=performance.now()/1000-.01);await aliveRound(host,2);
 check('everyone, including late arrivals, starts next round alive and resupplied',(await Promise.all(pages.map(p=>p.evaluate(()=>__game.player.alive&&__game.player.hp===110&&__game.player.grenades===3&&__game.player.weapon.mag===__game.player.weapon.magSize)))).every(Boolean));
 check('round two swaps sides for a first-to-two match',await host.evaluate(()=>__game.game.round.swapped&&__game.player.body.pos.z>0));
 await eliminate(host,[guestId,lateId],hostId);await host.waitForFunction(()=>__game.game.round.scores.red===1&&__game.game.round.phase==='intermission');await host.evaluate(()=>__game.teamMatch.deadline=performance.now()/1000-.01);await aliveRound(host,3);
 await eliminate(host,[guestId,lateId],hostId);for(const p of pages)await p.waitForFunction(()=>__game.game.state==='over');check('selected team target ends the whole match',await host.evaluate(()=>__game.game.over.team==='red'&&__game.game.round.scores.red===2));
 await host.locator('#overGo').click();for(const p of pages)await p.waitForFunction(()=>__game.game.state==='lobby');
 check('return to lobby preserves teams and target',await host.locator('#roundTarget').inputValue()==='2'&&await guest.locator('[data-team-player]').inputValue()==='blue');
 for(const map of ['dust2','quarter']){
  await host.locator(`[data-map="${map}"]`).click();await host.locator('#startBtn').click();await aliveRound(host,1);check(map+' starts teams at clear spawn positions',await host.evaluate(()=>[...__game.combat.players.values()].every(p=>!__game.world.overlapsBody({pos:{x:p.pos[0],y:p.pos[1]+.05,z:p.pos[2]},halfW:.35,height:1.75}))));
  if(process.env.QA_OUTPUT)await host.screenshot({path:resolve(process.env.QA_OUTPUT,map+'-teams-solid.png')});
  // End this test match through the same host-owned elimination path.
  await host.evaluate(()=>__game.teamMatch.scores.red=1);await eliminate(host,[guestId,lateId],hostId);await host.waitForFunction(()=>__game.game.state==='over');await host.locator('#overGo').click();for(const p of pages)await p.waitForFunction(()=>__game.game.state==='lobby');
 }
 await host.locator('#matchMode').selectOption('ffa');check('switching back restores all maps and kill target',await host.locator('.mapbtn').count()===13&&await host.locator('#killTarget').count()===1);
 check('no JavaScript errors: '+errors.join('; '),errors.length===0);console.log(count+' online team checks passed');
}finally{for(const p of pages)await p.evaluate(()=>__game.net.leave()).catch(()=>{});await browser.close();}
