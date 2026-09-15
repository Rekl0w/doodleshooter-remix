import { ui } from './i18n.js';
import * as THREE from 'three';
import { makeInkMaterial, INK } from './render.js';

// Each peer evaluates the same path at a host-synchronized time, including late joiners.
export function birdPosition(t, index, height, out = new THREE.Vector3()) {
  const r = 17 + index * 3, phase = index * 1.047, a = t * (.14 + index * .007) + phase;
  return out.set(Math.cos(a) * r, height + (index % 3) * 3 + Math.sin(a * 2 + phase) * 1.5, Math.sin(a) * r * .72 + Math.sin(a * 2) * 2);
}
export function addSkyAnimals(B) {
  const { L, scene } = B, height = L.skyHeight ?? ({ district: 39, harbor: 23, canyon: 22, gardens: 22 }[L.key] || 15);
  for (let i = 0; i < 6; i++) {
    const duck = i % 2 === 0, root = new THREE.Group(), wings = [];
    const mat = makeInkMaterial({ ink: duck ? INK.GREEN : INK.BLUE }), dark = makeInkMaterial({ ink: INK.BLACK }), orange = makeInkMaterial({ ink: INK.ORANGE });
    const part = (geo, x, y, z, material) => { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); root.add(m); return m; };
    part(new THREE.SphereGeometry(.65, 10, 7), 0, 0, 0, mat).scale.set(.85, .7, 1.4);
    part(new THREE.SphereGeometry(duck ? .38 : .26, 9, 6), 0, .3, -.73, mat);
    part(new THREE.BoxGeometry(duck ? .34 : .14, .12, .35), 0, .24, -1.06, orange);
    for (const side of [-1, 1]) {
      part(new THREE.SphereGeometry(.045, 5, 4), side * .25, .4, -.89, dark);
      const wing = new THREE.Group(); wing.position.set(side * .4, .05, 0);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(duck ? 1.2 : 1.7, .07, .48), mat); blade.position.x = side * (duck ? .6 : .85); wing.add(blade); root.add(wing); wings.push(wing);
    }
    part(new THREE.ConeGeometry(.28, .55, 3), 0, .08, .93, mat).rotation.x = Math.PI / 2;
    const ring = part(new THREE.TorusGeometry(.48, .065, 6, 16), 0, -.6, 0, orange); ring.rotation.x = Math.PI / 2;
    scene.add(root); L.meshes.push(root);
    const mover = { id: 'bird-' + i, name: duck ? ui("Duck") : ui("Swallow"), mesh: root, radius: 1.5, velocity: new THREE.Vector3() };
    L.grappleMovers.push(mover);
    const next = new THREE.Vector3();
    const update = t => {
      birdPosition(t, i, height, root.position); birdPosition(t + .01, i, height, next);
      const scale = L.skyScale ?? 1; root.position.x *= scale; root.position.z *= scale; next.x *= scale; next.z *= scale;
      mover.velocity.copy(next).sub(root.position).multiplyScalar(100);
      root.rotation.y = Math.atan2(-mover.velocity.x, -mover.velocity.z);
      root.rotation.z = Math.sin(t * .5 + i) * .1;
      wings.forEach((w, side) => { w.rotation.z = (side ? 1 : -1) * Math.sin(t * (duck ? 7 : 10) + i) * .65; });
    };
    update(0); L.animated.push({ mesh: root, update });
  }
}

export class SceneClock {
  constructor(now = () => performance.now() / 1000) { this.now = now; this.offset = 0; this.pending = new Map(); this.serial = 0; this.samples = []; }
  time() { return this.now() + this.offset; }
  request() { const id = ++this.serial; this.pending.set(id, this.now()); if (this.pending.size > 4) this.pending.delete(this.pending.keys().next().value); return { id }; }
  accept(data) {
    if (!data || !Number.isFinite(data.time) || !this.pending.has(data.id)) return false;
    const now = this.now(), sent = this.pending.get(data.id); this.pending.delete(data.id);
    const rtt = now - sent; if (rtt < 0 || rtt > 3) return false;
    this.samples.push({ rtt, offset: data.time + rtt / 2 - now }); if (this.samples.length > 8) this.samples.shift();
    this.offset = this.samples.reduce((a, b) => a.rtt < b.rtt ? a : b).offset; return true;
  }
  changeHost() { this.pending.clear(); this.samples = []; }
}
