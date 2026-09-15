// Shared weapon IDs and combat geometry. Peers must use the same arsenal version.
export const WEAPON_ORDER = ['rifle', 'shotgun', 'sniper', 'katana', 'revolver', 'smg', 'ak47', 'm4a1', 'dual', 'famas', 'm249', 'dmr'];
export const GRENADE = Object.freeze({ radius: 8.5, innerRadius: 4.2, damage: 125, edgeDamage: 25 });
export const MELEE = Object.freeze({ range: 3.8, cosHalf: Math.cos(1.08), activeStart: 0.2, activeEnd: 0.78 });

export function blastDamage(distance, radius, damage, innerRadius = 0, edgeDamage = damage * 0.4) {
  if (distance > radius) return 0;
  const falloff = Math.max(0, Math.min(1, (distance - innerRadius) / Math.max(0.001, radius - innerRadius)));
  return damage + (edgeDamage - damage) * falloff;
}

// Sphere/cone overlap rather than requiring the target's center to enter the cone.
export function inMeleeArc(origin, direction, center, radius, range, cosHalf) {
  const x = center.x - origin.x, y = center.y - origin.y, z = center.z - origin.z;
  const distance = Math.hypot(x, y, z);
  if (distance - radius > range) return false;
  if (distance <= radius) return true;
  const dot = (x * direction.x + y * direction.y + z * direction.z) / distance;
  return Math.acos(Math.max(-1, Math.min(1, dot))) <= Math.acos(cosHalf) + Math.asin(Math.min(1, radius / distance));
}

export function ropeCorrection(excess, dt) {
  return Math.min(Math.max(0, excess), 18 * Math.max(0, dt));
}
