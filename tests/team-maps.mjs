import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(resolve(process.env.PLAYWRIGHT_MODULE)).href:'playwright');
const b=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined,args:['--enable-unsafe-swiftshader']});
try{
 const p=await b.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));await p.goto(process.env.GAME_URL||'http://127.0.0.1:8911');await p.waitForFunction(()=>window.__game);
 const results=await p.evaluate(async()=>{
  const THREE=await import('three'),{World,makeBody}=await import('/src/physics.js'),{buildLevel}=await import('/src/level.js'),{NavGrid}=await import('/src/nav.js');
  const out=[],check=(name,pass)=>out.push({name,pass});
  for(const key of ['foundry','quarter','dust2']){
   const world=new World(),scene=new THREE.Scene(),L=buildLevel(scene,world,key,{arena:true}),nav=new NavGrid(world,L.bounds,L.navCell||1).build();
   const a=L.teamSpawns[0],b=L.teamSpawns[1],up=new THREE.Vector3(0,1.6,0);
   check(key+': 26 unique spawn positions',L.teamSpawns.every(t=>t.length===13)&&new Set([...a,...b].map(p=>p.toArray().join(','))).size===26);
   check(key+': every spawn has body clearance and solid floor',[...a,...b].every(pos=>!world.overlapsBody(makeBody(pos,.45,2))&&world.raycast(pos.clone().add(new THREE.Vector3(0,.1,0)),new THREE.Vector3(0,-1,0),.25)));
   check(key+': every spawn connects to the opposite team',[...a,...b].every(pos=>nav.findPath(pos,a[0])?.complete&&nav.findPath(pos,b[0])?.complete));
   check(key+': no direct sightline between any opposing spawns',a.every(x=>b.every(y=>!world.hasLineOfSight(x.clone().add(up),y.clone().add(up)))));
   if(key!=='dust2'){
    const routes=[new THREE.Vector3(-32,0,0),new THREE.Vector3(key==='quarter'?9:0,0,0),new THREE.Vector3(32,0,0)];
    check(key+': left, middle and right routes all connect both teams',routes.every(pos=>nav.findPath(a[0],pos)?.complete&&nav.findPath(pos,b[0])?.complete));
    check(key+': resupply and sniper points are usable',L.pickups.length>0&&L.snipers.length>0&&[...L.pickups,...L.snipers].every(pos=>!world.overlapsBody(makeBody(pos,.45,2))&&nav.findPath(a[0],pos)?.complete));
    check(key+': all four high outer boundaries stop grapple escapes',[[0,-44,0,-1],[0,44,0,1],[-44,0,-1,0],[44,0,1,0]].every(([x,z,dx,dz])=>world.raycast(new THREE.Vector3(x,35,z),new THREE.Vector3(dx,0,dz),10)?.box.data.noGrapple));
   }
   scene.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
  }
  return out;
 });
 for(const r of results){assert.ok(r.pass,r.name);console.log('PASS '+r.name);}assert.deepEqual(errors,[]);console.log(results.length+' team map checks passed');
}finally{await b.close();}
