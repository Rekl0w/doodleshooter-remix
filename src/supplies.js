// Put aerial/out-of-bounds drops on a real support surface, including rooftops.
export function pickupPosition(world, position, safeSpots) {
  const supported = point => {
    const from = point.clone(); from.y += 0.8;
    const hit = world.raycast(from, { x: 0, y: -1, z: 0 }, 180);
    if (!hit || hit.normal.y < 0.5 || hit.point.y < -10) return null;
    const result = hit.point.clone(); result.y += 0.6;
    if (world.overlapsAABB({ x: result.x - 0.25, y: result.y - 0.25, z: result.z - 0.25 }, { x: result.x + 0.25, y: result.y + 0.25, z: result.z + 0.25 })) return null;
    return result;
  };
  const ground = supported(position);
  if (ground) return ground;
  for (const spot of [...safeSpots].sort((a, b) => a.distanceToSquared(position) - b.distanceToSquared(position))) {
    const fallback = supported(spot); if (fallback) return fallback;
  }
  return null;
}

export function needsPickup(kind, player) {
  return kind === 'ammo'
    ? player.grenades < player.maxGrenades || player.ordnance?.mineStock < 3 || player.weapons.some(w => w.isGun && !w.infiniteReserve && w.reserve < w.maxReserve)
    : player.hp < player.maxHp;
}
