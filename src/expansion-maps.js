import * as THREE from 'three';
import { INK } from './render.js';

// Fixed seeds keep cover, paths and spawn clearances identical on every peer.
function random(seed) { return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; }; }
function rock(B, x, z, r, h) {
  const g = new THREE.DodecahedronGeometry(1, 0); g.scale(r, h * .65, r * .8); g.translate(x, h * .5, z); B.addGeo(g, INK.BLACK);
  B.collider(x, 0, z, r * 1.55, h, r * 1.25, { tag: 'rock' });
}
function tree(B, x, z, h, broad) {
  B.cyl(x, 0, z, broad ? .65 : .48, h * .8, { ink: INK.BLACK, seg: 7, tag: 'tree' });
  if (broad) {
    for (const [dx, dz, dy] of [[-1.4,0,0],[1.5,1,1],[0,-1.2,2.4]]) {
      const g = new THREE.IcosahedronGeometry(3.2, 1); g.scale(1, .8, 1); g.translate(x + dx, h - 2 + dy, z + dz); B.addGeo(g, INK.GREEN);
    }
  } else for (let i = 0; i < 3; i++) {
    const g = new THREE.ConeGeometry(3.7 - i * .65, h * .52, 7); g.translate(x, h * .48 + i * 2, z); B.addGeo(g, INK.GREEN);
  }
}
function bush(B, x, z, r = 1.5) {
  for (const dx of [-.6,.6]) { const g = new THREE.IcosahedronGeometry(r, 0); g.scale(1, .75, 1); g.translate(x + dx, 1.1, z); B.addGeo(g, INK.GREEN); }
  B.collider(x, 0, z, r * 1.7, 1.9, r * 1.5, { tag: 'bush' });
}
function cabin(B, x, z) {
  const o = { ink: INK.ORANGE };
  // Front and back doorways allow hiding without trapping the player inside.
  B.wallX(x - 6, x + 6, z - 5, 0, 4, .5, [[x - 1.7, x + 1.7, 0, 3]], o);
  B.wallX(x - 6, x + 6, z + 5, 0, 4, .5, [[x - 1.7, x + 1.7, 0, 3]], o);
  for (const side of [-1,1]) B.wallZ(z - 5, z + 5, x + side * 6, 0, 4, .5, [[z - 2, z + 2, 1.2, 3]], o);
  B.box(x, 4, z, 13, .4, 11, o); B.box(x + 4, 4.4, z, 1, 2, 1, { ink: INK.BLACK });
  B.box(x - 3.5, 0, z, 2, .9, 3, o); B.pickup(x + 2, 0, z); B.ring(x, 7, z, 'y');
}
function ruin(B, x, z) {
  for (const side of [-1,1]) {
    B.wallX(x - 9, x + 9, z + side * 8, 0, 6, 1.2, [[x - 2, x + 2, 0, 4]], { ink: INK.ORANGE });
    B.box(x + side * 9, 0, z - 3, 1.2, 4, 6, { ink: INK.ORANGE });
    B.cyl(x + side * 6, 0, z + 3, .8, 8, { ink: INK.BLACK, seg: 8 });
  }
  B.box(x, 0, z, 3, 1, 2, { ink: INK.ORANGE }); B.pickup(x + 4, 0, z); B.ring(x, 11, z, 'y');
}

export function buildWilderness(B, H, lost = false) {
  const size = lost ? 176 : 144, key = lost ? 'lostwoods' : 'deepforest';
  H.perimeter(B, key, INK.GREEN, size); B.L.navCell = 2; B.L.chunkSize = 32; B.L.skyHeight = 26;
  const rng = random(lost ? 81723 : 41289);
  const pois = [[-size*.47,-size*.46],[size*.46,-size*.4],[-size*.42,size*.42],[size*.46,size*.44]];
  const clear = [...B.L.spawns, ...B.L.pickups, B.L.playerStart].map(p => [p.x,p.z,7]);
  for (const [x,z] of pois) { clear.push([x,z,18]); lost ? ruin(B,x,z) : cabin(B,x,z); B.sniper(x,0,z+12); B.spawn(x,0,z+12); }
  for (const x of [-size*.7,0,size*.7]) for (const z of [-size*.7,0,size*.7]) {
    clear.push([x,z,6]); B.spawn(x,0,z); B.pickup(x,0,z); B.ring(x,18,z,'y');
  }
  const pathX = z => Math.sin(z / 34) * 16;
  const pathZ = x => Math.sin(x / 39) * 19;
  // Curved trails connect clearings; hundreds of staggered objects interrupt long sight lines.
  let trees = 0, props = 0;
  for (let x = -size + 11; x < size - 9; x += 10) for (let z = -size + 11; z < size - 9; z += 10) {
    const px = x + (rng()-.5)*5, pz = z + (rng()-.5)*5;
    if (clear.some(([cx,cz,r]) => Math.hypot(px-cx,pz-cz) < r) || Math.abs(px-pathX(pz)) < 4 || Math.abs(pz-pathZ(px)) < 4) continue;
    tree(B,px,pz,10+rng()*8,lost && rng()>.4); trees++;
    if (rng()>.42) { rock(B,px+3,pz+2,1.4+rng()*1.6,1.5+rng()*2.4); props++; }
    else { bush(B,px+3,pz+2,1.4+rng()*.5); props++; }
    if (rng()>.72) {
      const g = new THREE.CylinderGeometry(.55,.7,5,7); g.rotateZ(Math.PI/2); g.translate(px-2,.65,pz+3); B.addGeo(g,INK.ORANGE);
      B.collider(px-2,0,pz+3,5,1.25,1.2,{tag:'log'}); props++;
    }
  }
  for (let z = -size+8; z < size-8; z += 3) B.box(pathX(z), .01, z, 5, .012, 3.1, { noCollide:true, ink:INK.ORANGE });
  for (let x = -size+8; x < size-8; x += 3) B.box(x, .012, pathZ(x), 3.1, .012, 5, { noCollide:true, ink:INK.ORANGE });
  B.L.landmarks = pois.map(([x,z]) => new THREE.Vector3(x,0,z)); B.L.assetCounts = { trees, props, buildings:4 };
  B.L.playerStart.set(0,0,size*.827); // same clear southern trail entrance as perimeter
  return H.finish(B, INK.GREEN);
}

export { buildDust } from './dust2.js';

export function buildSkyline(B,H) {
  H.perimeter(B,'skyline',INK.BLUE,94); B.L.chunkSize=32; B.L.skyHeight=54;
  const rng=random(9817), roofSpawns=[]; let buildings=0;
  for(const x of [-60,-30,0,30,60]) for(const z of [-60,-30,0,30,60]) {
    if(x===0&&z===0) continue;
    const h=22+Math.floor(rng()*8)*4, ink=(buildings++%3===0)?INK.ORANGE:INK.BLUE;
    B.box(x,0,z,18,h,18,{ink}); B.box(x,h,z,19,.6,19,{ink:INK.BLACK});
    for(let y=3;y<h-2;y+=4) for(const d of [-6,-2,2,6]) {
      for(const side of [-1,1]) { B.box(x+d,y,z+side*9.04,1.3,1.8,.035,{ink:INK.GREEN,noCollide:true}); B.box(x+side*9.04,y,z+d,.035,1.8,1.3,{ink:INK.GREEN,noCollide:true}); }
    }
    B.box(x+3,h+.6,z+3,3,1.8,3,{ink:INK.BLACK});
    // Stay clear of the rooftop utility box and at least six metres from edges.
    roofSpawns.push(new THREE.Vector3(x-3,h+.64,z-3));
    for(const y of [11,21,h+3]) B.ring(x, y, z+10, 'z');
    B.ring(x+10,h*.6,z,'x');
  }
  // A connected rooftop circuit; thin beams are hookable from the streets below.
  for(const z of [-30,30]) for(const x of [-45,-15,15,45]) {
    B.box(x,21,z,13,.5,3,{ink:INK.ORANGE}); B.ring(x,24,z,'y');
  }
  for(const x of [-30,30]) for(const z of [-45,-15,15,45]) {
    B.box(x,29,z,3,.5,13,{ink:INK.ORANGE}); B.ring(x,32,z,'y');
  }
  // The central park offers a clear spawn and low anchors to start climbing.
  for(const [x,z] of [[-7,-7],[7,-7],[-7,7],[7,7]]) { tree(B,x,z,9,true); B.ring(x,10,z,'y'); }
  for(const z of [-45,-15,15,45]) for(const side of [-1,1]) {
    B.box(side*78,0,z,2.5,1.3,5,{ink:INK.ORANGE}); B.box(side*78,1.3,z,2.2,.8,2.8,{ink:INK.BLUE});
    B.pickup(side*74,0,z); B.sniper(side*74,0,z+4);
  }
  B.L.spawns=[]; B.L.arenaSpawns=[];
  for(const [x,z] of [[15,80],[-80,0],[80,0],[0,-80],[-45,-45],[45,-45],[-45,45],[45,45],[-15,15],[15,-15]]) { B.spawn(x,0,z); B.L.arenaSpawns.push(new THREE.Vector3(x,0,z)); }
  B.L.roofSpawns=roofSpawns; B.L.arenaSpawns.push(...roofSpawns);
  // Replace generic supplies that can intersect the outer building row.
  B.L.pickups=B.L.pickups.filter(p=>Math.abs(p.x)>70); B.pickup(0,0,0); B.pickup(0,0,78); B.pickup(0,0,-78);
  B.L.playerStart.set(15,0,80); B.ring(15,12,76,'y'); B.L.assetCounts={buildings};
  B.L.teamSpawns=[B.L.arenaSpawns.slice(0,5),B.L.arenaSpawns.slice(5)];
  return H.finish(B,INK.BLUE);
}
