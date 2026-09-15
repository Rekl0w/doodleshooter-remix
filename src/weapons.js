import { ui } from './i18n.js';
// First-person view models + firing logic: rifle, shotgun, revolver (hitscan) and katana.
import * as THREE from 'three';
import { makeInkMaterial, INK } from './render.js';
import { SEE_THROUGH } from './physics.js';
import { rand, clamp, damp, lerp, Spring3, TAU } from './util.js';
import { audio } from './audio.js';
import { MELEE } from './combat.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
function bx(w, h, d, x, y, z, mat, parent) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; }
function cyl(r, h, x, y, z, mat, parent, axis = 'z', seg = 8) { const g = new THREE.CylinderGeometry(r, r, h, seg); if (axis === 'z') g.rotateX(Math.PI / 2); else if (axis === 'x') g.rotateZ(Math.PI / 2); const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); parent.add(m); return m; }
function sph(r, x, y, z, mat, parent, seg = 8) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, seg), mat); m.position.set(x, y, z); parent.add(m); return m; }
function star(n = 7, r1 = 0.16, r2 = 0.06) { const s = new THREE.Shape(); for (let i = 0; i < n * 2; i++) { const a = (i / (n * 2)) * TAU, r = i % 2 === 0 ? r1 : r2; if (i === 0) s.moveTo(Math.cos(a) * r, Math.sin(a) * r); else s.lineTo(Math.cos(a) * r, Math.sin(a) * r); } s.closePath(); return new THREE.ShapeGeometry(s); }
function frame(w, h, t, d, x, y, z, mat, parent) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); bx(w, t, d, 0, h / 2, 0, mat, g); bx(w, t, d, 0, -h / 2, 0, mat, g); bx(t, h, d, -w / 2, 0, 0, mat, g); bx(t, h, d, w / 2, 0, 0, mat, g); return g; }
// doodle fist + forearm heading back toward the shoulder
function hand(mat, x, y, z, parent, dir = [0.4, -0.5, 1], len = 0.42) {
  sph(0.062, x, y, z, mat, parent); const d = new THREE.Vector3(...dir).normalize();
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, len, 7), mat); arm.position.set(x + d.x * len / 2, y + d.y * len / 2, z + d.z * len / 2);
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d); parent.add(arm); return arm;
}
function makeFlash(parent, x, y, z, scale) {
  const fm = makeInkMaterial({ ink: INK.ORANGE, fill: true, side: THREE.DoubleSide }); const g = new THREE.Group();
  g.add(new THREE.Mesh(star(7, 0.16, 0.06), fm)); const s2 = new THREE.Mesh(star(5, 0.11, 0.04), fm); s2.rotation.y = Math.PI / 2; g.add(s2);
  const s3 = new THREE.Mesh(star(5, 0.1, 0.04), fm); s3.rotation.x = Math.PI / 2; g.add(s3);
  g.position.set(x, y, z); g.scale.setScalar(scale); g.visible = false; parent.add(g); return g;
}

export class ViewModel {
  constructor(ctx) {
    this.ctx = ctx; this.root = new THREE.Group(); this.scale = 0.46; this.root.scale.setScalar(this.scale); this.root.visible = false;
    this.basePos = new THREE.Vector3(0.2, -0.17, -0.36); this.baseRot = new THREE.Vector3(0, 0, 0);
    this.aimPos = new THREE.Vector3(0, -0.13, -0.3); this.adsFov = 60; this.isGun = false;
    this.recoil = new Spring3(260, 18); this.recoilRot = new Spring3(220, 16);
    this.swayPos = new THREE.Vector3(); this.swayRot = new THREE.Vector3();
    this.aimAmt = 0; this.sprintAmt = 0; this.equipT = 0;
  }
  setSight(x, y, z, dist) { this.aimPos.set(-x * this.scale, -y * this.scale, -z * this.scale - dist); }
  equip() { this.equipT = 0; this.root.visible = true; }
  unequip() { this.root.visible = false; }
  animate(dt, st) {
    const lx = clamp(st.lookDelta.x, -0.12, 0.12), ly = clamp(st.lookDelta.y, -0.12, 0.12);
    this.aimAmt = damp(this.aimAmt, st.aim ? 1 : 0, 14, dt); const ia = 1 - this.aimAmt;
    this.swayPos.x = damp(this.swayPos.x, lx * 0.5 * (0.3 + 0.7 * ia), 10, dt); this.swayPos.y = damp(this.swayPos.y, ly * 0.35 * (0.3 + 0.7 * ia), 10, dt);
    this.swayRot.y = damp(this.swayRot.y, lx * 1.4 * ia, 10, dt); this.swayRot.x = damp(this.swayRot.x, ly * 0.9 * ia, 10, dt);
    this.swayRot.z = damp(this.swayRot.z, (-lx * 1.8 - st.strafe * 0.06) * ia, 8, dt);
    const bobX = Math.sin(st.bobPhase) * 0.013 * st.bobAmt * (0.15 + 0.85 * ia), bobY = Math.abs(Math.cos(st.bobPhase)) * 0.013 * st.bobAmt * (0.15 + 0.85 * ia);
    this.sprintAmt = damp(this.sprintAmt, st.sprinting && !st.aim ? 1 : 0, 8, dt);
    this.recoil.update(dt); this.recoilRot.update(dt);
    this.equipT = Math.min(1, this.equipT + dt * 3.2); const eq = 1 - easeOut(this.equipT);
    const p = this.root.position, r = this.root.rotation; const rk = this.recoil.value, rr = this.recoilRot.value; const ads = this.aimAmt;
    p.copy(this.basePos).lerp(this.aimPos, ads);
    p.x += this.swayPos.x + bobX + rk.x * (0.3 + 0.7 * ia) + this.sprintAmt * 0.06;
    p.y += this.swayPos.y + bobY + rk.y * (0.3 + 0.7 * ia) - eq * 0.32 - st.landDip * 0.35 * ia - this.sprintAmt * 0.09;
    p.z += rk.z + this.sprintAmt * 0.05;
    r.set(this.baseRot.x * ia + this.swayRot.x + rr.x - eq * 0.9 + this.sprintAmt * 0.4 + st.landDip * 0.5 * ia,
      this.baseRot.y * ia + this.swayRot.y + rr.y * (0.4 + 0.6 * ia) - this.sprintAmt * 0.55,
      this.baseRot.z * ia + this.swayRot.z + rr.z * (0.3 + 0.7 * ia) + this.sprintAmt * 0.18 + st.slideTilt * 0.4 * ia);
    // once you are properly behind a scope, the gun itself would just block the sight picture
    if (this.scope) this.root.visible = this.aimAmt < 0.8;
    this.update(dt, st);
  }
}

const GUNS = {
  rifle: { name: ui("Rifle"), hint: ui("Automatic · RMB to aim"), kind: 'rifle', magSize: 35, reserve: 175, maxReserve: 350, interval: 1 / 11, damage: 24, headMul: 2.6, pellets: 1, spread: 0.016, adsSpread: 0.0034, spreadKick: 0.009, spreadMax: 0.075, adsFov: 58, sight: [0, 0.12, -0.05, 0.3], camKick: [0.009, 0.0034], modelKick: [0.25, 0.3, 2.4, -3.2, 0.9, 1.2], fovKick: 1.2, reloadDur: 1.45, reloadType: 'mag', auto: true, falloff: null, tracer: 0.02, flashScale: 1, sound: 'shot', shell: [0.02, INK.ORANGE], moveSpread: 0.0012, pvp: [19, 1.8, null] },
  shotgun: { name: ui("Shotgun"), hint: ui("Powerful up close · Fire to interrupt reload"), kind: 'shotgun', magSize: 6, reserve: 36, maxReserve: 72, interval: 0.78, damage: 19, headMul: 1.8, pellets: 10, spread: 0.062, adsSpread: 0.034, spreadKick: 0, spreadMax: 0.1, adsFov: 68, sight: [0, 0.095, -1.0, 0.52], camKick: [0.05, 0.012], modelKick: [0.4, 0.6, 5, -9, 2, 3], fovKick: 4, reloadDur: 0.45, reloadType: 'shells', auto: false, falloff: [11, 32, 0.22], tracer: 0.014, flashScale: 1.9, sound: 'shotgunFire', shell: [0.035, INK.RED], moveSpread: 0.0006, cycleDur: 0.45, pvp: [16, 1.6, [9, 26, 0.15]] },
  sniper: { name: ui("Sniper"), hint: ui("Long range · RMB to scope"), kind: 'sniper', scope: true, magSize: 5, reserve: 25, maxReserve: 50, interval: 0.2, damage: 150, headMul: 3, pellets: 1, spread: 0.075, adsSpread: 0.0004, spreadKick: 0.05, spreadMax: 0.14, adsFov: 20, sight: [0, 0.135, 0, 0.42], camKick: [0.055, 0.008], modelKick: [0.25, 0.8, 4.5, -11, 1.2, 2], fovKick: 4.5, reloadDur: 2.1, reloadType: 'mag', auto: false, falloff: null, tracer: 0.03, flashScale: 1.7, sound: 'sniperFire', shell: [0.03, INK.ORANGE], moveSpread: 0.004, cycleDur: 0.85, pvp: [150, 1.5, null] },
  revolver: { name: 'Revolver', hint: ui("Solo: unlimited reserve · 6 shots, then R to reload"), kind: 'revolver', magSize: 6, reserve: 36, maxReserve: 72, interval: 0.4, damage: 42, headMul: 2.4, pellets: 1, spread: 0.006, adsSpread: 0.002, spreadKick: 0.02, spreadMax: 0.06, adsFov: 52, sight: [0, 0.08, -0.34, 0.42], camKick: [0.038, 0.007], modelKick: [0.3, 0.9, 3.2, -10, 1.5, 2.5], fovKick: 2.5, reloadDur: 1.6, reloadType: 'cylinder', auto: false, falloff: null, tracer: 0.026, flashScale: 1.35, sound: 'revolver', shell: null, moveSpread: 0.0015, pvp: [42, 2.4, [9, 34, 0.42]] },
  smg: { name: 'SMG', hint: ui("Rapid fire · Close combat on the move"), kind: 'smg', magSize: 28, reserve: 168, maxReserve: 336, interval: 1 / 16, damage: 16, headMul: 2, pellets: 1, spread: 0.022, adsSpread: 0.007, spreadKick: 0.005, spreadMax: 0.065, adsFov: 64, sight: [0, 0.09, -0.1, 0.32], camKick: [0.006, 0.004], modelKick: [0.2, 0.2, 1.7, -2, 1, 1.5], fovKick: 0.7, reloadDur: 1.15, reloadType: 'mag', auto: true, falloff: [12, 38, 0.35], tracer: 0.016, flashScale: 0.8, sound: 'shot', shell: [0.018, INK.ORANGE], moveSpread: 0.0005, pvp: [13, 1.7, [10, 30, 0.3]] },
};

const ARSENAL = {
  ak47: { name: 'AK-47', hint: ui("Powerful automatic · Fire in short bursts"), damage: 31, interval: 1 / 8, magSize: 30, reserve: 150, maxReserve: 300, spread: .02, adsSpread: .0045, camKick: [.018, .005], reloadDur: 1.9, pvp: [24, 1.8, [18, 60, .45]] },
  m4a1: { name: 'M4A1', hint: ui("Balanced automatic · Low recoil"), damage: 22, interval: 1 / 12, magSize: 30, reserve: 180, maxReserve: 360, spread: .012, adsSpread: .0025, camKick: [.007, .002], reloadDur: 1.5, pvp: [17, 1.8, [20, 65, .4]] },
  famas: { name: 'FAMAS', hint: ui("3 shots per click · Medium range"), damage: 25, interval: .075, magSize: 30, reserve: 150, maxReserve: 300, spread: .012, adsSpread: .002, camKick: [.009, .002], reloadDur: 1.7, auto: false, burstSize: 3, pvp: [19, 1.8, [22, 65, .5]] },
  m249: { name: 'M249', hint: ui("75-round belt · Sustained fire · Slow reload"), damage: 23, interval: 1 / 12, magSize: 75, reserve: 225, maxReserve: 450, spread: .025, adsSpread: .008, spreadMax: .09, camKick: [.011, .006], reloadDur: 3.6, pvp: [18, 1.7, [22, 70, .4]], moveSpread: .002 },
  dmr: { name: 'DMR', hint: ui("Semi-auto · Precise at long range"), damage: 65, interval: .36, magSize: 12, reserve: 72, maxReserve: 144, spread: .03, adsSpread: .0008, camKick: [.026, .003], reloadDur: 1.85, adsFov: 38, auto: false, headMul: 2.4, pvp: [45, 2, [35, 100, .65]] },
};
Object.assign(GUNS.sniper, { scopeZooms: [2, 4, 8], zoomIndex: 1, hint: ui("Scope 2–8× · RMB + wheel") });
Object.assign(ARSENAL.famas, { sight: [0, .25, -.08, .38] });
Object.assign(ARSENAL.dmr, { scope: true, scopeZooms: [2, 3, 4, 6], zoomIndex: 0, hint: ui("Semi-auto · Scope 2–6× · RMB + wheel") });
ARSENAL.dual = { name: ui("Dual Pistols"), hint: ui("Dual wield · Alternating fire · 30 rounds"), damage: 28, magSize: 30, reserve: 150, maxReserve: 300, interval: .135, reloadDur: 2.25, auto: false, spread: .024, adsSpread: .012, adsFov: 66, camKick: [.012, .006], modelKick: [0, 0, 0, 0, 0, 0], falloff: [14, 45, .4], pvp: [23, 1.8, [12, 40, .4]], sound: 'revolver', flashScale: .7, fovKick: .8 };
for (const [kind, spec] of Object.entries(ARSENAL)) GUNS[kind] = { ...GUNS.rifle, ...spec, kind };

export class Gun extends ViewModel {
  constructor(ctx, type) {
    super(ctx); Object.assign(this, GUNS[type]); this.isGun = true; this.mag = this.magSize;
    this.fireT = 0; this.reloading = false; this.reloadT = 0; this.spreadCur = this.spread; this.flashT = 0; this.pumpT = 0; this.racked = false; this.needPump = false;
    this.mat = makeInkMaterial({ ink: INK.BLUE }); this.dark = makeInkMaterial({ ink: INK.BLACK }); this.red = makeInkMaterial({ ink: INK.RED, fill: true });
    this.build(); this.setSight(...this.sight); if (this.scope) this.changeZoom(0);
  }
  get scopeZoom() { return this.scopeZooms?.[this.zoomIndex] || 1; }
  changeZoom(step) {
    if (!this.scopeZooms) return;
    this.zoomIndex = clamp((this.zoomIndex || 0) + step, 0, this.scopeZooms.length - 1);
    this.adsFov = 2 * Math.atan(Math.tan(40 * Math.PI / 180) / this.scopeZoom) * 180 / Math.PI;
  }
  get spreadPx() { return 5 + this.spreadCur * 900; }
  get infiniteReserve() { return this.kind === 'revolver' && this.ctx.game.mode === 'solo'; }
  get reserveText() { return this.infiniteReserve ? '∞' : this.reserve; }
  get canReload() { return this.infiniteReserve || this.reserve > 0; }
  cancelReload() {
    this.reloading = false; this.reloadT = 0; this.autoReloadT = 0; this.burstLeft = 0;
    if (this.magMesh) { this.magMesh.position.y = this.magY; this.magMesh.rotation.z = 0; }
    if (this.cylGroup) this.cylGroup.rotation.z = 0;
    if (this.handL) this.handL.position.copy(this.handLPos);
  }
  unequip() { super.unequip(); this.cancelReload(); this.flash.visible = false; }
  reset() {
    this.cancelReload(); this.mag = this.magSize; this.reserve = this.startReserve;
    this.fireT = this.pumpT = this.flashT = 0; this.needPump = this.pumped = false;
    this.spreadCur = this.spread; this.flash.visible = false; this.aimAmt = 0;
    if (this.foreEnd) this.foreEnd.position.z = this.foreEndZ;
    if (this.boltH) { this.boltH.position.z = this.boltZ; this.boltH.rotation.z = 0; }
    for (const spring of [this.recoil, this.recoilRot]) { spring.value.set(0, 0, 0); spring.vel.set(0, 0, 0); }
  }
  loadMagazine() {
    const take = Math.min(this.magSize - this.mag, this.infiniteReserve ? this.magSize : this.reserve);
    this.mag += take; if (!this.infiniteReserve) this.reserve -= take;
    this.reloading = false;
  }
  addAmmo(n) { this.reserve = Math.min(this.reserve + n, this.maxReserve); }
  startReload() {
    if (this.reloading || this.mag >= this.magSize || !this.canReload) return;
    this.reloading = true; this.reloadT = 0; this.racked = false; this.burstLeft = 0;
    if (this.reloadType === 'shells') audio.shell(); else if (this.reloadType === 'cylinder') audio.cylinder(); else audio.reload();
  }
  update(dt, st) {
    this.fireT -= dt; if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
    if (this.autoReloadT > 0) { this.autoReloadT -= dt; if (this.autoReloadT <= 0 && this.mag === 0) this.startReload(); }
    if (this.mag === 0 && this.canReload && this.pumpT <= 0 && !this.reloading && !(this.autoReloadT > 0)) this.startReload();
    // moving and flying bloom the shot; aiming down the sights steadies most of that, the scope nearly all of it
    const base = st.aim ? this.adsSpread : this.spread; let moveAdd = Math.min(st.speed, 24) * this.moveSpread + (st.grounded ? 0 : 0.01) + (st.sliding ? 0.008 : 0);
    if (st.aim) moveAdd *= this.scope ? 0.03 : 0.3;
    this.spreadCur = damp(this.spreadCur, base + moveAdd, 7, dt);
    const p = this.root.position, r = this.root.rotation;
    if (this.pumpT > 0) {
      this.pumpT -= dt; const t = 1 - this.pumpT / this.cycleDur; const s = Math.sin(Math.min(1, t * 1.15) * Math.PI);
      if (this.foreEnd) this.foreEnd.position.z = this.foreEndZ + s * 0.16;
      if (this.boltH) { this.boltH.position.z = this.boltZ + s * 0.2; this.boltH.rotation.z = -s * 1.1; }
      r.x += s * 0.12; r.z += s * 0.15; p.y -= s * 0.02;
      if (t > 0.45 && !this.pumped) { this.pumped = true; audio.pump(); this._ejectShell(); this.recoilRot.kick(-1.5, 0, 1); }
      if (this.pumpT <= 0) { this.pumped = false; this.needPump = false; if (this.foreEnd) this.foreEnd.position.z = this.foreEndZ; if (this.boltH) { this.boltH.position.z = this.boltZ; this.boltH.rotation.z = 0; } }
    }
    if (this.reloading) {
      this.reloadT += dt;
      if (this.reloadType === 'mag') {
        const t = this.reloadT / this.reloadDur;
        const tilt = Math.sin(clamp(t / 0.22, 0, 1) * Math.PI / 2) * (t < 0.82 ? 1 : clamp(1 - (t - 0.82) / 0.18, 0, 1));
        r.x += -0.3 * tilt; r.z += 0.5 * tilt; r.y += 0.25 * tilt; p.y -= 0.07 * tilt; p.x += 0.03 * tilt;
        const mt = clamp((t - 0.18) / 0.5, 0, 1); this.magMesh.position.y = this.magY - Math.sin(mt * Math.PI) * 0.3; this.magMesh.rotation.z = Math.sin(mt * Math.PI) * 0.6;
        if (t > 0.86 && !this.racked) { this.racked = true; this.recoilRot.kick(-2.5, 0, 0); this.recoil.kick(0, 0, 0.6); }
        if (this.reloadT >= this.reloadDur) this.loadMagazine();
        return;
      }
      if (this.reloadType === 'cylinder') {
        const t = this.reloadT / this.reloadDur; const open = t < 0.25 ? easeOut(t / 0.25) : t > 0.8 ? 1 - easeOut((t - 0.8) / 0.2) : 1;
        r.z += 0.9 * open; r.x += 0.3 * open; p.x -= 0.05 * open; p.y += 0.02 * open; this.cylGroup.rotation.z = -1.5 * open;
        if (t > 0.3 && !this.racked) { this.racked = true; for (let i = 0; i < 6; i++) this._ejectShell(0.7); audio.shell(); }
        if (this.reloadT >= this.reloadDur) { this.loadMagazine(); this.cylGroup.rotation.z = 0; }
        return;
      }
      // shells: one at a time, can be interrupted by firing
      const s = Math.sin(Math.min(1, this.reloadT / this.reloadDur) * Math.PI);
      r.z += 0.35 * s; r.x += 0.15 * s; p.y -= 0.04 * s; if (this.handL) this.handL.position.set(this.handLPos.x + 0.1 * s, this.handLPos.y - 0.12 * s, this.handLPos.z + 0.55 * s);
      if (this.reloadT >= this.reloadDur) { this.mag++; this.reserve--; this.reloadT = 0; if (this.mag >= this.magSize || this.reserve <= 0) { this.reloading = false; if (this.handL) this.handL.position.copy(this.handLPos); if (this.needPump) this.pumpT = this.cycleDur; } else audio.shell(); }
    }
    if (st.reloadPressed && this.mag < this.magSize && this.canReload && !this.reloading && this.pumpT <= 0) { this.startReload(); return; }
    const wantFire = this.burstSize ? (this.burstLeft > 0 || st.firePressed) : this.auto ? st.fire : st.firePressed;
    if (wantFire && this.fireT <= 0 && this.pumpT <= 0 && !st.blockFire) {
      if (this.mag <= 0) { if (st.firePressed) { audio.empty(); this.startReload(); if (!this.canReload && this.ctx.game.mode === 'solo') this.ctx.hud.tip(ui("Out of ammo · 5: Revolver · F: Earn ammo with katana kills"), 3); } }
      else { if (this.reloading) { this.reloading = false; if (this.handL) this.handL.position.copy(this.handLPos); } this.fire(st); }
    }
  }
  fire(st) {
    const ctx = this.ctx, P = ctx.player; this.fireT = this.interval; this.mag--;
    const spreadNow = this.spreadCur; this.spreadCur = Math.min(this.spreadCur + this.spreadKick, this.spreadMax);
    let hits = 0;
    for (let i = 0; i < this.pellets; i++) if (this.fireRay(P.eye, P.aimDir(spreadNow))) hits++;
    // fx
    this.flash.visible = true; this.flashT = 0.045; this.flash.rotation.z = rand(0, TAU); this.flash.scale.setScalar(this.flashScale * rand(0.8, 1.4));
    this.muzzle.getWorldPosition(_v); _v2.copy(P.forward);
    ctx.effects.strokeBurst(_v, INK.ORANGE, 4 + this.pellets, 6 * this.flashScale, { life: 0.08, size: 0.03, gravity: 0, drag: 8 });
    ctx.effects.smoke(_v, _v2, this.kind === 'shotgun' ? 5 : 2);
    if (this.shell && this.reloadType !== 'shells') this._ejectShell();
    if (this.cycleDur) { this.pumpT = this.cycleDur + 0.12; this.pumped = false; if (this.reloadType === 'shells') this.needPump = true; }
    const k = this.modelKick; this.recoil.kick(rand(-k[0], k[0]), rand(k[1] * 0.4, k[1]), k[2]); this.recoilRot.kick(k[3], rand(-k[4], k[4]), rand(-k[5], k[5]));
    P.recoil(this.camKick[0] * (st.aim ? 0.7 : 1) + rand(0, this.camKick[0] * 0.3), rand(-this.camKick[1], this.camKick[1])); P.kickFov(this.fovKick);
    audio[this.sound](); ctx.input.rumble(0.15 + this.fovKick * 0.08, 0.5, 40 + this.fovKick * 15); ctx.effects.shakeAmt += 0.02 + this.fovKick * 0.02;
    if (hits > 0 && this.kind === 'shotgun') ctx.game.hitstop(0.03, 0.3);
    if (this.burstSize) { this.burstLeft = (this.burstLeft || this.burstSize) - 1; if (this.burstLeft === 0) this.fireT = .32; }
    if (this.mag === 0) { this.autoReloadT = 0.25; this.burstLeft = 0; }
  }
  fireRay(origin, dir) {
    const ctx = this.ctx, range = this.scope ? 600 : 300; const hitE = ctx.enemies.raycast(origin, dir, range), hitW = ctx.world.raycast(origin, dir, range, SEE_THROUGH); let end, hit = false;
    // other players in a versus match are targets too; the closest thing along the ray wins
    const hitP = ctx.raycastPlayers ? ctx.raycastPlayers(origin, dir, range) : null;
    if (hitP && (!hitE || hitP.dist < hitE.dist) && (!hitW || hitP.dist < hitW.dist)) {
      end = hitP.point; const crit = hitP.part === 'head'; const pv = this.pvp || [this.damage, this.headMul, this.falloff]; let d = pv[0] * (crit ? pv[1] : 1);
      if (pv[2]) d *= clamp(1 - (hitP.dist - pv[2][0]) / (pv[2][1] - pv[2][0]), pv[2][2], 1);
      ctx.hitPlayer(hitP.player, d, { point: hitP.point, dir, part: hitP.part, source: this.kind, crit, dist: hitP.dist }); hit = true;
    } else if (hitW && hitW.box && hitW.box.data.breakable && (!hitE || hitW.dist < hitE.dist) && ctx.breakHit) {
      end = hitW.point; ctx.breakHit(hitW.box.data.breakable, this.damage, hitW.point, dir); hit = true;
    } else if (hitE && (!hitW || hitE.dist < hitW.dist)) {
      end = hitE.point; const crit = hitE.part === 'head'; let d = this.damage * (crit ? this.headMul : 1);
      if (this.falloff) d *= clamp(1 - (hitE.dist - this.falloff[0]) / (this.falloff[1] - this.falloff[0]), this.falloff[2], 1);
      ctx.enemies.damage(hitE.enemy, d, { point: hitE.point, dir, part: hitE.part, source: this.kind, crit }); hit = true;
    } else if (hitW) { end = hitW.point; ctx.effects.bulletImpact(hitW.point, hitW.normal, INK.BLUE); if (Math.random() < 0.25) audio.ricochet(hitW.point); }
    else end = origin.clone().addScaledVector(dir, range);
    this.muzzle.getWorldPosition(_v); ctx.effects.tracer(_v, end, INK.BLUE, this.tracer, 0.05);
    if (ctx.onShot) ctx.onShot(end);
    return hit;
  }
  _ejectShell(spread = 1) {
    if (!this.shell) return; const P = this.ctx.player; this.ejectPt.getWorldPosition(_v);
    _v2.copy(P.right).multiplyScalar(rand(1.5, 2.5) * spread).addScaledVector(P.forward, rand(-0.5, 0.5)); _v2.y += rand(1.5, 2.8);
    this.ctx.effects.shell(_v, _v2, this.shell[1], this.shell[0]);
  }
}

export class ArsenalGun extends Gun {
  constructor(ctx, kind) { super(ctx, kind); }
  build() {
    const g = this.root, mat = this.mat, dark = this.dark, k = this.kind;
    const wood = makeInkMaterial({ ink: INK.ORANGE }), short = k === 'famas', heavy = k === 'm249';
    const barrelEnd = short ? -.68 : k === 'dmr' ? -1.3 : -1.02;
    bx(heavy ? .15 : .09, .13, short ? .36 : .56, 0, 0, 0, mat, g);
    cyl(heavy ? .029 : .02, Math.abs(barrelEnd) - .3, 0, .025, (barrelEnd - .3) / 2, dark, g);
    cyl(.032, .09, 0, .025, barrelEnd, dark, g);
    bx(.085, .085, .28, 0, -.01, -.4, k === 'ak47' ? wood : mat, g);
    const stock = bx(.07, .12, k === 'famas' ? .28 : .33, 0, -.02, .38, k === 'ak47' ? wood : dark, g); stock.rotation.x = k === 'ak47' ? -.15 : 0;
    bx(.05, .15, .07, 0, -.13, .12, dark, g).rotation.x = .25;
    this.magMesh = new THREE.Group(); this.magY = -.16; this.magMesh.position.set(0, this.magY, k === 'famas' ? .24 : -.07); g.add(this.magMesh);
    if (heavy) bx(.20, .22, .20, 0, -.03, 0, wood, this.magMesh);
    else if (k === 'ak47') {
      for (let i = 0; i < 4; i++) bx(.06, .065, .12, 0, -i * .053, i * i * .008, dark, this.magMesh).rotation.x = i * .13;
    } else bx(.055, k === 'dmr' ? .12 : .22, .105, 0, -.04, 0, mat, this.magMesh);
    if (k === 'famas') {
      frame(.10, .09, .016, .3, 0, .14, .02, dark, g);
      frame(.095, .075, .008, .018, 0, .25, -.08, mat, g);
      this.sightDot = sph(.003, 0, .25, -.08, this.red, g);
    } else if (k === 'dmr') {
      cyl(.047, .42, 0, .15, -.06, mat, g); cyl(.06, .06, 0, .15, -.28, dark, g);
      for (const z of [-.2, .08]) bx(.03, .09, .03, 0, .09, z, dark, g);
    } else {
      frame(.075, .07, .012, .03, 0, .12, -.05, mat, g);
      sph(.003, 0, .12, -.05, this.red, g);
    }
    if (k === 'm4a1') for (let i = 0; i < 6; i++) bx(.10, .025, .015, 0, .05, -.28 - i * .035, dark, g);
    if (heavy || k === 'dmr') for (const x of [-.055, .055]) bx(.02, .22, .02, x, -.10, -.65, dark, g).rotation.z = x * 5;
    hand(mat, .02, -.16, .13, g); this.handL = hand(mat, -.05, -.08, -.4, g, [-.35, -.9, .9]); this.handLPos = this.handL.position.clone();
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, .025, barrelEnd - .05); g.add(this.muzzle);
    this.ejectPt = new THREE.Object3D(); this.ejectPt.position.set(.07, .03, .02); g.add(this.ejectPt);
    this.flash = makeFlash(g, 0, .025, barrelEnd - .05, 1);
  }
}

export class DualPistols extends Gun {
  constructor(ctx) { super(ctx, 'dual'); this.basePos.set(0, -.17, -.38); this.aimPos.set(0, -.14, -.42); }
  build() {
    this.hands = []; this.nextHand = 0;
    this.magMesh = new THREE.Group(); this.magY = -.16; this.root.add(this.magMesh);
    for (const side of [-1, 1]) {
      const g = new THREE.Group(); g.position.x = side * .47; this.root.add(g);
      bx(.095, .105, .42, 0, .035, -.08, this.mat, g);
      cyl(.023, .13, 0, .035, -.32, this.dark, g);
      const slide = bx(.098, .055, .38, 0, .105, -.075, this.mat, g);
      bx(.073, .2, .11, 0, -.11, .065, this.dark, g).rotation.x = -.2;
      frame(.075, .075, .012, .12, 0, -.05, -.06, this.dark, g);
      bx(.03, .025, .018, 0, .146, -.24, this.red, g);
      const magazine = bx(.065, .15, .075, 0, -.17, .06, this.mat, g);
      hand(this.mat, 0, -.12, .07, g, [side * .35, -.65, 1], .6);
      const muzzle = new THREE.Object3D(); muzzle.position.set(0, .035, -.40); g.add(muzzle);
      const eject = new THREE.Object3D(); eject.position.set(side * .06, .09, .02); g.add(eject);
      const flash = makeFlash(g, 0, .035, -.4, .7);
      this.hands.push({ root: g, slide, magazine, muzzle, eject, flash, kick: 0, flashLife: 0, side });
    }
    this.muzzle = this.hands[0].muzzle; this.ejectPt = this.hands[0].eject; this.flash = this.hands[0].flash;
  }
  fire(st) {
    const h = this.hands[this.nextHand]; this.lastFiredHand = this.nextHand; this.nextHand = 1 - this.nextHand;
    this.muzzle = h.muzzle; this.ejectPt = h.eject; this.flash = h.flash;
    super.fire(st); h.kick = .24; h.flashLife = .045;
  }
  update(dt, st) {
    super.update(dt, st);
    const reload = this.reloading ? Math.sin(Math.min(1, this.reloadT / this.reloadDur) * Math.PI) : 0;
    for (const h of this.hands) {
      h.kick = damp(h.kick, 0, 22, dt); h.flashLife -= dt; h.flash.visible = h.flashLife > 0;
      h.root.rotation.x = h.kick; h.root.rotation.z = h.side * reload * .35;
      h.root.position.y = -reload * .15; h.slide.position.z = -.075 + h.kick * .45;
      h.magazine.position.y = -.17 - reload * .28;
    }
  }
  unequip() { super.unequip(); for (const h of this.hands) { h.flash.visible = false; h.flashLife = 0; } }
  reset() { super.reset(); this.nextHand = 0; for (const h of this.hands) { h.kick = h.flashLife = 0; h.flash.visible = false; h.root.rotation.set(0,0,0); h.root.position.y = 0; h.magazine.position.y = -.17; h.slide.position.z = -.075; } }
}

export class Rifle extends Gun {
  constructor(ctx) { super(ctx, 'rifle'); }
  build() {
    const g = this.root, mat = this.mat, dark = this.dark;
    bx(0.09, 0.12, 0.5, 0, 0, 0, mat, g); bx(0.075, 0.085, 0.36, 0, 0, -0.42, mat, g);
    cyl(0.018, 0.42, 0, 0.02, -0.75, dark, g);
    this.magMesh = bx(0.06, 0.2, 0.1, 0, -0.16, -0.06, mat, g); this.magMesh.rotation.x = 0.15; this.magY = -0.16;
    bx(0.07, 0.11, 0.3, 0, -0.01, 0.4, mat, g); const grip = bx(0.05, 0.14, 0.06, 0, -0.13, 0.12, mat, g); grip.rotation.x = 0.3;
    // the sight: a single small floating dot, nothing else in the picture
    frame(0.075, 0.07, 0.012, 0.03, 0, 0.12, -0.05, mat, g); bx(0.03, 0.018, 0.05, 0, 0.062, -0.05, dark, g);
    sph(0.0012, 0, 0.12, -0.05, this.red, g, 5);
    hand(mat, 0.02, -0.15, 0.13, g, [0.5, -0.6, 1]); this.handL = hand(mat, -0.05, -0.08, -0.4, g, [-0.35, -0.9, 0.9]); this.handLPos = this.handL.position.clone();
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.02, -0.98); g.add(this.muzzle);
    this.ejectPt = new THREE.Object3D(); this.ejectPt.position.set(0.06, 0.02, 0.02); g.add(this.ejectPt);
    this.flash = makeFlash(g, 0, 0.02, -0.98, 1);
  }
}
export class Shotgun extends Gun {
  constructor(ctx) { super(ctx, 'shotgun'); this.basePos.set(0.2, -0.19, -0.34); }
  build() {
    const g = this.root, mat = this.mat, dark = this.dark;
    bx(0.09, 0.13, 0.42, 0, 0, 0.05, mat, g); cyl(0.021, 0.92, 0, 0.05, -0.62, dark, g); cyl(0.019, 0.72, 0, -0.02, -0.5, mat, g);
    this.foreEnd = bx(0.078, 0.085, 0.27, 0, 0.01, -0.46, mat, g); this.foreEndZ = -0.46;
    const stock = bx(0.07, 0.12, 0.34, 0, -0.04, 0.42, mat, g); stock.rotation.x = 0.08; const grip = bx(0.05, 0.13, 0.06, 0, -0.13, 0.16, mat, g); grip.rotation.x = 0.35;
    sph(0.013, 0, 0.095, -1.0, this.red, g, 6); bx(0.03, 0.025, 0.02, 0, 0.085, -0.02, dark, g);
    hand(mat, 0.02, -0.16, 0.17, g, [0.5, -0.6, 1]); this.handL = hand(mat, -0.04, -0.06, -0.45, g, [-0.35, -0.9, 0.9]); this.handLPos = this.handL.position.clone();
    this.handL.userData.foreEnd = true;
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.05, -1.09); g.add(this.muzzle);
    this.ejectPt = new THREE.Object3D(); this.ejectPt.position.set(0.06, 0.03, 0.05); g.add(this.ejectPt);
    this.flash = makeFlash(g, 0, 0.05, -1.09, 1);
  }
}
export class SMG extends Gun {
  constructor(ctx) { super(ctx, 'smg'); this.basePos.set(0.19, -0.18, -0.32); }
  build() {
    const g = this.root, mat = this.mat, dark = this.dark;
    bx(0.09, 0.13, 0.32, 0, 0, 0, mat, g);
    cyl(0.022, 0.25, 0, 0.025, -0.27, dark, g);
    bx(0.06, 0.07, 0.23, 0, -0.025, 0.25, dark, g);
    this.magMesh = bx(0.052, 0.25, 0.085, 0, -0.17, -0.025, mat, g); this.magY = -0.17;
    bx(0.05, 0.13, 0.07, 0, -0.12, 0.12, dark, g).rotation.x = 0.2;
    frame(0.07, 0.055, 0.01, 0.02, 0, 0.09, -0.1, mat, g); sph(0.002, 0, 0.09, -0.1, this.red, g);
    hand(mat, 0.02, -0.15, 0.13, g); this.handL = hand(mat, -0.05, -0.07, -0.15, g, [-0.35, -0.9, 0.9]); this.handLPos = this.handL.position.clone();
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.025, -0.41); g.add(this.muzzle);
    this.ejectPt = new THREE.Object3D(); this.ejectPt.position.set(0.06, 0.02, 0); g.add(this.ejectPt);
    this.flash = makeFlash(g, 0, 0.025, -0.41, 0.8);
  }
}
export class Revolver extends Gun {
  constructor(ctx) { super(ctx, 'revolver'); this.basePos.set(0.19, -0.2, -0.3); }
  build() {
    const g = this.root, mat = this.mat, dark = this.dark;
    bx(0.045, 0.09, 0.2, 0, 0, 0, mat, g); cyl(0.02, 0.3, 0, 0.035, -0.24, dark, g); bx(0.03, 0.03, 0.26, 0, 0.005, -0.22, mat, g);
    this.cylGroup = new THREE.Group(); this.cylGroup.position.set(0, 0.0, -0.02); g.add(this.cylGroup);
    const c = cyl(0.05, 0.11, 0, 0, 0, mat, this.cylGroup, 'z', 6); for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; cyl(0.012, 0.115, Math.cos(a) * 0.032, Math.sin(a) * 0.032, 0, dark, this.cylGroup, 'z', 5); }
    const grip = bx(0.045, 0.14, 0.055, 0, -0.1, 0.07, dark, g); grip.rotation.x = 0.4; bx(0.02, 0.045, 0.035, 0, 0.05, 0.1, mat, g).rotation.x = -0.4;
    bx(0.01, 0.03, 0.02, 0, 0.075, -0.34, this.red, g); bx(0.012, 0.025, 0.015, -0.014, 0.06, 0.08, mat, g); bx(0.012, 0.025, 0.015, 0.014, 0.06, 0.08, mat, g);
    hand(mat, 0.0, -0.13, 0.08, g, [0.45, -0.55, 1]); this.handL = hand(mat, -0.05, -0.17, 0.02, g, [-0.4, -0.7, 1]); this.handLPos = this.handL.position.clone();
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.035, -0.4); g.add(this.muzzle);
    this.ejectPt = new THREE.Object3D(); this.ejectPt.position.set(-0.05, 0.02, 0); g.add(this.ejectPt);
    this.flash = makeFlash(g, 0, 0.035, -0.4, 1);
  }
}

export class Sniper extends Gun {
  constructor(ctx) { super(ctx, 'sniper'); this.basePos.set(0.21, -0.19, -0.36); }
  build() {
    const g = this.root, mat = this.mat, dark = this.dark;
    bx(0.085, 0.115, 0.6, 0, 0, 0.05, mat, g);
    cyl(0.024, 1.25, 0, 0.02, -0.92, dark, g); cyl(0.032, 0.16, 0, 0.02, -1.5, dark, g);
    this.magMesh = bx(0.055, 0.16, 0.14, 0, -0.14, -0.06, mat, g); this.magY = -0.14;
    const stock = bx(0.075, 0.13, 0.44, 0, -0.02, 0.5, mat, g); stock.rotation.x = 0.04;
    bx(0.05, 0.14, 0.07, 0, -0.13, 0.2, mat, g).rotation.x = 0.3;
    bx(0.06, 0.05, 0.16, 0, 0.07, 0.42, mat, g);
    // scope: tube, rings, and a red cross the ADS view lines up with
    cyl(0.052, 0.56, 0, 0.135, -0.1, mat, g); cyl(0.066, 0.07, 0, 0.135, -0.36, mat, g); cyl(0.062, 0.07, 0, 0.135, 0.14, mat, g);
    for (const z of [-0.24, 0.02]) { const r = bx(0.03, 0.09, 0.035, 0, 0.085, z, dark, g); }
    const cross = new THREE.Group(); cross.position.set(0, 0.135, -0.38); g.add(cross);
    bx(0.09, 0.006, 0.004, 0, 0, 0, this.red, cross); bx(0.006, 0.09, 0.004, 0, 0, 0, this.red, cross);
    // bolt handle on the right, worked after every shot
    this.boltH = bx(0.026, 0.026, 0.16, 0.07, 0.05, 0.16, dark, g); this.boltZ = 0.16;
    sph(0.032, 0.07, 0.05, 0.24, dark, g, 6);
    // bipod
    const bl = bx(0.02, 0.26, 0.02, -0.07, -0.13, -0.78, dark, g); bl.rotation.z = 0.35;
    const br = bx(0.02, 0.26, 0.02, 0.07, -0.13, -0.78, dark, g); br.rotation.z = -0.35;
    hand(mat, 0.02, -0.16, 0.24, g, [0.5, -0.6, 1]); this.handL = hand(mat, -0.05, -0.09, -0.5, g, [-0.35, -0.9, 0.9]); this.handLPos = this.handL.position.clone();
    this.muzzle = new THREE.Object3D(); this.muzzle.position.set(0, 0.02, -1.6); g.add(this.muzzle);
    this.ejectPt = new THREE.Object3D(); this.ejectPt.position.set(0.06, 0.04, 0.06); g.add(this.ejectPt);
    this.flash = makeFlash(g, 0, 0.02, -1.6, 1);
  }
}

export class Katana extends ViewModel {
  constructor(ctx) {
    super(ctx); this.name = 'Katana'; this.hint = ui("Wide slash · RMB to block"); this.kind = 'katana';
    this.basePos.set(0.27, -0.25, -0.4); this.baseRot.set(0.75, 0.15, -0.35); this.aimPos.copy(this.basePos);
    this.slashT = 0; this.slashDur = 0.3; this.combo = 0; this.comboT = 0; this.blocking = false; this.blockT = 0; this.blockAmt = 0; this.hitDone = false; this.cooldown = 0; this.damage = 90; this.hitTargets = new Set(); this.hitFeedback = false;
    // guard pose: the sword simply comes in close to the face, held upright
    this.blockPos = new THREE.Vector3(0.21, -0.31, -0.36); this.blockRot = new THREE.Vector3(1.40, 0.30, 1.24); this.deflectKick = 0;
    this.parrySwing = 0; this.parryDir = 1; this.bloodLevel = 0;
    this.build();
  }
  build() {
    const mat = makeInkMaterial({ ink: INK.BLUE }), dark = makeInkMaterial({ ink: INK.BLACK }); const g = this.root;
    this.blade = bx(0.012, 0.035, 1.0, 0, 0, -0.55, mat, g); bx(0.012, 0.02, 0.08, 0, 0.007, -1.07, mat, g).rotation.x = 0.3;
    bx(0.1, 0.1, 0.02, 0, 0, -0.05, dark, g); bx(0.03, 0.036, 0.3, 0, 0, 0.12, dark, g);
    for (let i = 0; i < 6; i++) bx(0.036, 0.04, 0.02, 0, 0, 0.02 + i * 0.045, mat, g);
    hand(mat, 0.0, -0.005, 0.05, g, [0.5, -0.5, 1]); hand(mat, 0.0, -0.005, 0.2, g, [-0.4, -0.7, 1]);
    this.tip = new THREE.Object3D(); this.tip.position.set(0, 0, -1.05); g.add(this.tip);
    // Blood clings to the flat of the blade. Each streak is a ragged sliver built in the plane of
    // the steel and inset inside its silhouette, so nothing ever hangs off an edge.
    const blood = makeInkMaterial({ ink: INK.RED, fill: true, side: THREE.DoubleSide });
    const BH = 0.0168, BX = 0.0067;                 // blade half height, and the face to sit on
    this.smears = [];
    const spec = [
      [-0.34, 0.30, 0.00, 1], [-0.70, 0.26, 0.18, -1], [-0.95, 0.17, 0.40, 1],
      [-0.52, 0.22, 0.58, -1], [-0.20, 0.20, 0.74, 1], [-0.84, 0.20, 0.88, -1],
    ];
    for (let i = 0; i < spec.length; i++) {
      const [zc, len, at, side] = spec[i];
      const sh = new THREE.Shape(); const n = 12;
      // top edge of the streak: ragged, always inside the blade
      sh.moveTo(-len / 2, -BH * 0.92);
      for (let k = 0; k <= n; k++) {
        const t = k / n, x = -len / 2 + len * t;
        const taper = Math.sin(Math.PI * Math.min(1, t * 1.15));
        sh.lineTo(x, -BH * 0.92 + BH * 1.84 * (0.30 + 0.70 * taper * (0.55 + 0.45 * Math.abs(Math.sin(t * 7 + i * 2.1)))));
      }
      sh.lineTo(len / 2, -BH * 0.92); sh.closePath();
      const geo = new THREE.ShapeGeometry(sh, 2);
      geo.rotateY(Math.PI / 2);                     // lay it into the plane of the blade
      const m = new THREE.Mesh(geo, blood);
      m.position.set(side * BX, 0, zc); m.visible = false;
      g.add(m);
      this.smears.push({ mesh: m, at, base: len, side });
    }
  }
  get scopeZoom() { return this.scopeZooms?.[this.zoomIndex] || 1; }
  changeZoom(step) {
    if (!this.scopeZooms) return;
    this.zoomIndex = clamp((this.zoomIndex || 0) + step, 0, this.scopeZooms.length - 1);
    this.adsFov = 2 * Math.atan(Math.tan(40 * Math.PI / 180) / this.scopeZoom) * 180 / Math.PI;
  }
  get spreadPx() { return 4; }
  reset() {
    this.slashT = this.cooldown = this.combo = this.comboT = this.blockT = this.blockAmt = this.aimAmt = this.parrySwing = this.deflectKick = 0;
    this.blocking = false; this.hitTargets.clear(); this.hitFeedback = false; this.bloodLevel = 0;
  }
  unequip() { super.unequip(); this.slashT = 0; this.blocking = false; this.blockAmt = 0; this.hitTargets.clear(); }
  startSlash(st) {
    this.hitTargets.clear(); this.hitFeedback = false;
    this.slashT = this.slashDur; this.hitDone = false; this.combo++; this.comboT = 0.9; this.cooldown = this.slashDur + 0.06;
    audio.katanaSwing(); this.ctx.player.kickFov(2);
    if (st.sprinting || !st.grounded) this.ctx.player.lunge(5.5);
    const P = this.ctx.player, s = this.combo % 2 === 0 ? -1 : 1; const up = _v2.set(0, 1, 0);
    for (let i = 0; i < 9; i++) {
      const a = (-1.1 + 2.2 * i / 8) * s; const b = a + 0.12 * s;
      const pa = P.eye.clone().addScaledVector(P.forward, 1.3).addScaledVector(P.right, Math.cos(a) * 0.9 * s).addScaledVector(up, Math.sin(a) * 0.55 - 0.1);
      const pb = P.eye.clone().addScaledVector(P.forward, 1.3).addScaledVector(P.right, Math.cos(b) * 0.9 * s).addScaledVector(up, Math.sin(b) * 0.55 - 0.1);
      this.ctx.effects.tracer(pa, pb, INK.BLUE, 0.03 - 0.002 * i, 0.12 + i * 0.01);
    }
  }
  update(dt, st) {
    this.cooldown -= dt; this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; this.deflectKick = Math.max(0, this.deflectKick - dt * 6);
    this.parrySwing = Math.max(0, this.parrySwing - dt * 4.5);
    this.updateBlood(dt, st);
    // guard is up only while the aim trigger is held and you are not swinging
    const wantBlock = st.aim && !st.fire && this.slashT <= 0 && this.cooldown <= 0;
    if (wantBlock && !this.blocking) this.blockT = 0;
    this.blocking = wantBlock; if (this.blocking) this.blockT += dt;
    this.blockAmt = damp(this.blockAmt, this.blocking ? 1 : 0, 16, dt);
    const p = this.root.position, r = this.root.rotation;
    // Blend the whole pose to an absolute target. Adding an offset instead does not work here:
    // the shared animator already scales the base rotation down by the aim amount, so the same
    // offset landed on a different rotation depending on how far into the guard you were.
    if (this.blockAmt > 0.001) {
      const t = this.blockAmt;
      p.lerp(this.blockPos, t);
      r.x = lerp(r.x, this.blockRot.x, t); r.y = lerp(r.y, this.blockRot.y, t); r.z = lerp(r.z, this.blockRot.z, t);
    }
    // a parry is a small flick of the wrist, nothing that throws the pose around
    if (this.parrySwing > 0) {
      const e = Math.sin(Math.min(1, this.parrySwing) * Math.PI);
      r.z += this.parryDir * e * 0.42; r.y += this.parryDir * e * 0.16;
      p.x += this.parryDir * e * 0.035;
    }
    if (this.slashT > 0) {
      const previousT = 1 - this.slashT / this.slashDur;
      this.slashT -= dt; const t = clamp(1 - this.slashT / this.slashDur, 0, 1); const e = easeInOut(t); const s = this.combo % 2 === 0 ? -1 : 1;
      r.z += s * (1.3 - 2.7 * e); r.x += 0.7 - 1.5 * e; r.y += s * (-0.35 + 0.8 * e);
      p.x += s * (0.2 - 0.45 * e); p.y += 0.14 - 0.24 * e; p.z -= 0.12 * Math.sin(t * Math.PI);
      if (previousT < MELEE.activeEnd && t >= MELEE.activeStart) this.doHit(st, s);
    } else if ((st.firePressed || (st.fire && this.combo > 0)) && this.cooldown <= 0 && !st.blockFire) this.startSlash(st);
    if (st.meleePressed && !st.blockFire && this.slashT <= 0 && this.cooldown <= 0) this.startSlash(st);
  }
  doHit(st, s) {
    const ctx = this.ctx, P = ctx.player;
    const hits = ctx.enemies.inArc(P.eye, P.forward, MELEE.range, MELEE.cosHalf);
    _v2.copy(P.forward); _v.set(-P.forward.z, 0, P.forward.x).multiplyScalar(s * 0.7); _v2.add(_v).y -= 0.35; _v2.normalize();
    let any = false;
    for (const h of hits) { if (this.hitTargets.has(h.enemy)) continue; this.hitTargets.add(h.enemy); any = true; const point = h.enemy.center.clone(); ctx.enemies.damage(h.enemy, this.damage, { point, dir: _v2.clone(), part: 'torso', source: 'katana', crit: false, slashDir: s }); }
    if (ctx.playersInArc) for (const t of ctx.playersInArc(P.eye, P.forward, MELEE.range, MELEE.cosHalf)) { if (this.hitTargets.has(t)) continue; this.hitTargets.add(t); any = true; ctx.hitPlayer(t, 55, { point: t.center.clone(), dir: _v2.clone(), part: 'torso', source: 'katana', crit: false }); }
    if (!this.hitTargets.has('ropes') && ctx.cutRopes && ctx.cutRopes(P.eye, P.forward, MELEE.range)) { this.hitTargets.add('ropes'); any = true; }
    if (ctx.breakablesInArc) for (const br of ctx.breakablesInArc(P.eye, P.forward, MELEE.range, MELEE.cosHalf)) { if (this.hitTargets.has(br)) continue; this.hitTargets.add(br); any = true; ctx.breakHit(br, this.damage, br.pos.clone(), _v2.clone()); }
    // a swing only cuts; bullets are turned aside by the raised guard, never by a slash
    if (any && !this.hitFeedback) { this.hitFeedback = true; audio.katanaHit(); ctx.game.hitstop(0.045, 0.2); ctx.effects.shakeAmt += 0.12; ctx.input.rumble(0.7, 0.4, 90); this.recoil.kick(0, 0, 1.5); }
  }
  onDeflect(perfect) {
    this.parrySwing = 1; this.parryDir = -this.parryDir;
    this.recoilRot.kick(perfect ? -3.5 : -2, this.parryDir * 2, this.parryDir * 2.5); this.recoil.kick(this.parryDir * 0.15, 0.15, 1.2);
  }
  // The blade picks up ink as it kills and slowly sheds it again, so a good run shows on the steel.
  addBlood(amount) { this.bloodLevel = clamp(this.bloodLevel + amount, 0, 1); }
  updateBlood(dt, st) {
    this.bloodLevel = Math.max(0, this.bloodLevel - dt * 0.05);
    const lv = this.bloodLevel;
    for (let i = 0; i < this.smears.length; i++) {
      const sm = this.smears[i]; const on = lv > sm.at;
      sm.mesh.visible = on;
      // grow along the blade and fill out in height as it soaks, never past the steel
      if (on) { const f = clamp((lv - sm.at) / 0.28, 0.2, 1); sm.mesh.scale.set(1, 0.35 + 0.65 * f, 0.4 + 0.6 * f); }
    }
  }
}
