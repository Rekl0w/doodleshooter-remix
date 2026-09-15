import * as THREE from 'three';
import { makeInkMaterial, INK } from './render.js';
import { blastDamage } from './combat.js';
import { audio } from './audio.js';
export const SUPPORT = Object.freeze({ mine: { radius: 6, core: 2.8, damage: 180, edge: 30, self: 25 }, mineStock: 3, mineCap: 4, mineArm: 1, mineTrigger: 3.2 });
const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
function remove(scene, mesh) { scene.remove(mesh); mesh.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); }
function mineModel() {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.32, .38, .12, 10), makeInkMaterial({ ink: INK.BLACK }));
  const light = new THREE.Mesh(new THREE.CylinderGeometry(.13, .16, .07, 8), makeInkMaterial({ ink: INK.ORANGE })); light.position.y = .09;
  g.add(base, light); return g;
}
// Mines are owner-authoritative. Peers render placements and receive damage once from the owner.
export class Ordnance {
  constructor(ctx) { this.ctx = ctx; this.mines = []; this.remoteMines = new Map(); this.seen = new Set(); this.serial = 0; this.mineStock = 3; this.mineCd = 0; }
  emit(data) { this.ctx.onOrdnance?.(data); }
  reset() {
    for (const m of this.mines) { this.emit({ op: 'remove', id: m.id, pos: m.pos.toArray() }); remove(this.ctx.scene, m.mesh); }
    for (const m of this.remoteMines.values()) remove(this.ctx.scene, m.mesh);
    this.mines = []; this.remoteMines.clear(); this.seen.clear(); this.mineStock = 3; this.mineCd = 0;
  }
  resupply() { this.mineStock = Math.min(3, this.mineStock + 1); }
  placeMine() {
    const { player: P, world, hud } = this.ctx;
    if (!P.alive || this.mineCd > 0) return false;
    if (this.mineStock <= 0 || this.mines.length >= SUPPORT.mineCap) { hud.tip(this.mineStock <= 0 ? 'Mayın bitti · Cephane kutusu veya yeni dalga ile yenilenir' : 'Aynı anda en fazla 4 mayın', 2); return false; }
    const probe = P.body.pos.clone().addScaledVector(P.forward, 1.4); probe.y = P.body.pos.y + 1;
    const hit = world.raycast(probe, down, 2.5);
    if (!hit || hit.normal.y < .8 || !world.hasLineOfSight(P.eye, hit.point.clone().addScaledVector(up, .15))) { hud.tip('Mayın için yakınındaki açık zemini seç', 1.5); return false; }
    const pos = hit.point.clone().addScaledVector(up, .13);
    if (this.mines.some(m => m.pos.distanceTo(pos) < 1)) { hud.tip('Mayınları biraz aralıklı yerleştir', 1.5); return false; }
    const mesh = mineModel(); mesh.position.copy(pos); this.ctx.scene.add(mesh);
    const id = `mine:${++this.serial}`;
    this.mines.push({ pos, mesh, arm: SUPPORT.mineArm, life: 90, id });
    this.emit({ op: 'place', pos: pos.toArray(), id });
    this.mineStock--; this.mineCd = .6; audio.shell(); hud.tip('Mayın kuruldu · 1 saniye sonra hazır', 1); return true;
  }
  targets() {
    const ctx = this.ctx;
    return [...ctx.enemies.enemies.filter(e => e.alive && e.state !== 'spawn'), ...(ctx.targets?.() || []).filter(t => !t.isLocal && t.alive && ctx.canHurt?.(t))];
  }
  blast(kind, pos, id) {
    const ctx = this.ctx, P = ctx.player, spec = SUPPORT[kind], c = pos.clone().addScaledVector(up, .12);
    this.emit({ op: 'boom', id, pos: c.toArray() }); this.boom(kind, c);
    const visible = this.targets().filter(t => t.center.distanceTo(c) <= spec.radius && ctx.world.hasLineOfSight(c, t.center));
    const selfVisible = ctx.world.hasLineOfSight(c, P.center);
    // Snapshot cover before any explosion can destroy it.
    for (const t of visible) {
      const dist = t.center.distanceTo(c), dir = t.center.clone().sub(c).normalize();
      const damage = blastDamage(dist, spec.radius, spec.damage, spec.core, spec.edge);
      if (t.isLocal === false) ctx.hitGrenadePlayer?.(t, Math.min(95, damage * .5), c, id, kind);
      else ctx.enemies.damage(t, damage, { point: t.center.clone(), dir, part: 'torso', source: kind, crit: false });
    }
    const dist = P.center.distanceTo(c);
    if (P.alive && dist < spec.radius * .65 && selfVisible) { P.takeDamage(blastDamage(dist, spec.radius * .65, spec.self, 1, 5), c); P.knockback(P.center.clone().sub(c).normalize(), 5); }
    ctx.blastBreakables?.(c, spec.radius);
  }
  boom(kind, pos) { this.ctx.effects.boom(pos, SUPPORT[kind].radius); audio.explosion(pos); }
  receive(d, from = 'remote') {
    if (!d || !['place', 'remove', 'boom'].includes(d.op) || typeof d.id !== 'string' || d.id.length > 100 || !Array.isArray(d.pos) || d.pos.length !== 3 || !d.pos.every(n => Number.isFinite(n) && Math.abs(n) < 200)) return;
    const key = `${from}:${d.id}`, pos = new THREE.Vector3(...d.pos);
    if (d.op === 'place') {
      if (this.remoteMines.has(key) || this.seen.has(key) || this.remoteMines.size >= 40) return;
      const mesh = mineModel(); mesh.position.copy(pos); this.ctx.scene.add(mesh); this.remoteMines.set(key, { mesh, from, life: 90 });
    } else {
      const mine = this.remoteMines.get(key); if (mine) { remove(this.ctx.scene, mine.mesh); this.remoteMines.delete(key); }
      if (this.seen.has(key)) return;
      this.seen.add(key); if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value);
      if (d.op === 'boom') this.boom('mine', pos);
    }
  }
  removePeer(from) { for (const [id, m] of this.remoteMines) if (m.from === from) { remove(this.ctx.scene, m.mesh); this.remoteMines.delete(id); } }
  update(dt) {
    const ctx = this.ctx, P = ctx.player;
    this.mineCd = Math.max(0, this.mineCd - dt);
    if (P.alive && !P.dashLock && ctx.input.pressed('mine')) this.placeMine();
    const targets = this.mines.length ? this.targets() : [];
    for (let i = this.mines.length - 1; i >= 0; i--) {
      const m = this.mines[i]; m.arm -= dt; m.life -= dt;
      m.mesh.children[1].visible = m.arm <= 0 || Math.sin(m.arm * 18) > 0;
      const trigger = m.arm <= 0 && targets.some(t => t.center.distanceTo(m.pos) < SUPPORT.mineTrigger && ctx.world.hasLineOfSight(m.pos, t.center));
      if (trigger || m.life <= 0) {
        this.mines.splice(i, 1); remove(ctx.scene, m.mesh);
        if (trigger) this.blast('mine', m.pos, m.id); else this.emit({ op: 'remove', id: m.id, pos: m.pos.toArray() });
      }
    }
    for (const [id, m] of this.remoteMines) { m.life -= dt; if (m.life <= 0) { remove(ctx.scene, m.mesh); this.remoteMines.delete(id); } }
  }
}
