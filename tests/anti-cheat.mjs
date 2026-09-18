import assert from 'node:assert/strict';
import { AntiCheat } from '../src/anti-cheat.js';

let now = 0;
const kicks = [];
const ac = new AntiCheat({ now: () => now, onKick: (id, info) => kicks.push({ id, info }) });
let checks = 0;
const check = (name, value) => { assert.ok(value, name); checks++; console.log(`PASS ${name}`); };

ac.recordShot('legit', { at: now, targetId: 'enemy-a', part: 'head', acquisitionMs: 80, headError: .08, angularDelta: .8, accepted: true });
check('one legitimate fast flick does not kick', !kicks.length);
ac.recordSnapshot('legit-flick', { at: now, position: [0, 0, 0], yaw: 0, pitch: 0, targets: [] });
ac.recordShot('legit-flick', { at: now + .02, ray: [0, 0, -1], accepted: true, targetId: 'enemy-a', part: 'torso' });
check('recent host view accepts a fast legitimate ray', !kicks.some(k => k.id === 'legit-flick'));
now += .1;
ac.recordShot('one-snap', { at: now, targetId: 'enemy-a', part: 'head', acquisitionMs: 30, headError: .03, angularDelta: .9, accepted: true });
check('one suspicious snap does not kick', !kicks.some(k => k.id === 'one-snap'));

for (let i = 0; i < 4; i++) {
  now += .03;
  ac.recordShot('aimbot', { at: now, targetId: `enemy-${i}`, part: 'head', acquisitionMs: 22, headError: .02, angularDelta: .9, accepted: true });
}
check('repeated perfect snaps auto-kick', kicks.some(k => k.id === 'aimbot' && k.info.reason === 'AIMBOT_HIGH_CONFIDENCE'));

for (let i = 0; i < 5; i++) {
  now += .03;
  ac.recordShot('trigger', { at: now, targetId: `target-${i % 3}`, part: 'torso', acquisitionMs: 8, accepted: true });
}
check('repeated near-zero trigger timing auto-kicks', kicks.some(k => k.id === 'trigger' && k.info.reason === 'TRIGGERBOT_HIGH_CONFIDENCE'));

now += .1;
ac.recordShot('silent', { at: now, targetId: 'enemy-a', reason: 'ray', accepted: false });
check('one impossible silent-aim ray is rejected without kick', !kicks.some(k => k.id === 'silent'));
for (let i = 0; i < 2; i++) { now += .05; ac.recordShot('silent', { at: now, targetId: 'enemy-a', reason: 'ray', accepted: false }); }
check('repeated silent-aim rays auto-kick', kicks.some(k => k.id === 'silent'));

for (let i = 0; i < 2; i++) ac.recordProtocolViolation('malformed', 'invalid-combat');
check('two malformed packets stay below enforcement threshold', !kicks.some(k => k.id === 'malformed'));
ac.recordProtocolViolation('malformed', 'invalid-combat');
check('repeated malformed packets auto-kick', kicks.some(k => k.id === 'malformed'));

ac.recordSnapshot('jitter', { position: [0, 0, 0], yaw: 0, pitch: 0, targets: [] });
check('normal jitter is not recorded as impossible movement', ac.evidence('jitter').movementViolations === 0 && !kicks.some(k => k.id === 'jitter'));
for (let i = 0; i < 3; i++) { now += .05; ac.recordMovementViolation('teleport', { distance: 1000, maxDistance: 20, dt: .05 }); }
check('repeated teleport snapshots auto-kick', kicks.some(k => k.id === 'teleport'));

now += 20;
check('suspicion score decays over time', ac.score('one-snap') === 0);
console.log(`anti-cheat: ${checks} checks passed`);
