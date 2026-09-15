import * as THREE from 'three';
import { INK } from './render.js';

// Manually traced playable outline, including the five enclosed building islands.
// Reference: https://cs2caller.com/radars/dust2.png (CS2 radar).
// Coordinates stay in the reference plane so landmarks can be compared directly.
export const DUST_OUTLINE = [[334,11],[375,11],[375,55],[433,55],[461,70],[461,82],[506,82],[506,104],[624,104],[624,147],[665,147],[682,131],[682,108],[714,108],[714,72],[836,72],[836,25],[930,25],[930,72],[936,72],[936,150],[960,150],[965,223],[949,234],[931,269],[931,322],[960,351],[962,471],[930,471],[930,491],[876,491],[876,484],[824,484],[824,417],[811,398],[800,394],[784,400],[797,414],[797,474],[799,580],[738,580],[738,618],[749,618],[749,679],[707,679],[707,707],[624,707],[624,689],[386,689],[386,685],[319,685],[319,620],[343,593],[344,420],[367,418],[367,404],[399,404],[399,354],[326,354],[326,291],[347,291],[347,232],[326,232],[326,193],[322,193],[322,149],[328,149],[328,129],[334,129]];
export const DUST_ISLANDS = [
 [[370,232],[400,232],[400,261],[423,261],[457,221],[468,188],[579,190],[579,253],[592,258],[592,271],[479,271],[479,292],[467,312],[411,312],[411,291],[370,291]],
 [[625,201],[674,201],[713,183],[713,240],[715,269],[658,269],[654,261],[636,261],[636,269],[625,269]],
 [[431,354],[475,354],[497,344],[512,327],[512,308],[587,308],[587,403],[573,403],[573,433],[556,438],[563,484],[592,487],[592,618],[524,618],[524,542],[490,542],[490,556],[461,556],[449,542],[448,516],[477,499],[468,420],[431,417]],
 [[624,473],[679,473],[694,487],[694,578],[684,591],[636,590],[617,575],[617,490]],
 [[660,307],[745,307],[757,298],[757,191],[817,191],[817,197],[873,197],[873,320],[795,320],[752,332],[752,393],[759,399],[754,440],[666,440],[654,429],[654,317]],
];
const S=.18, X=x=>(x-640)*S, Z=z=>(z-360)*S;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
function inside(x,z,poly) { let hit=false; for(let i=0,j=poly.length-1;i<poly.length;j=i++) {const a=poly[i],b=poly[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit; }
const region=(x,z)=>!inside(x,z,DUST_OUTLINE)?2:DUST_ISLANDS.some(p=>inside(x,z,p))?1:0;
export function dustHeight(x,z) {
  // CT can rotate under short; its bridge is built separately above the ground.
  if(x>=715&&x<=759&&z>=108&&z<=190) return 0;
  if(x>=715&&z<151) return 3.6;
  if(x>=876&&z>=151&&z<230) return 3.6*clamp((224-z)/73,0,1);
  if(x>=713&&x<759&&z>=190&&z<=298) return 1.8+1.8*clamp((286-z)/40,0,1);
  if(x>=633&&x<757&&z>=269&&z<310) return 1.8;
  if(x>=632&&x<660&&z>=310&&z<438) return 1.8;
  if(x>=876&&x<=930&&z>=395) return -1.8;
  if(x>930&&z>=395) return -1.8*clamp((z-395)/70,0,1);
  if(x<468&&z<420) return 1.5;
  if(x>=468&&x<513&&z>=308&&z<=354) return 1.5*clamp((513-x)/45,0,1);
  if(x>=468&&x<494&&z<190) return 1.5*clamp((494-x)/26,0,1);
  if(x<524&&z>=540) return 2.4*clamp((z-540)/78,0,1);
  if(z>=618&&x<624) return 2.4;
  if(x>=624&&z>=618) return 2.4*clamp((700-x)/76,0,1);
  if(x<432&&z>=404&&z<450) return 1.5*clamp((450-z)/30,0,1);
  if(x>=585&&x<633&&z>=300&&z<474) return 1.8*clamp((z-300)/138,0,1);
  if(z>=438&&z<474&&x>=633&&x<754) return 1.8;
  if(x>=695&&x<800&&z>=474&&z<580) return 1.8*clamp((504-z)/30,0,1);
  return 0;
}

export function buildDust(B,H) {
  const L=B.L;L.key='dust2';L.bounds={minX:-66,maxX:62,minZ:-65,maxZ:65};L.navCell=.72;L.chunkSize=24;L.skyHeight=23;L.skyScale=1.1;
  L.spawns=[];L.arenaSpawns=[];L.snipers=[];L.pickups=[];
  const sand={ink:INK.ORANGE}, stone={ink:INK.BLUE}, wood={ink:INK.BLACK};
  const box=(x,y,z,w,h,d,o=sand)=>B.box(X(x),y,Z(z),w*S,h,d*S,o);
  const surface=(x1,z1,x2,z2,y,o=sand)=>box((x1+x2)/2,y-.2,(z1+z2)/2,x2-x1,.2,z2-z1,o);
  const wallX=(x1,x2,z,h,gaps=[],o=sand)=>B.wallX(X(x1),X(x2),Z(z),0,h,.45,gaps.map(([a,b,y=0,t=h])=>[X(a),X(b),y,t]),o);
  const wallZ=(z1,z2,x,h,gaps=[],o=sand)=>B.wallZ(Z(z1),Z(z2),X(x),0,h,.45,gaps.map(([a,b,y=0,t=h])=>[Z(a),Z(b),y,t]),o);
  // Coalesce equal surface heights into rectangles. 36 cm cells keep diagonal
  // collision boundaries close to the vector facade without thousands of bodies.
  const active=new Map(), cell=2;
  const flush=r=>{
    const [x,z,w,d,h,type]=r,solid=type===1||type===2;
    B.collider(X(x+w/2),-3,Z(z+d/2),w*S,h+3,d*S,{tag:solid?'dust-building':'dust-floor',noNav:solid});
    if(type===0)box(x+w/2,-3,z+d/2,w,h+3,d,{ink:INK.PINK,noCollide:true});
    // The outer silhouette continues invisibly up to the ceiling. Inner roofs
    // remain usable, but grappling over exterior roofs cannot reach the void.
    if(type===2)B.collider(X(x+w/2),9,Z(z+d/2),w*S,64,d*S,{tag:'dust-boundary',noNav:true,noGrapple:true,noShoot:true});
  };
  for(let z=0;z<720;z+=cell) {
    const next=new Map();
    for(let x=300;x<984;) {
      const type=region(x+1,z+1),open=type===0,h=open?Math.round(dustHeight(x+1,z+1)/.12)*.12:9;
      let end=x+cell;
      while(end<984&&region(end+1,z+1)===type&&(!open||Math.round(dustHeight(end+1,z+1)/.12)*.12===h))end+=cell;
      const k=`${x}:${end}:${h}:${type}`;const prev=active.get(k);
      if(prev){prev[3]+=cell;next.set(k,prev);active.delete(k);}else next.set(k,[x,z,end-x,cell,h,type]);
      x=end;
    }
    for(const r of active.values())flush(r);active.clear();for(const [k,r] of next)active.set(k,r);
  }
  for(const r of active.values())flush(r);
  // Solid building mass, with a hole exactly matching the traced lanes.
  const path=points=>new THREE.Path(points.map(([x,z])=>new THREE.Vector2(X(x),-Z(z))));
  const mass=new THREE.Shape([new THREE.Vector2(X(300),-Z(0)),new THREE.Vector2(X(984),-Z(0)),new THREE.Vector2(X(984),-Z(720)),new THREE.Vector2(X(300),-Z(720))]);mass.holes.push(path(DUST_OUTLINE));
  const roof=shape=>{const g=new THREE.ShapeGeometry(shape);g.rotateX(-Math.PI/2);g.translate(0,9,0);B.addGeo(g,INK.ORANGE);};roof(mass);
  for(const poly of DUST_ISLANDS)roof(new THREE.Shape(poly.map(([x,z])=>new THREE.Vector2(X(x),-Z(z)))));
  // A small stone plinth, roof caps, inset windows and plaster courses follow the
  // actual facade edges, including angled corners, rather than a square arena.
  for(const poly of [DUST_OUTLINE,...DUST_ISLANDS]) for(let i=0;i<poly.length;i++) {
    const a=poly[i],b=poly[(i+1)%poly.length],len=Math.hypot(b[0]-a[0],b[1]-a[1])*S;
    const beam=(y,h,t,ink)=>{const g=new THREE.BoxGeometry(len,h,t);g.rotateY(-Math.atan2(b[1]-a[1],b[0]-a[0]));g.translate(X((a[0]+b[0])/2),y+h/2,Z((a[1]+b[1])/2));B.addGeo(g,ink);};
    beam(0,9,.12,INK.ORANGE);beam(0,.65,.24,INK.BLUE);beam(8.65,.35,.36,INK.BLUE);beam(5.8,.1,.24,INK.BLUE);
    if(len>5)for(let j=2;j<len-1;j+=3.3) {
      const t=j/len,x=a[0]+(b[0]-a[0])*t,z=a[1]+(b[1]-a[1])*t;
      const g=new THREE.BoxGeometry(.9,1.35,.28);g.rotateY(-Math.atan2(b[1]-a[1],b[0]-a[0]));g.translate(X(x),6.95,Z(z));B.addGeo(g,INK.BLACK);
    }
  }
  // T-side suicide is separated from the direct spawn view, as in modern Dust 2.
  wallX(523,616,615,4.2);box(609,0,590,8,3.8,44,stone);
  // Raised catwalk edge and short bridge over CT spawn.
  wallZ(310,400,633,2.1,[],stone);
  surface(715,108,759,190,3.6,stone);
  // Separate lower tunnels from B and upper tunnels. Open ceiling slots admit light.
  box(402,6.7,323,150,.5,62,sand);box(358,6.7,260,29,.5,70,sand);
  box(539,4.6,289,111,.35,37,sand);
  for(const z of [244,282,308,343])box(z<300?358:394,5.9,z,z<300?28:116,.3,3,stone);
  for(const x of [347,408,461])box(x,1.5,325,5,5.2,5,stone);
  // Double door frames: two open leaves retain cover while leaving a clear passage.
  const doorX=(x,z,y,width=24)=>{for(const side of [-1,1]){box(x+side*(width/2-3),y,z+side*4,6,3.35,12,wood);for(const dy of [.45,2.65])box(x+side*(width/2-3),y+dy,z+side*4,6.3,.13,12.3,stone);}};
  const doorZ=(x,z,y,width=26)=>{for(const side of [-1,1]){box(x+side*4,y,z+side*(width/2-3),12,3.35,6,wood);for(const dy of [.45,2.65])box(x+side*4,y+dy,z+side*(width/2-3),12.3,.13,6.3,stone);}};
  wallX(589,636,263,6.4,[[598,626,0,3.8]]);doorX(612,263,0,28);
  wallZ(82,190,464,8,[[145,177,0,4.9],[97,116,3,5.7]]);doorZ(464,161,1.5,32);
  // Long doors are a bent, roofed passage with two distinct entrances.
  wallX(753,799,466,6.4,[[760,791,0,4.8]]);doorX(775,466,.25,31);
  wallX(754,801,396,6.4,[[763,794,0,4.8]]);doorX(779,396,0,31);
  box(775,6.4,432,42,.4,66,sand);
  // Familiar cover: Xbox, A default, goose, B double stack, back plat, car and blue.
  const crate=(x,z,w=15,d=15,h=1.7,y=dustHeight(x,z),ink=INK.GREEN)=>{
    box(x,y,z,w,h,d,{ink});
    for(const side of [-1,1]) {box(x+side*(w/2-.7),y,z,1.4,h+.04,d+.3,wood);box(x,y+.18,z+side*d/2,w,.12,.5,wood);box(x,y+h-.23,z+side*d/2,w,.12,.5,wood);}
  };
  crate(625,292,16,16,1.8,0); // Xbox: jump onto catwalk.
  crate(845,119,24,26,1.9,3.6);crate(817,84,19,12,1.7,3.6);crate(787,89,13,12,1.4,3.6);
  crate(419,80,17,17,2.1,1.5);crate(413,113,14,14,1.9,1.5);crate(385,136,19,18,2.8,1.5);
  crate(448,119,13,13,1.2,1.5);crate(452,103,12,12,2.4,1.5);
  surface(334,18,374,123,2.1,stone);B.stairs(X(354),1.5,Z(141),'-z',5,4,{rise:.12,run:.65,ink:INK.BLUE});
  crate(804,335,31,16,2.3,0,INK.BLUE); // Long blue container.
  crate(542,297,12,12,1.5,0);crate(781,420,10,12,1.5,0);
  const car=(x,z,y,angle=0)=>{
    const base=new THREE.BoxGeometry(2.15,.65,4.4),top=new THREE.BoxGeometry(1.8,.75,2.4);base.translate(0,.5,0);top.translate(0,1.17,-.25);
    for(const g of [base,top]){g.rotateY(angle);g.translate(X(x),y,Z(z));B.addGeo(g,INK.BLUE);}
    B.collider(X(x),y,Z(z),angle?4.4:2.15,1.6,angle?2.15:4.4,{tag:'car'});
    for(const a of [-1,1])for(const b of [-1,1]){const g=new THREE.CylinderGeometry(.43,.43,.24,10);g.rotateZ(Math.PI/2);g.translate(a*1.08,.4,b*1.35);g.rotateY(angle);g.translate(X(x),y,Z(z));B.addGeo(g,INK.BLACK);}
  };
  car(428,221,1.5,.35);car(941,195,dustHeight(941,195),0);car(598,119,0,Math.PI/2);car(777,532,dustHeight(777,532),.15);
  // Stone arch voussoirs and horseshoe silhouettes above the tunnel mouth.
  for(let i=0;i<10;i++){const a=(i+.5)*Math.PI/10;box(358+Math.cos(a)*13,3.8+Math.sin(a)*2,232,4,.45,5,stone);}
  // Parapets and a domed kasbah make B recognizable from the courtyard.
  for(let x=329;x<459;x+=12)box(x,9,8,7,.65,5,stone);
  B.cyl(X(312),9,Z(86),3,3.5,{ink:INK.ORANGE,noCollide:true});
  const dome=new THREE.SphereGeometry(3,20,10,0,Math.PI*2,0,Math.PI/2);dome.translate(X(312),12.5,Z(86));B.addGeo(dome,INK.BLUE);
  // A/B paint marks are vector geometry so they obey the depth/shading pass.
  const mark=(x,y,z,letter,ground=false)=>{
    const strokes=letter==='A'?[[0,0,.8,2.4],[.8,2.4,1.6,0],[.35,1,1.25,1]]:[[0,0,0,2.4],[0,2.4,1.15,2.4],[1.15,2.4,1.5,1.8],[1.5,1.8,1.1,1.2],[0,1.2,1.1,1.2],[1.1,1.2,1.5,.6],[1.5,.6,1.1,0],[0,0,1.1,0]];
    for(const [a,b,c,d]of strokes){const len=Math.hypot(c-a,d-b),g=new THREE.BoxGeometry(len,.15,.045);g.rotateZ(Math.atan2(d-b,c-a));g.translate((a+c)/2,(b+d)/2,0);if(ground)g.rotateX(-Math.PI/2);g.translate(X(x),y,Z(z));B.addGeo(g,INK.RED);}
  };
  mark(870,4.8,27,'A');mark(411,3.8,57,'B');mark(848,3.625,132,'A',true);mark(420,1.525,99,'B',true);
  // Subtle route graffiti at the familiar junctions.
  mark(554,2.2,190,'B');mark(698,2.2,441,'A');
  const spots=[[558,649],[356,480],[390,324],[352,169],[436,195],[541,160],[692,158],[798,108],[906,74],[898,350],[914,461],[717,533],[611,430]];
  for(const[x,z]of spots){const y=Math.round(dustHeight(x,z)/.12)*.12;const p=new THREE.Vector3(X(x),y,Z(z));L.arenaSpawns.push(p);B.spawn(p.x,p.y,p.z);}
  for(const[x,z]of [[553,650],[401,330],[430,161],[535,165],[858,89],[903,319],[716,526]])B.pickup(X(x),Math.round(dustHeight(x,z)/.12)*.12,Z(z));
  for(const[x,z]of [[903,100],[351,180],[898,457]])B.sniper(X(x),Math.round(dustHeight(x,z)/.12)*.12,Z(z));
  for(const[x,y,z]of [[570,12,632],[407,9,353],[351,11,208],[689,11,155],[885,12,295],[781,10,462]])B.ring(X(x),y,Z(z),'y');
  L.playerStart.copy(L.arenaSpawns[0]);L.teamSpawns=[L.arenaSpawns.slice(0,3),L.arenaSpawns.slice(5,9)];
  L.callouts={tSpawn:[558,649],outsideTunnels:[390,476],upperTunnels:[390,325],lowerTunnels:[544,287],bSite:[414,90],bDoors:[464,161],bWindow:[464,106],midDoors:[612,263],mid:[611,430],catwalk:[647,363],short:[737,232],ctSpawn:[692,158],aSite:[858,105],long:[900,310],pit:[900,448],longDoors:[779,432],outsideLong:[728,521]};
  for(const[k,[x,z]]of Object.entries(L.callouts))L.callouts[k]=new THREE.Vector3(X(x),Math.round(dustHeight(x,z)/.12)*.12,Z(z));
  // Invisible, non-grapple perimeter prevents falling off the finite mesh.
  for(const[x,z,w,d]of [[-66,0,2,132],[62,0,2,132],[0,-65,132,2],[0,65,132,2]])B.collider(x,0,z,w,70,d,{noNav:true,noGrapple:true});
  B.collider(0,70,0,132,3,132,{noNav:true,noGrapple:true});
  B.planes(2,29,26,{ink:INK.BLUE});
  return B.finish();
}
