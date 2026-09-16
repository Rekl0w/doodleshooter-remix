import assert from 'node:assert/strict';
import { HostCombat } from '../src/host-combat.js';
let checks = 0;
function check(name, v) {
  assert.ok(v, name);
  checks++;
  console.log('PASS ' + name);
}
let time = 0,
  visible = true,
  deaths = [],
  updates = [];
const c = new HostCombat({
  now: () => time,
  sight: () => visible,
  changed: v => updates.push(v),
  died: d => deaths.push(d)
});
let sequence = 0;
const setup = () => {
  time = 0;
  visible = true;
  deaths = [];
  updates = [];
  c.clear();
  c.add('a', [0, 0, 0]);
  c.add('b', [0, 0, -3]);
  time = 3;
};
const packet = (extra = {}) => ({
  id: String(++sequence),
  target: 'b',
  life: c.players.get('b').life,
  attackerLife: c.players.get('a').life,
  src: 'rifle',
  from: [0, 1.6, 0],
  point: [0, 1, -3],
  part: 'torso',
  amount: 999999,
  ...extra
});
const snap = (id, extra = {}) => {
  const p = c.players.get(id),
    s = [...p.pos, 0, 0, 0, 64, 110, 0, 0, 0, 0, 0, 0, p.life];
  for (const [k, v] of Object.entries(extra)) s[k] = v;
  return s;
};
setup();
let s = c.snapshot('b', snap('b', {
  6: 8191,
  7: 999999,
  14: 999999
}));
check('forged health, life, invisibility and protection are replaced', s[7] === 110 && s[14] === c.players.get('b').life && !(s[6] & (4096 | 1024 | 2048 | 4 | 256)));
check('NaN snapshot rejected', c.snapshot('b', snap('b', {
  0: NaN
})) === null);
check('invalid weapon rejected', c.snapshot('b', snap('b', {
  5: 99
})) === null);
check('large teleport rejected', c.snapshot('b', snap('b', {
  0: 1000
})) === null);
let d = packet(),
  result = c.hit('a', d);
check('damage is calculated by host, not amount field', result.amount === 19 && c.players.get('b').hp === 91);
check('replay applies no damage', c.hit('a', d).reason === 'duplicate' && c.players.get('b').hp === 91);
check('unknown sender rejected', c.hit('stranger', packet()).amount === 0);
check('stale victim life rejected', c.hit('a', packet({
  life: 0
})).reason === 'stale');
check('stale attacker life rejected', c.hit('a', packet({
  attackerLife: 0
})).reason === 'stale');
check('impossible muzzle origin rejected', c.hit('a', packet({
  from: [50, 1, 0]
})).reason === 'origin');
check('off-body point rejected', c.hit('a', packet({
  point: [5, 1, -3]
})).reason === 'target');
visible = false;
check('covered target rejected', c.hit('a', packet()).reason === 'cover');
visible = true;
check('unsupported weapon rejected', c.hit('a', packet({
  src: 'grenade'
})).amount === 0);
check('prototype keys are not weapons', c.hit('a', packet({
  src: 'constructor'
})).amount === 0);
check('malformed weapon object cannot throw or damage', c.hit('a', packet({
  src: {
    toString: null,
    valueOf: null
  }
})).amount === 0);
setup();
c.snapshot('b', snap('b', {
  5: 3,
  3: Math.PI,
  6: 64 | 4
}));
check('fresh front-facing katana guard can parry', c.hit('a', packet()).reason === 'blocked');
time += .3;
check('holding guard is not permanent invulnerability', c.hit('a', packet()).amount === 19);
setup();
time = 1;
check('spawn protection owned by host', c.hit('a', packet()).reason === 'protected');
time = 3;
check('client cannot extend protection', !(c.snapshot('b', snap('b', {
  6: 64 | 4096
}))[6] & 4096));
setup();
c.katana = false;
check('disabled katana rejected in combat', c.hit('a', packet({
  src: 'katana'
})).reason === 'katana');
s = c.snapshot('a', snap('a', {
  5: 3,
  6: 64 | 4 | 256
}));
check('disabled blade stance sanitized', s[5] === 0 && !(s[6] & (4 | 256)));
c.katana = true;
check('enabled katana can deal legitimate damage', c.hit('a', packet({
  src: 'katana'
})).amount === 55);
setup();
c.players.get('b').pos = [0, 0, -10];
check('long-range katana rejected', c.hit('a', packet({
  src: 'katana',
  point: [0, 1, -10]
})).reason === 'cover');
setup();
let accepted = 0;
for (let i = 0; i < 30; i++) {
  c.players.get('b').hp = 110;
  if (c.hit('a', packet()).amount) accepted++;
}
check('fire-rate burst is bounded', accepted === 2);
time += .1;
check('normal cadence recovers after burst', c.hit('a', packet()).amount === 19);
setup();
c.players.get('b').history = [{
  pos: [0, 0, -3],
  crouch: false,
  t: 2.8
}];
c.players.get('b').pos = [3, 0, -3];
check('recent target position compensates interpolation', c.hit('a', packet()).amount === 19);
time = 4;
check('expired history cannot be used to hit old position', c.hit('a', packet()).reason === 'target');
setup();
check('claimed headshot on torso remains body damage', c.hit('a', packet({
  crit: true,
  part: 'head'
})).amount === 19);
check('geometric headshot gets host multiplier', c.hit('a', packet({
  point: [0, 1.7, -3],
  part: 'head'
})).amount === 34);
setup();
const old = c.players.get('b').life;
c.hit('a', packet({
  src: 'sniper'
}));
check('host emits one death and clamps health at zero', c.players.get('b').hp === 0 && deaths.length === 1);
c.damage(c.players.get('b'), 999, 'a');
check('dead player cannot die twice', deaths.length === 1);
s = c.snapshot('b', snap('b', {
  6: 8191,
  7: 99999,
  14: old + 100
}));
check('forged living snapshot stays dead and cannot fire', s[7] === 0 && !(s[6] & (64 | 32 | 128 | 4 | 256)) && s[14] === old);
check('dead attacker cannot hit', c.hit('b', packet({
  target: 'a',
  life: c.players.get('a').life,
  attackerLife: old
})).amount === 0);
check('early respawn is denied', c.respawn('b', [0, 0, -3]) === null);
time += 2.6;
const revived = c.respawn('b', [0, 0, -3]);
check('host respawn creates new life with protection', revived.life !== old && revived.hp === 110 && revived.protection === 2);
check('living player cannot reset life', c.respawn('b', [0, 0, -3]) === null);
const previous = c.players.get('a').life;
setup();
check('round changes cannot reuse life generations', c.players.get('a').life > previous);
c.blast('a', 'bomb', [0, 1, -3], 'grenade');
const health = c.players.get('b').hp;
c.blast('a', 'bomb', [0, 1, -3], 'grenade');
check('host blast applies once', health === 25 && c.players.get('b').hp === health);
c.heal('b', 35);
check('pickup heals authoritative health', c.players.get('b').hp === 60);
c.heal('b', 999);
check('heal capped to max hp', c.players.get('b').hp === 110);
c.damage(c.players.get('b'), 20, 'a');
time += 5;
c.tick();
check('host regeneration stays bounded', c.players.get('b').hp === 104);
console.log(checks + ' host combat checks passed');
