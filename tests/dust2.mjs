import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href:'playwright');
const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined,args:['--enable-unsafe-swiftshader']});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.GAME_URL||'http://127.0.0.1:8911');await page.waitForFunction(()=>!!window.__game);
 await page.locator('[data-map="dust2"]').click();await page.locator('#soloBtn').click();
 const results=await page.evaluate(async()=>{
  const T=await import('/vendor/three/three.module.js'),{makeBody}=await import('/src/physics.js'),{dustHeight}=await import('/src/dust2.js');
  const G=__game,W=G.world,out=[];G.game.state='pause';G.enemies.clear();
  const routes={
   'T spawn through upper tunnels to B':[[558,649],[500,649],[370,625],[365,560],[375,480],[408,455],[414,408],[414,371],[409,340],[383,330],[358,320],[358,275],[358,238],[358,200],[401,175]],
   'Upper stairs through lower tunnel and mid doors':[[390,330],[449,333],[477,333],[502,320],[520,282],[568,282],[610,289],[610,240]],
   'Mid via catwalk and short stairs to A':[[610,430],[642,451],[647,418],[647,360],[647,289],[696,286],[735,286],[736,240],[736,186],[736,118],[769,118],[792,118]],
   'Outside long through both doors and long ramp to A':[[727,535],[776,517],[774,478],[769,444],[769,424],[769,410],[779,384],[839,366],[899,354],[900,275],[900,230],[900,181],[900,142],[896,115]],
   'Pit exit without jumping':[[904,448],[940,448],[945,430],[945,400],[924,376],[900,354]],
   'B doors to CT spawn':[[441,179],[446,161],[470,161],[496,161],[541,161],[585,168],[680,169]],
   'CT rotation underneath short bridge':[[690,170],[735,170]],
   'CT center is unobstructed after removing the added A ramp':[[785,180],[811,180],[850,180]],
  };
  for(const[name,points]of Object.entries(routes)){
   const [x,z]=points[0],body=makeBody(new T.Vector3((x-640)*.18,Math.round(dustHeight(x,z)/.12)*.12,(z-360)*.18),.35,1.75,.55);body.onGround=true;let failure=null;
   for(const[x,z]of points.slice(1)){
    const tx=(x-640)*.18,tz=(z-360)*.18,seconds=Math.hypot(tx-body.pos.x,tz-body.pos.z)/4.5+3;let reached=false;
    for(let t=0;t<seconds;t+=1/120){const dx=tx-body.pos.x,dz=tz-body.pos.z,d=Math.hypot(dx,dz);if(d<.15){reached=true;break;}body.vel.x=dx/d*4.5;body.vel.z=dz/d*4.5;body.vel.y-=26/120;W.moveBody(body,1/120);}
    if(!reached){failure={target:[x,z],body:body.pos.toArray(),ref:[body.pos.x/.18+640,body.pos.z/.18+360]};break;}
   }
   out.push({name,pass:!failure,detail:failure});
   if(name==='CT rotation underneath short bridge')out.push({name:'CT remains below the elevated short walkway',pass:body.pos.y<.2,detail:body.pos.y});
  }
  for(const [name,x,z,dx,dz]of [['B west',350,100,-1,0],['B north',350,100,0,-1],['A east',890,100,1,0],['A north',890,100,0,-1],['Long east',900,365,1,0],['T south',500,650,0,1],['T road south',675,660,0,1]]) {
   const failures=[];
   for(const y of [12,40,67]) {
    const start=new T.Vector3((x-640)*.18,y,(z-360)*.18),dir=new T.Vector3(dx,0,dz),hit=W.raycast(start,dir,150);
    const body=makeBody(start,.35,1.75,.55);
    for(let i=0;i<240;i++){body.vel.set(dx*70,0,dz*70);W.moveBody(body,1/120);}
    const travel=body.pos.clone().sub(start).dot(dir);
    if(!hit||hit.box.data.tag!=='dust-boundary'||!hit.box.data.noGrapple||travel>hit.dist||travel<hit.dist-1)failures.push({y,travel,hit:hit?.dist});
    body.vel.set(0,0,0);
    for(let i=0;i<480;i++){body.vel.y-=26/120;W.moveBody(body,1/120);}
    if(!body.onGround||body.pos.y< -2)failures.push({y,landing:body.pos.toArray()});
   }
   out.push({name:name+' blocks fast aerial escape and lands safely at three heights',pass:!failures.length,detail:failures});
  }
  out.push({name:'Dust palette enabled',pass:G.ctx.renderer.post.uniforms.uDesert.value===1});
  out.push({name:'Mid and long are separated by solid buildings',pass:!W.hasLineOfSight(new T.Vector3(-5,2,0),new T.Vector3(47,2,0))});
  const c=G.level.callouts;
  out.push({name:'A is northeast and B northwest of T spawn',pass:c.aSite.x>c.tSpawn.x&&c.bSite.x<c.tSpawn.x&&c.aSite.z<c.tSpawn.z&&c.bSite.z<c.tSpawn.z});
  out.push({name:'Pit is below long and A is above CT',pass:c.pit.y<c.long.y&&c.aSite.y>c.ctSpawn.y+3});
  return out;
 });
 for(const r of results){console.log((r.pass?'PASS ':'FAIL ')+r.name+(r.pass?'':' '+JSON.stringify(r.detail)));}
 assert.ok(results.every(r=>r.pass),'Dust traversal checks');
 await page.evaluate(()=>__game.game.state='play');await page.keyboard.press('Escape');await page.locator('#menuBtn').click();await page.locator('[data-map="forest"]').click();await page.locator('#soloBtn').click();
 assert.equal(await page.evaluate(()=>__game.ctx.renderer.post.uniforms.uDesert.value),0);console.log('PASS normal ink rendering restored on forest');
 assert.deepEqual(errors,[]);console.log('PASS no runtime errors');console.log(`${results.length+2} Dust II checks passed.`);
}finally{await browser.close();}
