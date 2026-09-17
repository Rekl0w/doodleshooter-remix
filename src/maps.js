import { buildTeamMap } from './team-maps.js';
import { ui } from './i18n.js';
import * as THREE from 'three';
import { INK } from './render.js';
import { buildWilderness, buildDust, buildSkyline } from './expansion-maps.js';

export const NEW_MAPS = [
  { key: 'foundry', name: ui('Foundry'), blurb: ui('Team arena · Machine halls · Three routes'), style: 'harbor' },
  { key: 'quarter', name: ui('Old Quarter'), blurb: ui('Team arena · Courtyards · Covered alleys'), style: 'canyon' },
  { key: 'harbor', name: ui("Container Harbor"), blurb: ui("Tight lanes · Cranes · Close combat"), style: 'harbor' },
  { key: 'canyon', name: ui("Paper Canyon"), blurb: ui("Open ground · Terraces · Long range"), style: 'canyon' },
  { key: 'gardens', name: ui("Rooftop Gardens"), blurb: ui("High bridges · Parks · Grappling"), style: 'gardens' },
  { key: 'forest', name: ui("Pine Valley"), blurb: ui("Woodland · Wide clearing · VS"), style: 'forest' },
  { key: 'duel', name: ui("Forest Duel"), blurb: ui("Small arena · Symmetric cover · VS"), style: 'duel' },
  { key: 'meadow', name: ui("Lakeside"), blurb: ui("Meadow · Piers · Open VS arena"), style: 'meadow' },
  { key: 'deepforest', name: ui("Deep Forest"), blurb: ui("288 × 288 · Dense trees · Cabins"), style: 'forest' },
  { key: 'lostwoods', name: ui("Lost Woods"), blurb: ui("352 × 352 · Ruins · Hide and hunt"), style: 'forest' },
  { key: 'dust2', name: 'Dust 2 · Remix', blurb: ui("CS2 layout · Long / Short · Mid · B tunnels"), style: 'canyon' },
  { key: 'skyline', name: ui("Skyline City"), blurb: ui("24 towers · Rooftop bridges · Swing through the sky"), style: 'gardens' },
];

function perimeter(B, key, ink, size = 52) {
  const { L, box, collider, spawn, pickup } = B;
  const scale = size / 52, width = size * 2 + 4;
  L.key = key; L.playerStart.set(0, 0, 43 * scale); L.skyScale = scale;
  L.bounds = { minX: -size, maxX: size, minZ: -size, maxZ: size };
  box(0, -1, 0, width, 1, width);
  // Continuous visible boundary, with unhookable extensions to prevent escaping over it.
  for (const [x, z, w, d] of [[0, -size, width, 3], [0, size, width, 3], [-size, 0, 3, width], [size, 0, 3, width]]) {
    box(x, 0, z, w, 9, d, { ink, noNav: true });
    collider(x, 9, z, w, 62, d, { noNav: true, noGrapple: true });
  }
  collider(0, 70, 0, width, 3, width, { noNav: true, noGrapple: true });
  const spots = [[-44, -38], [0, -44], [44, -38], [-44, 0], [44, 0], [-44, 38], [0, 44], [44, 38], [-28, -43], [28, 43]];
  for (const [x, z] of spots) { spawn(x * scale, 0, z * scale); L.arenaSpawns.push(new THREE.Vector3(x * scale, 0, z * scale)); }
  for (const [x, z] of [[-39, -35], [39, -35], [-39, 35], [39, 35], [0, 35], [0, -35]]) pickup(x * scale, 0, z * scale);
  for (const x of [-38 * scale, 38 * scale]) {
    box(x, 0, 43 * scale, .25, 7, .25, { ink: INK.BLACK });
    box(x, 7, 43 * scale, 2.4, .3, .5, { ink });
  }
  L.teamSpawns = [L.arenaSpawns.filter(p => p.x < 0), L.arenaSpawns.filter(p => p.x > 0)];
}

function finish(B, ink) {
  // Landmarks remain static and identical for every peer; only decoration moves.
  B.sphere(-65, 78, -140, 9, { ink });
  for (let i = 0; i < 10; i++) {
    const angle = i * Math.PI / 5;
    const ray = new THREE.BoxGeometry(4, .45, .45);
    ray.rotateZ(angle); ray.translate(-65 + Math.cos(angle) * 14, 78 + Math.sin(angle) * 14, -140);
    B.addGeo(ray, ink);
  }
  B.planes(2, 26 * (B.L.skyScale || 1), 27, { scale: 1.1, hStep: 7, rStep: 8 * (B.L.skyScale || 1), ink });
  return B.finish();
}

export function buildHarbor(B) {
  perimeter(B, 'harbor', INK.BLUE);
  const { box, stairs, ring, rail, sniper, pickup } = B;
  const container = (x, z, w, d, h, ink) => {
    box(x, 0, z, w, h, d, { ink });
    for (let i = -w / 2 + 1; i < w / 2; i += 1.5) {
      for (const side of [-1, 1]) box(x + i, .2, z + side * (d / 2 + .02), .06, h - .4, .04, { noCollide: true, ink: INK.BLACK });
    }
    box(x, h, z, w + .15, .12, d + .15, { noCollide: true, ink: INK.BLACK });
  };
  // Four islands leave a broad central cross and two outer flanking routes.
  for (const x of [-22, 22]) {
    container(x, -19, 12, 14, 6, x < 0 ? INK.GREEN : INK.ORANGE);
    container(x, 19, 12, 14, 3, x < 0 ? INK.ORANGE : INK.BLUE);
    stairs(x, 0, 0, '-z', 24, 3, { rise: .25, run: .5 });
    stairs(x, 0, 6, '+z', 12, 3, { rise: .25, run: .5 });
    ring(x, 9, -19, 'y'); ring(x, 6, 19, 'y');
    pickup(x, 6, -19); pickup(x, 3, 19); sniper(x, 6, -23);
    rail(x - 6, -26, x + 6, -26, 6);
  }
  // Side stacks form shorter flanking lanes, with stairs back onto the loading decks.
  for (const side of [-1, 1]) for (const z of [-22, 0, 22]) {
    container(side * 36, z, 6, 10, 3, z === 0 ? INK.GREEN : INK.BLUE);
    stairs(side * 30, 0, z, side > 0 ? '+x' : '-x', 6, 2.5, { rise: .5, run: .5 });
  }
  // A gantry is both the main landmark and a route across the north loading yard.
  for (const x of [-34, 34]) {
    box(x, 0, -31, 1.2, 16, 1.2, { ink: INK.ORANGE });
    box(x, 15, -31, 3, 2, 3, { ink: INK.ORANGE });
  }
  box(0, 16, -31, 69, .8, 2, { ink: INK.ORANGE });
  for (const x of [-22, 0, 22]) {
    box(x, 10, -31, .06, 6, .06, { noCollide: true, ink: INK.BLACK }); ring(x, 9.5, -31, 'y');
  }
  for (const [x, z] of [[-8, 13], [8, -13], [-36, -12], [36, 12], [-10, -32], [10, 32]]) {
    box(x, 0, z, 3, 1.2, 2, { ink: INK.GREEN });
    box(x, 1.2, z, 2.6, .08, 1.6, { ink: INK.BLACK, noCollide: true });
  }
  // Lane markings make the open firing lanes readable without adding obstacles.
  for (let z = -38; z <= 38; z += 6) box(0, .015, z, .2, .015, 2, { ink: INK.ORANGE, noCollide: true });
  pickup(0, 0, 0);
  return finish(B, INK.ORANGE);
}

export function buildCanyon(B) {
  perimeter(B, 'canyon', INK.ORANGE);
  const { box, slab, stairs, ring, sniper, pickup } = B;
  for (const side of [-1, 1]) {
    // A continuous valley floor connects both sides; every terrace has a stair route.
    box(side * 28, 0, 0, 24, 4, 56, { ink: INK.ORANGE });
    box(side * 34, 4, 0, 12, 4, 30, { ink: INK.ORANGE });
    for (const z of [-20, 20]) stairs(side * 10, 0, z, side > 0 ? '+x' : '-x', 12, 4, { rise: 1 / 3, run: .5, ink: INK.ORANGE });
    stairs(side * 20, 4, 0, side > 0 ? '+x' : '-x', 16, 4, { rise: .25, run: .5, ink: INK.ORANGE });
    sniper(side * 34, 8, -9); pickup(side * 34, 8, 9); pickup(side * 23, 4, 23);
    for (const z of [-22, 22]) ring(side * 20, 8, z, 'y');
    ring(side * 34, 12, 0, 'y');
    for (const z of [-10, 10]) box(side * 38, 8, z, 2, 1.1, 4, { ink: INK.BLACK });
  }
  for (const z of [-12, 12]) {
    slab(-16, z - 2, 16, z + 2, 4, .35, { ink: INK.BLUE });
    for (let x = -15; x < 16; x += 2) box(x, 4, z, .06, .02, 4, { noCollide: true, ink: INK.BLACK });
    ring(0, 8, z, 'y');
  }
  for (const x of [-6, 6]) for (const z of [-29, 29]) {
    box(x, 0, z, 2.4, 2, 2.4, { ink: INK.ORANGE });
    box(x, 2, z, 1.7, 1.2, 1.7, { ink: INK.ORANGE });
  }
  // Decorative ink stream is flat ground, never an invisible damage zone or pit.
  slab(-2, -47, 2, 47, .018, .01, { ink: INK.BLUE, noCollide: true });
  for (const z of [-36, 0, 36]) pickup(5, 0, z);
  for (const x of [-44, 44]) for (const z of [-46, 46]) {
    box(x, 0, z, 5, 12, 5, { ink: INK.ORANGE }); box(x, 12, z, 3, 6, 3, { ink: INK.ORANGE });
  }
  return finish(B, INK.ORANGE);
}

export function buildGardens(B) {
  perimeter(B, 'gardens', INK.GREEN);
  const { box, slab, stairs, ring, rail, cyl, sphere, sniper, pickup } = B;
  for (const x of [-17, 17]) for (const z of [-17, 17]) {
    const side = Math.sign(z);
    box(x, 0, z, 16, 6, 16, { ink: INK.BLUE });
    slab(x - 8, z - 8, x + 8, z + 8, 6.1, .1, { ink: INK.GREEN });
    stairs(x, 0, side * 37, side > 0 ? '-z' : '+z', 24, 3.5, { rise: 6.1 / 24, run: .5 });
    stairs(x, 6.1, side * 9, side > 0 ? '-z' : '+z', 14, 3.5, { rise: 5.9 / 14, run: .5 });
    ring(x, 10, z, 'y'); pickup(x, 6.1, z);
    // Planters flank the through-route rather than blocking stair landings.
    for (const dx of [-5, 5]) {
      box(x + dx, 6.1, z, 2.5, .8, 3, { ink: INK.ORANGE });
      cyl(x + dx, 6.9, z, .16, 2.2, { ink: INK.BLACK, noCollide: true });
      sphere(x + dx, 9.2, z, 1.1, { ink: INK.GREEN });
    }
    rail(x - 8, z + side * 8, x - 2.4, z + side * 8, 6.1, { ink: INK.GREEN });
    rail(x + 2.4, z + side * 8, x + 8, z + side * 8, 6.1, { ink: INK.GREEN });
    sniper(x - 3, 6.1, z - side * 3);
  }
  slab(-19, -2, 19, 2, 12, .4, { ink: INK.ORANGE });
  slab(-6, -6, 6, 6, 12, .4, { ink: INK.GREEN });
  for (const x of [-5, 5]) for (const z of [-5, 5]) box(x, 0, z, .6, 12, .6);
  box(0, 12, 0, 3, .9, 3, { ink: INK.ORANGE });
  ring(0, 17, 0, 'y'); ring(-17, 15, 0, 'y'); ring(17, 15, 0, 'y'); pickup(0, 12, 4);
  for (const z of [-34, 34]) for (const x of [-7, 7]) {
    box(x, 0, z, 3, .8, 1.2, { ink: INK.GREEN });
    box(x, .8, z, 3.2, .12, 1.4, { ink: INK.ORANGE });
  }
  pickup(-33, 0, 0); pickup(33, 0, 0);
  return finish(B, INK.GREEN);
}

function pine(B, x, z, height = 7) {
  B.cyl(x, 0, z, .35, height * .62, { ink: INK.BLACK });
  for (let i = 0; i < 3; i++) {
    const geo = new THREE.ConeGeometry(2.3 - i * .45, height * .6, 7);
    geo.translate(x, height * .52 + i * 1.1, z); B.addGeo(geo, INK.GREEN);
  }
}
function lowCover(B, x, z, w = 4, d = 1.3) {
  B.box(x, 0, z, w, 1.1, d, { ink: INK.ORANGE });
  B.box(x, 1.1, z, w + .15, .12, d + .1, { ink: INK.BLACK });
}
function lookout(B, x, z) {
  B.box(x, 0, z, 7, 3, 7, { ink: INK.ORANGE });
  B.stairs(x, 0, z + 9.5, '-z', 12, 3, { rise: .25, run: .5 });
  B.sniper(x, 3, z); B.pickup(x + 2, 3, z); B.ring(x, 7, z, 'y');
}
export function buildForest(B) {
  perimeter(B, 'forest', INK.GREEN); B.L.skyHeight = 15;
  // Trees cluster around the edge; the center and two side lanes remain easy to read.
  for (const side of [-1, 1]) for (const z of [-32, -19, -6, 7, 20, 33]) {
    pine(B, side * 34, z, 7 + (z % 3)); pine(B, side * 40, z + 4, 8);
  }
  for (const x of [-22, -11, 11, 22]) pine(B, x, -37, 8);
  for (const [x, z] of [[-12, 17], [12, -17], [-12, -9], [12, 9]]) lowCover(B, x, z, 5);
  lookout(B, -23, -20); lookout(B, 23, -20);
  for (const z of [-25, 0, 25]) B.ring(0, 10, z, 'y');
  B.pickup(0, 0, 0); B.pickup(-20, 0, 20); B.pickup(20, 0, 20);
  return finish(B, INK.GREEN);
}
export function buildDuel(B) {
  perimeter(B, 'duel', INK.GREEN, 32); B.L.skyHeight = 13;
  for (const side of [-1, 1]) for (const z of [-18, -6, 6, 18]) pine(B, side * 23, z, 6);
  for (const side of [-1, 1]) {
    lowCover(B, side * 10, -9, 5); lowCover(B, side * 10, 9, 5);
    B.box(side * 15, 0, 0, 3, 2.5, 3, { ink: INK.ORANGE });
    B.sniper(side * 19, 0, -14);
    B.ring(side * 13, 8, 0, 'y');
  }
  lowCover(B, 0, 0, 3, 3); B.pickup(0, 0, -17); B.pickup(0, 0, 17);
  return finish(B, INK.GREEN);
}
export function buildMeadow(B) {
  perimeter(B, 'meadow', INK.GREEN); B.L.skyHeight = 15;
  // Shallow decorative lake stays walkable: no concealed fall or damage volume.
  B.slab(-16, -24, 16, 20, .02, .01, { ink: INK.BLUE, noCollide: true });
  for (const x of [-12, 12]) {
    B.box(x, 0, 0, 4, .3, 48, { ink: INK.ORANGE });
    for (let z = -23; z < 24; z += 2) B.box(x, .3, z, 4, .025, .07, { noCollide: true, ink: INK.BLACK });
    B.ring(x, 9, -12, 'y'); B.ring(x, 9, 12, 'y'); B.pickup(x, .3, 12);
  }
  for (const side of [-1, 1]) {
    for (const z of [-32, -16, 0, 16, 32]) pine(B, side * 36, z, 7);
    lowCover(B, side * 26, 10, 4); lowCover(B, side * 26, -16, 4);
    lookout(B, side * 25, -30);
  }
  B.pickup(0, 0, 27); B.pickup(0, 0, -29);
  return finish(B, INK.GREEN);
}

const helpers = { perimeter, finish };
export const MAP_BUILDERS = { foundry: B => buildTeamMap(B, helpers, 'foundry'), quarter: B => buildTeamMap(B, helpers, 'quarter'), harbor: buildHarbor, canyon: buildCanyon, gardens: buildGardens, forest: buildForest, duel: buildDuel, meadow: buildMeadow,
  deepforest: B => buildWilderness(B, helpers), lostwoods: B => buildWilderness(B, helpers, true), dust2: B => buildDust(B, helpers), skyline: B => buildSkyline(B, helpers) };
