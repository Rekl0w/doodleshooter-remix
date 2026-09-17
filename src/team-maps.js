import * as THREE from 'three';
import { INK } from './render.js';

// Both layouts have three connected routes, protected spawn rooms and no roof bypass.
// Coordinates also drive the menu's plan previews.
export const TEAM_BLOCKS = {
  foundry: [[-21,-17,18,20],[21,17,18,20],[-21,17,18,20],[21,-17,18,20],
    [-5,-7,10,9],[5,7,10,9],[-40,0,10,4],[40,0,10,4],[0,-31,30,3],[0,31,30,3]],
  quarter: [[-22,-19,22,18],[22,19,22,18],[-22,19,22,18],[22,-19,22,18],
    [0,0,12,16],[-39,-4,12,8],[39,4,12,8],[0,-32,28,3],[0,32,28,3]]
};
export function buildTeamMap(B, H, key) {
  H.perimeter(B, key, INK.ORANGE, 48);
  const L = B.L, factory = key === 'foundry';
  L.teamSpawns = [-1, 1].map(side => Array.from({ length: 13 }, (_, i) =>
    new THREE.Vector3((i % 7 - 3) * 2.5, .04, side * (38 + Math.floor(i / 7) * 3))));
  L.arenaSpawns = L.teamSpawns.flat().map(p => p.clone());
  L.spawns = L.arenaSpawns.map(p => p.clone()); L.playerStart.copy(L.arenaSpawns[3]);
  L.pickups = []; L.skyHeight = 16;
  for (const z of [-38,38]) { B.pickup(0,.04,z); B.sniper(5,.04,z); }
  for (const x of [-22,22]) B.pickup(x,.04,0);
  for (const [x,z,w,d] of TEAM_BLOCKS[key]) {
    const height = factory ? 8 : 11;
    B.box(x,0,z,w,height,d,{ink:factory ? INK.BLUE : INK.ORANGE});
    // Solid upper extensions stop grapple routes over route-defining buildings.
    B.collider(x,height,z,w,62,d,{noNav:true,noGrapple:true});
    if (factory) {
      B.box(x,height,z,w+.3,.22,d+.3,{ink:INK.BLACK,noCollide:true});
      for (const side of [-1,1]) for (let ox=-w/2+2;ox<w/2;ox+=4)
        B.box(x+ox,3,z+side*(d/2+.03),1.6,1.8,.05,{ink:INK.ORANGE,noCollide:true});
    } else {
      for (const side of [-1,1]) for (let ox=-w/2+2;ox<w/2;ox+=4) {
        B.box(x+ox,4,z+side*(d/2+.03),1.4,2,.05,{ink:INK.BLUE,noCollide:true});
        B.box(x+ox,6.1,z+side*(d/2+.12),1.8,.18,.45,{ink:INK.BLACK,noCollide:true});
      }
    }
  }
  if (!factory) for (const x of [-22,22]) {
    B.box(x,6,0,22,.45,12,{ink:INK.ORANGE});
    for (const z of [-5.7,5.7]) B.box(x,5.3,z,22,.7,.5,{ink:INK.BLACK});
  }
  // Offset waist-height cover; the centre and both flanks remain traversable.
  for (const side of [-1,1]) {
    for (const [x,z] of [[35,19],[8,22],[35,-19]]) {
      B.box(side*x,0,side*z,2.4,1.3,2.4,{ink:INK.BLACK});
      B.box(side*x,1.3,side*z,2.5,.12,2.5,{ink:INK.ORANGE});
    }
    B.ring(0,5,side*35,'z');
    const ink = side < 0 ? INK.RED : INK.BLUE;
    B.box(0,.02,side*43,17,.03,1,{ink,noCollide:true});
    B.box(0,3,side*46.4,7,1.6,.08,{ink,noCollide:true});
    if (factory) {
      B.box(0,7,side*20,12,.4,2,{ink:INK.BLACK});
      B.box(-5.5,0,side*20,.5,7,.5,{ink:INK.ORANGE});
      B.box(5.5,0,side*20,.5,7,.5,{ink:INK.ORANGE});
    }
  }
  return H.finish(B, factory ? INK.BLUE : INK.ORANGE);
}
