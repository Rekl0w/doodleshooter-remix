import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href : 'playwright');
const browser = await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined,args:['--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]; page.on('pageerror',e=>errors.push(e.message));
let count=0; const check=(name,pass)=>{assert.ok(pass,name);count++;console.log('PASS '+name);};
const shot=async name=>{if(process.env.MAP_SCREENSHOTS) await page.screenshot({path:resolve(process.env.MAP_SCREENSHOTS,name+'.png')});};
try {
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:8911');await page.waitForFunction(()=>!!window.__game);
 await page.locator('[data-map="forest"]').click();await page.locator('#soloBtn').click();
 await page.evaluate(()=>{__game.game.queue=[];__game.enemies.clear();__game.game.intermission=999;__game.hud.message('','',0);});
 await page.keyboard.press('0');await page.mouse.down({button:'right'});await page.waitForTimeout(1100);
 check('FAMAS has a centered sight above its carrying handle',await page.evaluate(()=>{const p=__game.player,w=p.weapon,v=p.eye.clone();w.sightDot.getWorldPosition(v);v.project(p.camera);return w.kind==='famas'&&Math.abs(v.x)<.015&&Math.abs(v.y)<.015;}));
 check('FAMAS sight picture is unobstructed',await page.evaluate(async()=>{const T=await import('/vendor/three/three.module.js'),p=__game.player,w=p.weapon;const ray=new T.Raycaster(p.eye,p.camera.getWorldDirection(new T.Vector3()),.05,1);return ray.intersectObject(w.root,true).every(h=>h.object===w.sightDot);}));
 await shot('famas-nisan');await page.mouse.up({button:'right'});
 await page.keyboard.press('9');await page.waitForTimeout(700);
 check('9 selects two independently modelled pistols',await page.evaluate(()=>__game.player.weapon.kind==='dual'&&__game.player.weapon.hands.length===2));
 const mag=await page.evaluate(()=>__game.player.weapon.mag);
 await page.mouse.down();await page.mouse.up();await page.waitForTimeout(190);const first=await page.evaluate(()=>__game.player.weapon.lastFiredHand);
 await page.mouse.down();await page.mouse.up();await page.waitForTimeout(80);const second=await page.evaluate(()=>__game.player.weapon.lastFiredHand);
 check('successive clicks alternate hands and consume exactly two rounds',first!==second&&await page.evaluate(m=>__game.player.weapon.mag===m-2,mag));
 await shot('cift-tabanca');await page.keyboard.press('r');await page.waitForFunction(()=>!__game.player.weapon.reloading&&__game.player.weapon.mag===30);
 check('dual-pistol reload fills the shared magazine',true);
 for(const kind of ['sniper','dmr']) {
  await page.evaluate(k=>__game.player.switchTo(__game.player.weapons.findIndex(w=>w.kind===k)),kind);
  await page.mouse.down({button:'right'});await page.waitForTimeout(800);
  check(kind+': scope overlay opens and hides the weapon',await page.evaluate(()=>document.querySelector('#scope').classList.contains('on')&&!__game.player.weapon.root.visible));
  const before=await page.evaluate(()=>__game.player.weapon.scopeZoom);
  await page.mouse.wheel(0,-100);await page.waitForTimeout(120);
  check(kind+': wheel zooms in without changing weapon',await page.evaluate(({kind,before})=>__game.player.weapon.kind===kind&&__game.player.weapon.scopeZoom>before,{kind,before}));
  await page.mouse.wheel(0,100);await page.waitForTimeout(120);
  check(kind+': wheel zooms back out',await page.evaluate(before=>__game.player.weapon.scopeZoom===before,before));
  for(let i=0;i<5;i++){await page.keyboard.press('=');await page.waitForTimeout(30);}
  await page.waitForTimeout(400);
  check(kind+': maximum zoom is bounded and camera matches optics',await page.evaluate(()=>{const w=__game.player.weapon;return w.zoomIndex===w.scopeZooms.length-1&&Math.abs(__game.player.camera.fov-w.adsFov)<1;}));
  await shot(kind+'-durbun');await page.mouse.up({button:'right'});await page.waitForTimeout(250);
  await page.mouse.wheel(0,100);await page.waitForTimeout(120);
  check(kind+': unscoped wheel still changes weapon',await page.evaluate(kind=>__game.player.weapon.kind!==kind,kind));
 }
 const fixtures=await page.evaluate(async()=>{
  const T=await import('/vendor/three/three.module.js'),{World}=await import('/src/physics.js'),{buildLevel}=await import('/src/level.js');const out=[];
  for(const key of ['deepforest','lostwoods']){
   const world=new World(),scene=new T.Scene(),l=buildLevel(scene,world,key);
   out.push([key+': hundreds of trees and physical hiding props',l.assetCounts.trees>400&&l.assetCounts.props>400]);
   let blocked=0,total=0;
   for(const a of l.arenaSpawns)for(const b of l.arenaSpawns){if(a===b)continue;total++;if(!world.hasLineOfSight(a.clone().add(new T.Vector3(0,1.6,0)),b.clone().add(new T.Vector3(0,1.6,0))))blocked++;}
   out.push([key+': most spawn pairs cannot see one another',blocked/total>.8]);
   out.push([key+': geometry is split for view culling',l.meshes.length>30]);
   scene.traverse(m=>{m.geometry?.dispose();m.material?.dispose();});
  }
  return out;
 });for(const [name,pass]of fixtures)check(name,pass);
 await page.keyboard.press('Escape');await page.locator('#menuBtn').click();await page.locator('[data-map="skyline"]').click();await page.locator('#soloBtn').click();
 await page.waitForFunction(()=>__game.level.key==='skyline');
 await page.evaluate(()=>{const g=__game;g.game.queue=[];g.enemies.clear();g.game.intermission=999;g.hud.message('','',0);g.player.yaw=0;g.player.pitch=.35;g.input.mx=g.input.my=0;});
 await page.waitForTimeout(500);await shot('harita-skyline');
 const aimAnchor=async x=>page.evaluate(x=>{
   const g=__game,p=g.player,anchors=g.level.rings.filter(a=>Math.abs(a.x-x)<.01&&a.z===70);
   const target=anchors.sort((a,b)=>b.y-a.y)[0];const d=target.clone().sub(p.eye).normalize();
   p.yaw=Math.atan2(-d.x,-d.z);p.pitch=Math.asin(d.y);g.input.mx=g.input.my=0;return target.toArray();
 },x);
 await aimAnchor(30);await page.waitForTimeout(60);await page.keyboard.down('q');
 await page.waitForFunction(()=>__game.player.grapple.state==='on');await page.waitForTimeout(1400);
 check('city: Q pulls the player from the street up the skyscraper',await page.evaluate(()=>__game.player.body.pos.y>12));
 await shot('sehir-iple-ucus');await page.keyboard.up('q');await page.waitForTimeout(160);
 await aimAnchor(0);await page.waitForTimeout(40);await page.keyboard.down('q');
 await page.waitForFunction(()=>__game.player.grapple.state==='on');
 check('city: a second building can be hooked while airborne',await page.evaluate(()=>!__game.player.body.onGround&&__game.player.grapple.anchor.x===0));
 await page.keyboard.up('q');
 check('no runtime errors',errors.length===0);console.log(count+' expansion checks passed.');
}finally{await browser.close();}
