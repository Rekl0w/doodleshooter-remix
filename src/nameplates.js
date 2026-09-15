import * as THREE from 'three';

// DOM labels stay crisp in either render style. Occlusion prevents names revealing
// players through walls or trees; use the head itself for the visibility ray.
export class Nameplates {
  constructor(root) {
    this.layer = document.createElement('div'); this.layer.className = 'nameplates'; root.append(this.layer);
    this.labels = new Map(); this.point = new THREE.Vector3(); this.eye = new THREE.Vector3();
  }
  update(players, camera, world, visible) {
    this.layer.hidden = !visible;
    for (const [id, label] of this.labels) if (!players.has(id)) { label.remove(); this.labels.delete(id); }
    if (!visible) return;
    camera.updateMatrixWorld(); camera.getWorldPosition(this.eye);
    for (const [id, player] of players) {
      let label = this.labels.get(id);
      if (!label) { label = document.createElement('div'); label.className = 'player-name'; label.dataset.peer = id; this.layer.append(label); this.labels.set(id, label); }
      label.hidden = true;
      if (!player.alive || player.corpse || player.away || !player.root?.visible || !player.snapB) continue;
      const head = player.hitSpheres[0];
      this.point.copy(head); this.point.y += .55; this.point.project(camera);
      if (this.point.z < -1 || this.point.z > 1 || Math.abs(this.point.x) > .97 || Math.abs(this.point.y) > .95) continue;
      if (!world.hasLineOfSight(this.eye, head, box => box.data.noShoot === true)) continue;
      if (label.textContent !== player.name) label.textContent = player.name;
      label.classList.toggle('protected', player.protected);
      label.style.transform = `translate(${(this.point.x * .5 + .5) * innerWidth}px, ${(-this.point.y * .5 + .5) * innerHeight}px) translate(-50%, -100%)`;
      label.hidden = false;
    }
  }
}
