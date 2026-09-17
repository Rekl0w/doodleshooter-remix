import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href:'playwright');
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined,args:['--enable-unsafe-swiftshader','--disable-background-timer-throttling','--disable-renderer-backgrounding']});
const pages=[],errors=[];let count=0;
const check=(name,value)=>{assert.ok(value,name);console.log('PASS '+name);count++;};
async function open(name,tr=false){const p=await browser.newPage({viewport:{width:1280,height:960}});pages.push(p);p.on('pageerror',e=>errors.push(e.message));await p.goto(process.env.GAME_URL||'http://127.0.0.1:8911');await p.waitForFunction(()=>window.__game);if(tr){await p.locator('#setLanguage').selectOption('tr');await p.waitForFunction(()=>document.documentElement.lang==='tr'&&window.__game);}await p.locator('[data-map="forest"]').click();await p.locator('#onlineBtn').click();await p.locator('#setName').fill(name);return p;}
async function free(p){await p.evaluate(()=>{__game.input.usingGamepad=true;__game.game.menu=false;__game.hud.hideScreen();});}
async function join(p,code,state='lobby'){await p.locator('#codeBox').fill(code);await p.locator('#joinBtn').click();await p.waitForFunction(state=>__game.game.state===state,state);}
try{
 const host=await open('Host',true);await host.locator('input[value="private"]').check();await host.locator('#createBtn').click();await host.waitForFunction(()=>__game.net.active);const code=await host.evaluate(()=>__game.net.code);
 const guest=await open('Guest');await join(guest,code);const guestId=await guest.evaluate(()=>__game.net.id);
 check('Turkish host has a labeled target input defaulting to 20',await host.getByLabel('Öldürme hedefi').inputValue()==='20');
 check('guest cannot edit match target',await guest.locator('#killTarget').count()===0);
 for(const invalid of ['0','-1','1000','1.5','']){await host.locator('#killTarget').fill(invalid);await host.locator('#killTarget').press('Tab');check('invalid target restored: '+JSON.stringify(invalid),await host.locator('#killTarget').inputValue()==='20'&&await host.evaluate(()=>__game.lobby.killTarget===20));}
 await host.locator('#killTarget').fill('999');await host.locator('#killTarget').press('Tab');await guest.waitForFunction(()=>__game.lobby.killTarget===999);check('upper target boundary broadcasts to guest',await guest.locator('#panel h2').innerText().then(s=>s.includes('999 kills')));
 await host.locator('#killTarget').fill('50');await host.locator('#killTarget').press('Tab');await guest.waitForFunction(()=>__game.lobby.killTarget===50);check('both lobby headings use selected target',await host.locator('#panel h2').innerText().then(s=>s.includes('50 öldürme'))&&await guest.locator('#panel h2').innerText().then(s=>s.includes('50 kills')));
 await guest.evaluate(()=>__game.net.broadcast('lobby',{killTarget:1}));await host.waitForTimeout(100);check('guest cannot override host target by packet',await host.evaluate(()=>__game.lobby.killTarget===50));
 if(process.env.QA_OUTPUT)await host.screenshot({path:resolve(process.env.QA_OUTPUT,'custom-kill-target.png')});
 // Type a different value and click Start without blurring first: the same click must start.
 await host.locator('#killTarget').fill('51');await host.locator('#killTarget').fill('50');await host.locator('#startBtn').click();for(const p of pages){await p.waitForFunction(()=>__game.game.state==='play'&&__game.game.killTarget===50);await free(p);}check('one click after editing starts the selected target on both clients',true);
 const late=await open('Late');await join(late,code,'play');await free(late);check('late join inherits current match target',await late.evaluate(()=>__game.game.killTarget===50));
 check('HUD uses selected target',await guest.locator('.target').innerText().then(s=>s.includes('50')));
 await host.evaluate(id=>{const g=__game,v=g.combat.players.get(id);g.scores.get(g.net.id).kills=19;v.protectedUntil=0;g.combat.damage(v,999,g.net.id,{src:'sniper'});},guestId);
 await guest.waitForFunction(()=>__game.game.state==='dying');check('20 kills no longer ends a 50-kill match',await host.evaluate(()=>__game.scores.get(__game.net.id).kills===20&&__game.game.state==='play'&&!__game.game.over));
 await host.keyboard.press('Escape');await host.waitForFunction(()=>__game.game.menu);check('target cannot be edited mid-match',await host.locator('#killTarget').count()===0);await free(host);
 await host.evaluate(id=>{const g=__game,c=g.combat;const v=c.players.get(id);v.deadAt=performance.now()/1000-3;g.net._emit('combat-respawn',{life:v.life},id);const spawned=c.players.get(id);spawned.protectedUntil=0;g.scores.get(g.net.id).kills=49;c.damage(spawned,999,g.net.id,{src:'sniper'});},guestId);
 for(const p of pages)await p.waitForFunction(()=>__game.game.state==='over');check('selected 50th kill ends match for everyone',true);
 await host.locator('#overGo').click();for(const p of pages)await p.waitForFunction(()=>__game.game.state==='lobby');check('selected target persists for next round',await host.locator('#killTarget').inputValue()==='50');
 await host.locator('#killTarget').fill('1');await host.locator('#startBtn').click();for(const p of pages){await p.waitForFunction(()=>__game.game.state==='play'&&__game.game.killTarget===1);await free(p);}
 await host.evaluate(id=>{const g=__game,v=g.combat.players.get(id);v.protectedUntil=0;g.combat.damage(v,999,g.net.id,{src:'sniper'});},guestId);for(const p of pages)await p.waitForFunction(()=>__game.game.state==='over');check('minimum target ends on first kill',true);
 check('no JavaScript runtime errors: '+errors.join('; '),errors.length===0);console.log(count+' custom match target checks passed');
}finally{for(const p of pages)await p.evaluate(()=>__game.net.leave()).catch(()=>{});await browser.close();}
