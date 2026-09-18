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
ac.recordSnapshot('preflight', { at: now, position: [0, 0, 0], yaw: 0, pitch: 0, targets: [] });
check('host preflight rejects a ray absent from recent view', !ac.shotRayAllowed('preflight', [1, 0, 0]));
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

// Smooth tracking has no large snap for the detector to count. Feed the host
// a high-confidence head lock held over several accepted snapshots, then
// switch targets. A single good lock remains allowed; three distinct locks
// are enforced as a tracking aimbot pattern.
const trackingPitch = Math.atan2(1, 10);
for (let target = 0; target < 3; target++) {
  const targetId = `tracking-target-${target}`;
  for (let sample = 0; sample < 8; sample++) {
    now += .08;
    ac.recordSnapshot('smooth-tracker', {
      at: now,
      position: [0, 0, 0],
      yaw: 0,
      pitch: trackingPitch,
      targets: [{ id: targetId, position: [0, 0, -10], height: 1 }]
    });
  }
  now += .01;
  ac.recordShot('smooth-tracker', {
    at: now,
    targetId,
    targetPosition: [0, 0, -10],
    targetHeight: 1,
    point: [0, 1, -10],
    part: 'head',
    headError: 0,
    accepted: true
  });
  now += .05;
  ac.recordSnapshot('smooth-tracker', { at: now, position: [0, 0, 0], yaw: 0, pitch: trackingPitch, targets: [] });
}
now += .3;
ac.recordSnapshot('smooth-tracker', { at: now, position: [0, 0, 0], yaw: 0, pitch: trackingPitch, targets: [] });
check('smooth head tracking across targets auto-kicks', kicks.some(k => k.id === 'smooth-tracker' && k.info.reason === 'AIMBOT_TRACKING_HIGH_CONFIDENCE'));
check('tracking evidence is retained for host review', ac.evidence('smooth-tracker').trackingLocks === 3);

ac.recordSnapshot('steady-player', { position: [0, 0, 0], yaw: 0, pitch: trackingPitch, targets: [{ id: 'one-target', position: [0, 0, -10], height: 1 }] });
for (let sample = 0; sample < 8; sample++) {
  now += .08;
  ac.recordSnapshot('steady-player', { at: now, position: [0, 0, 0], yaw: 0, pitch: trackingPitch, targets: [{ id: 'one-target', position: [0, 0, -10], height: 1 }] });
}
now += .01;
ac.recordShot('steady-player', { at: now, targetId: 'one-target', targetPosition: [0, 0, -10], targetHeight: 1, point: [0, 1, -10], part: 'head', headError: 0, accepted: true });
now += .3;
ac.recordSnapshot('steady-player', { at: now, position: [0, 0, 0], yaw: 0, pitch: trackingPitch, targets: [] });
check('one sustained head lock does not kick a legitimate player', !kicks.some(k => k.id === 'steady-player'));

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
