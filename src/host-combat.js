// Trusted-host combat ledger. Clients propose hits; they never set health, life,
// protection or death. This is not a substitute for a trusted dedicated server.
import { WEAPON_ORDER, blastDamage } from './combat.js';
export const COMBAT_RULES = Object.freeze({
  hp: 110,
  protection: 2,
  respawn: 2.5,
  // A second ledger bucket spans weapon switches, so alternating weapons
  // cannot turn a sniper into a machine gun.
  globalShotInterval: 1 / 20,
  globalShotBurst: 4,
  // The local controller clamps the full body velocity to 48 m/s. Keep a
  // little room for rounding, but reject forged velocity vectors before they
  // can widen the host's grenade envelope or mislead remote interpolation.
  maxSnapshotVelocity: 55
});
// Client movement is intentionally bounded by the host. The old envelope was
// large enough for a forged snapshot to jump dozens of metres every tick;
// this cap leaves room for the 48 m/s local grapple ceiling and packet gaps,
// while the apparent-speed check below catches micro-timestamp teleports.
export const movementLimit = (dt) => 2.5 + 58 * Math.min(.5, Math.max(0, dt)) + 8 * Math.max(0, dt - .5);
// [body damage, head multiplier, hit interval, range, pellet count, falloff]
// PvP values mirror weapons.js; shotgun pellets share one cadence budget.
const profiles = {
  rifle: [19, 1.8, 1 / 11, 300],
  shotgun: [16, 1.6, .78, 300, 10, [9, 26, .15]],
  sniper: [150, 1.5, .97, 600],
  revolver: [42, 2.4, .4, 300, 1, [9, 34, .42]],
  smg: [13, 1.7, 1 / 16, 300, 1, [10, 30, .3]],
  ak47: [24, 1.8, 1 / 8, 300, 1, [18, 60, .45]],
  m4a1: [17, 1.8, 1 / 12, 300, 1, [20, 65, .4]],
  dual: [23, 1.8, .135, 300, 1, [12, 40, .4]],
  famas: [19, 1.8, .14, 300, 1, [22, 65, .5]],
  m249: [18, 1.7, 1 / 12, 300, 1, [22, 70, .4]],
  dmr: [45, 2, .36, 600, 1, [35, 100, .65]],
  katana: [55, 1, .36, 4.4]
};
export const vector = v => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 2000);
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const center = p => [p.pos[0], p.pos[1] + (p.snap?.[6] & 1 ? .6 : 1), p.pos[2]];
export class HostCombat {
  constructor({
    now = () => performance.now() / 1000,
    sight = () => true,
    changed = () => {},
    died = () => {},
    enabled = () => true,
    friendly = () => false,
    regenerate = () => true
  } = {}) {
    this.now = now;
    this.sight = sight;
    this.changed = changed;
    this.died = died; this.enabled = enabled; this.friendly = friendly; this.regenerate = regenerate;
    this.players = new Map();
    this.serial = 0;
    this.katana = true;
    this.explosions = new Map();
    this.lastTick = now();
  }
  clear(katana = true) {
    this.players.clear();
    this.explosions.clear();
    this.katana = katana;
    this.lastTick = this.now();
  }
  add(id, pos) {
    return this.spawn(id, pos);
  }
  spawn(id, pos) {
    const now = this.now(),
      p = {
        id,
        hp: COMBAT_RULES.hp,
        life: ++this.serial,
        pos: [...pos],
        spawn: [...pos],
        protectedUntil: now + COMBAT_RULES.protection,
        deadAt: null,
        lastDamage: now,
        lastSnap: now,
        // A map/round transition can leave one buffered snapshot from the
        // previous spawn in a reliable WebRTC channel. Give the new life a
        // short receive grace period before movement evidence is collected.
        movementGraceUntil: now + 1.2,
        spawnGraceUntil: now + 1.2,
        history: [],
        rates: new Map(),
        seen: new Set(),
        explosions: new Set(),
        grenades: 3,
        mines: 3
      };
    // A player starts with the host-approved rifle. Shots must match this
    // ledger weapon until a sanitized snapshot records a real weapon switch.
    p.snap = [...p.pos, 0, 0, 0, 64, COMBAT_RULES.hp, 0, 0, 0, 0, 0, 0, p.life];
    this.players.set(id, p);
    return this.view(p, true);
  }
  view(p, spawn = false) {
    return {
      id: p.id,
      hp: p.hp,
      life: p.life,
      protection: Math.max(0, p.protectedUntil - this.now()),
      wait: p.hp > 0 ? 0 : Math.max(0, p.deadAt + COMBAT_RULES.respawn - this.now()),
      pos: [...p.pos],
      spawn,
      lastHit: p.lastHit
    };
  }
  views() {
    return [...this.players.values()].map(p => this.view(p));
  }
  respawn(id, pos) {
    const p = this.players.get(id);
    if (!p || p.hp > 0 || this.now() < p.deadAt + COMBAT_RULES.respawn) return null;
    return this.spawn(id, pos);
  }
  snapshot(id, s) {
    const p = this.players.get(id);
    if (!p || !Array.isArray(s) || s.length !== 15 || !s.every(Number.isFinite) || !Number.isInteger(s[5]) || s[5] < 0 || s[5] >= WEAPON_ORDER.length || !Number.isInteger(s[6]) || s[6] < 0 || s[6] > 8191) return null;
    const pos = s.slice(0, 3),
      now = this.now();
    if (!vector(pos) || Math.abs(s[4]) > 1.6 || s.slice(8, 11).some(v => Math.abs(v) > 350) || Math.hypot(...s.slice(8, 11)) > COMBAT_RULES.maxSnapshotVelocity) return null;
    if (p.hp > 0 && s[14] === p.life && this.enabled()) {
      const elapsed = Math.max(.001, now - p.lastSnap), moved = dist(pos, p.pos);
      if (moved > movementLimit(elapsed) || moved / elapsed > 75) return null;
      p.pos = pos;
      p.lastSnap = now;
      p.history.push({
        pos: [...pos],
        t: now,
        crouch: !!(s[6] & 1)
      });
      p.history = p.history.filter(h => now - h.t < .4).slice(-12);
    }
    // Weapon selection is a host-owned ledger. The snapshot carries the
    // visual state, but it must never be allowed to change the weapon that
    // combat.hit will accept; otherwise a forged snapshot could bypass the
    // weapon-select message entirely.
    const out = [...s];
    out[5] = Number.isInteger(p.snap?.[5]) ? p.snap[5] : 0;
    out.splice(0, 3, ...p.pos);
    out[7] = Math.round(p.hp);
    out[14] = p.life;
    out[6] = s[6] & ~(64 | 4096 | 1024 | 2048) | (p.hp > 0 ? 64 : 0) | (now < p.protectedUntil ? 4096 : 0);
    if (!this.katana && out[5] === 3) out[5] = 0;
    if (!this.katana || out[5] !== 3) out[6] &= ~(4 | 256);
    if (p.hp <= 0 || !this.enabled()) {
      out[6] &= ~(32 | 128 | 4 | 256);
      out[8] = out[9] = out[10] = 0;
    }
    if (out[6] & 4 && !(p.snap?.[6] & 4)) p.blockAt = now;
    p.snap = out;
    return out;
  }
  allow(p, key, interval, burst = 2) {
    const now = this.now();
    let b = p.rates.get(key);
    if (!b) b = {
      t: now,
      n: burst
    };
    b.n = Math.min(burst, b.n + (now - b.t) / interval);
    b.t = now;
    p.rates.set(key, b);
    if (b.n < 1) return false;
    b.n--;
    return true;
  }
  hit(from, d) {
    const a = this.players.get(from),
      b = this.players.get(d?.target),
      spec = typeof d?.src === 'string' && Object.hasOwn(profiles, d.src) ? profiles[d.src] : null;
    const reject = reason => ({
      id: d?.id,
      amount: 0,
      reason
    });
    if (!a || !b || a === b || a.hp <= 0 || b.hp <= 0 || !spec || typeof d.id !== 'string' || d.id.length > 180 || !vector(d.point) || !vector(d.from)) return reject('invalid');
    if (!this.enabled()) return reject('round');
    if (this.friendly(from, b.id)) return reject('friendly');
    if (d.life !== b.life || d.attackerLife !== a.life) return reject('stale');
    if (a.seen.has(d.id)) return reject('duplicate');
    a.seen.add(d.id);
    if (a.seen.size > 512) a.seen.delete(a.seen.values().next().value);
    if (d.src === 'katana' && !this.katana) return reject('katana');
    const weaponIndex = WEAPON_ORDER.indexOf(d.src);
    if (a.snap?.[5] !== weaponIndex) return reject('weapon-state');
    if (dist(d.from, center(a)) > 4) return reject('origin');
    const history = [{
      pos: b.pos,
      crouch: !!(b.snap?.[6] & 1)
    }, ...b.history.filter(h => this.now() - h.t < .4)];
    const hit = history.find(h => Math.hypot(d.point[0] - h.pos[0], d.point[2] - h.pos[2]) <= .95 && d.point[1] >= h.pos[1] - .2 && d.point[1] <= h.pos[1] + (h.crouch ? 1.5 : 2.2));
    if (!hit) return reject('target');
    const distance = dist(d.from, d.point);
    if (distance > spec[3] || !this.sight(d.from, d.point)) return reject('cover');
    // The reported impact must lie on the actual shot ray. Aim is sampled in the
    // firing frame, not from a delayed pose: fast legitimate flicks remain valid.
    // These client claims are consistency checks, not proof against a full aimbot.
    if (d.src !== 'katana') {
      if (!vector(d.aim) || !vector(d.ray) || Math.abs(Math.hypot(...d.aim)-1) > .015 || Math.abs(Math.hypot(...d.ray)-1) > .015) return reject('aim');
      const dot = d.aim.reduce((sum,n,i)=>sum+n*d.ray[i],0);
      // Includes hip-fire bloom, recoil and movement spread for all guns.
      if (dot < .955) return reject('aim');
      const offset = d.point.map((n,i)=>n-d.from[i]);
      const along = offset.reduce((sum,n,i)=>sum+n*d.ray[i],0);
      if (along < 0 || Math.hypot(...offset.map((n,i)=>n-along*d.ray[i])) > .18) return reject('ray');
    }
    if (!this.allow(a, d.src, spec[2] / (spec[4] || 1), (spec[4] || 1) * 2)) return reject('rate');
    // A second global ceiling also limits cycling through weapons to bypass cadence.
    if (!this.allow(a, 'all', COMBAT_RULES.globalShotInterval, COMBAT_RULES.globalShotBurst)) return reject('rate');
    if (this.now() < b.protectedUntil) return reject('protected');
    // A short, front-facing guard can parry; a held client flag cannot grant immunity.
    if (this.katana && b.snap?.[5] === 3 && b.snap[6] & 4 && this.now() - b.blockAt < .26) {
      const dx = d.from[0] - b.pos[0],
        dz = d.from[2] - b.pos[2],
        length = Math.hypot(dx, dz);
      const facing = length > 0 ? (-Math.sin(b.snap[3]) * dx - Math.cos(b.snap[3]) * dz) / length : 0;
      if (facing > .6 && this.allow(b, 'guard', .19, 1)) return reject('blocked');
    }
    const crit = d.part === 'head' && d.point[1] - hit.pos[1] > (hit.crouch ? 1.05 : 1.45) && d.src !== 'katana';
    let amount = spec[0] * (crit ? spec[1] : 1);
    if (spec[5]) {
      const [near, far, min] = spec[5];
      amount *= Math.max(min, Math.min(1, 1 - (distance - near) / (far - near)));
    }
    amount = this.damage(b, Math.round(amount), from, {
      src: d.src,
      crit,
      from: d.from
    });
    return {
      id: d.id,
      amount,
      killed: b.hp <= 0,
      crit
    };
  }
  damage(p, amount, killer = null, info = {}) {
    if (!this.enabled() || (killer && this.friendly(killer, p?.id))) return 0;
    if (!p || p.hp <= 0 || !Number.isFinite(amount) || amount <= 0 || this.now() < p.protectedUntil) return 0;
    const actual = Math.min(p.hp, amount);
    p.hp -= actual;
    p.lastDamage = this.now();
    p.lastHit = {
      killer,
      ...info,
      amount: actual
    };
    if (p.hp <= 0) p.deadAt = this.now();
    this.changed(this.view(p));
    if (p.hp <= 0) this.died({
      victim: p.id,
      killer,
      ...info,
      amount: actual,
      life: p.life
    });
    return actual;
  }
  heal(id, amount) {
    const p = this.players.get(id);
    if (p?.hp > 0) {
      p.hp = Math.min(COMBAT_RULES.hp, p.hp + amount);
      this.changed(this.view(p));
    }
  }
  tick() {
    const now = this.now(),
      dt = Math.min(1, now - this.lastTick);
    this.lastTick = now;
    if (!this.enabled() || !this.regenerate()) return;
    for (const p of this.players.values()) if (p.hp > 0 && p.hp < COMBAT_RULES.hp && now - p.lastDamage > 4 && !(p.snap?.[6] & 128)) p.hp = Math.min(COMBAT_RULES.hp, p.hp + 14 * dt);
  }
  blast(owner, id, pos, kind) {
    const key = owner + ':' + id;
    if (!this.players.has(owner) || this.explosions.has(key) || !vector(pos)) return;
    this.explosions.set(key, this.now());
    for (const [k, t] of this.explosions) if (this.now() - t > 30) this.explosions.delete(k);
    for (const p of this.players.values()) {
      const own = p.id === owner,
        radius = kind === 'mine' ? own ? 3.9 : 6 : own ? 6.8 : 8.5,
        c = center(p),
        d = dist(pos, c);
      if (d > radius || !this.sight(pos, c)) continue;
      const amount = kind === 'mine' ? blastDamage(d, radius, own ? 25 : 90, own ? 1 : 2.8, own ? 5 : 15) : blastDamage(d, radius, own ? 36 : 85, own ? 1 : 3, own ? 5 : 15);
      this.damage(p, Math.round(amount), own ? null : owner, {
        src: kind,
        from: pos,
        crit: false
      });
    }
  }
}
