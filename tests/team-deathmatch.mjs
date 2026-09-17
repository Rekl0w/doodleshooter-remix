import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href:'playwright');
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined,args:['--enable-unsafe-swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const pages=[],errors=[];let count=0;
const check=(name,ok)=>{assert.ok(ok,name);console.log('PASS '+name);count++;};
async function open(name,tr=false){const p=await browser.newPage({viewport:{width:1400,height:1000}});pages.push(p);p.on('pageerror',e=>errors.push(e.message));await p.goto(process.env.GAME_URL||'http://127.0.0.1:8911');await p.waitForFunction(()=>window.__game);if(tr){await p.locator('#setLanguage').selectOption('tr');await p.waitForFunction(()=>window.__game&&document.documentElement.lang==='tr');}await p.locator('#onlineBtn').click();await p.locator('#setName').fill(name);await p.evaluate(()=>__game.input.usingGamepad=true);return p;}
async function join(p,code){await p.locator('#codeBox').fill(code);await p.locator('#joinBtn').click();await p.waitForFunction(()=>__game.net.active&&__game.lobby.players.size>1);}
async function kill(host,id,killer){await host.evaluate(({id,killer})=>{const p=__game.combat.players.get(id);p.protectedUntil=0;__game.combat.damage(p,110,killer,{src:'sniper'});},{id,killer});}
try{
 const host=await open('Host',true);await host.locator('input[value="private"]').check();await host.locator('#createBtn').click();await host.waitForFunction(()=>__game.net.active);await host.locator('#matchMode').selectOption('tdm');const code=await host.evaluate(()=>__game.net.code),hostId=await host.evaluate(()=>__game.net.id);
 check('Turkish host can select Team Deathmatch',await host.locator('#panel h2').innerText().then(t=>t.includes('Takımlı Ölüm Maçı')));
 check('TDM supports all maps and a kill target',await host.locator('.mapbtn').count()===13&&await host.locator('#killTarget').count()===1&&await host.locator('#roundTarget').count()===0);
 const enemy=await open('Blue'),ally=await open('Red');await join(enemy,code);await join(ally,code);const enemyId=await enemy.evaluate(()=>__game.net.id),allyId=await ally.evaluate(()=>__game.net.id);
 await host.locator('[data-map="skyline"]').click();for(const p of pages)await p.locator('[name="appearance"][value="solid"]').check();await host.locator('#killTarget').fill('3');await host.locator('#startBtn').click();for(const p of pages)await p.waitForFunction(()=>__game.game.matchMode==='tdm'&&__game.player.alive);
 check('TDM starts on Skyline with selected team score target',await enemy.evaluate(()=>__game.level.key==='skyline'&&__game.game.killTarget===3&&__game.game.round===null));
 const roofs=await host.evaluate(()=>{const g=__game,L=g.level;return {n:L.roofSpawns.length,total:L.arenaSpawns.length,safe:L.roofSpawns.every(pos=>!g.world.overlapsBody({pos,halfW:.45,height:2})&&!!g.world.raycast(pos.clone().add({x:0,y:.1,z:0}),{x:0,y:-1,z:0},.25)),unique:new Set(L.arenaSpawns.map(p=>p.toArray().join(','))).size};});
 check('24 safe rooftop spawns supplement 10 street spawns',roofs.n===24&&roofs.total===34&&roofs.safe&&roofs.unique===34);
 await host.evaluate(()=>{for(const p of __game.combat.players.values())p.protectedUntil=0;});
 check('friendly damage is disabled in TDM',await host.evaluate(id=>__game.combat.damage(__game.combat.players.get(id),110,__game.net.id)===0,allyId));
 await kill(host,enemyId,hostId);for(const p of pages)await p.waitForFunction(()=>__game.game.teamScores.red===1);check('kill contributes to the team total on every peer',true);
 const life=await enemy.evaluate(()=>__game.player.lifeId);await enemy.waitForFunction(()=>__game.game.respawnT===0);await enemy.evaluate(()=>__game.hud.onRespawn());await enemy.waitForFunction(life=>__game.player.alive&&__game.player.lifeId!==life,life);check('TDM player respawns during the same match',await host.evaluate(()=>!__game.game.over&&__game.game.teamScores.red===1));
 // Exercise the actual host respawn path with all opponents at street level.
 await host.evaluate(({enemyId,allyId})=>{const g=__game;for(const id of [g.net.id,allyId]){const p=g.combat.players.get(id);p.pos=[15,0,80];p.lastSnap=performance.now()/1000;}
  const p=g.combat.players.get(enemyId);p.hp=0;p.deadAt=performance.now()/1000-3;g.net._emit('combat-respawn',{life:p.life},enemyId);
 },{enemyId,allyId});
 await enemy.waitForFunction(()=>__game.player.body.pos.y>20);check('host respawn can actually place a player on a rooftop',true);
 await enemy.waitForTimeout(120);check('rooftop respawn faces into the city',await enemy.evaluate(()=>{const p=__game.player,b=p.body.pos;return p.forward.dot(b.clone().setY(0).negate().normalize())>.9;}));
 if(process.env.QA_OUTPUT){await enemy.waitForTimeout(150);await enemy.screenshot({path:resolve(process.env.QA_OUTPUT,'skyline-rooftop-tdm.png')});}
 const late=await open('Late');await join(late,code);const lateId=await late.evaluate(()=>__game.net.id);await late.waitForFunction(()=>__game.game.matchMode==='tdm'&&__game.player.alive&&__game.game.teamScores.red===1);check('late TDM join enters alive and inherits existing team score',true);
 await ally.evaluate(()=>__game.net.broadcast('team-state',{mode:'tdm',scores:{red:999,blue:0}}));await host.waitForTimeout(150);check('guest cannot forge team totals',await host.evaluate(()=>__game.game.teamScores.red===1&&!__game.game.over));
 await kill(host,lateId,allyId);for(const p of pages)await p.waitForFunction(()=>__game.game.teamScores.red===2);check('different teammate kills add to the same team total',true);
 await ally.evaluate(()=>__game.net.leave());await host.waitForFunction(id=>!__game.lobby.players.has(id),allyId);check('departing scorer does not remove their team points',await host.evaluate(()=>__game.game.teamScores.red===2));
 await kill(host,enemyId,hostId);for(const p of [host,enemy,late])await p.waitForFunction(()=>__game.game.state==='over');check('team wins at custom total even when no individual has reached it',await host.evaluate(()=>__game.game.over.team==='red'&&__game.scores.get(__game.net.id).kills===2&&__game.game.teamScores.red===3));
 check('no JavaScript errors: '+errors.join('; '),errors.length===0);console.log(count+' Team Deathmatch checks passed');
}finally{for(const p of pages)await p.evaluate(()=>__game.net.leave()).catch(()=>{});await browser.close();}
