// Host-side anti-cheat evidence and enforcement.
//
// This module deliberately has no DOM or PeerJS dependency. The same rolling
// evidence logic can be moved to a dedicated authoritative server later.
// A browser-hosted room can police guests, but a malicious host still controls
// its own JavaScript and cannot be made trustworthy without a server.

export const ANTI_CHEAT_RULES = Object.freeze({
  decayPerSecond: 1.15,
  protocolStrikeKick: 3,
  protocolScoreKick: 10,
  movementWindow: 0.9,
  movementKickEvents: 3,
  aimKickScore: 11,
  aimKickEngagements: 4,
  triggerKickSamples: 5,
  triggerKickTargets: 3,
  engagementCone: 0.985,
  engagementLeaveCone: 0.93,
  triggerDelayMs: 42,
  shortAcquisitionMs: 95,
  headConvergenceRad: 0.026,
  headPointError: 0.105,
  recentAimWindow: 0.65,
  // Smooth aim-assist never produces a large snap. Detect the stronger signal:
  // a host-observed, sub-degree lock held for several snapshots while firing
  // at the head. One good shot is harmless; repeated locks across players are
  // enforcement evidence.
  trackingAlignment: 0.9992,
  trackingMinSamples: 6,
  trackingMinDuration: 0.42,
  trackingGap: 0.24,
  trackingWindow: 6,
  trackingKickEvents: 3,
  trackingKickScore: 6,
  hostHeadAngle: 0.018
});

const finite = n => Number.isFinite(n);
const vec = v => Array.isArray(v) && v.length === 3 && v.every(finite);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const magnitude = v => Math.hypot(...v);
const unit = v => {
  const m = magnitude(v);
  return m > 1e-8 ? v.map(n => n / m) : null;
};
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const sub = (a, b) => a.map((n, i) => n - b[i]);
const distance = (a, b) => magnitude(sub(a, b));

// Host snapshots use yaw around Y and pitch around X. Keeping this conversion
// here ensures all behavioral checks use one coordinate convention.
export const directionFromAngles = (yaw, pitch) => {
  if (!finite(yaw) || !finite(pitch)) return null;
  const cp = Math.cos(pitch);
  return unit([-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp]);
};

const angleBetween = (a, b) => {
  const ua = unit(a), ub = unit(b);
  return ua && ub ? Math.acos(clamp(dot(ua, ub), -1, 1)) : Infinity;
};

const safeDetails = details => {
  if (!details || typeof details !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (Array.isArray(value) && value.length <= 4 && value.every(v => typeof v === 'number' && finite(v))) out[key] = value.slice();
  }
  return out;
};

export class AntiCheat {
  constructor({ now = () => performance.now() / 1000, onKick = () => {}, onEvent = () => {} } = {}) {
    this.now = now;
    this.onKick = onKick;
    this.onEvent = onEvent;
    this.players = new Map();
  }

  ensure(id) {
    if (typeof id !== 'string' || !id) return null;
    let state = this.players.get(id);
    if (!state) {
      state = {
        id,
        score: 0,
        strikes: 0,
        events: [],
        protocol: new Map(),
        movement: [],
        engagements: new Map(),
        aimEvents: [],
        triggerSamples: [],
        trackingEvents: [],
        lock: null,
        targets: new Set(),
        previousDirection: null,
        directionHistory: [],
        angularDelta: 0,
        lastAt: this.now(),
        kicked: false
      };
      this.players.set(id, state);
    }
    return state;
  }

  remove(id) { this.players.delete(id); }

  reset(id) {
    this.players.delete(id);
    return this.ensure(id);
  }

  decay(id, at = this.now()) {
    const state = this.ensure(id);
    if (!state) return null;
    const dt = Math.max(0, at - state.lastAt);
    state.score = Math.max(0, state.score - dt * ANTI_CHEAT_RULES.decayPerSecond);
    state.lastAt = at;
    state.aimEvents = state.aimEvents.filter(e => at - e.at < 4);
    state.triggerSamples = state.triggerSamples.filter(e => at - e.at < 4);
    state.trackingEvents = state.trackingEvents.filter(e => at - e.at < ANTI_CHEAT_RULES.trackingWindow);
    state.movement = state.movement.filter(e => at - e.at < ANTI_CHEAT_RULES.movementWindow);
    for (const [target, e] of state.engagements) {
      if (at - e.lastAt > 0.35) state.engagements.delete(target);
    }
    return state;
  }

  _finishTracking(state, at) {
    const lock = state.lock;
    state.lock = null;
    if (!lock) return false;
    const duration = Math.max(0, lock.lastAt - lock.startedAt);
    if (lock.samples < ANTI_CHEAT_RULES.trackingMinSamples || duration < ANTI_CHEAT_RULES.trackingMinDuration || lock.shots < 1 || lock.headShots < 1) return false;
    const event = this._event(state, 'head-tracking-lock', 'medium', {
      targetId: lock.targetId,
      samples: lock.samples,
      duration: Number(duration.toFixed(2)),
      shots: lock.shots,
      headShots: lock.headShots,
      alignment: Number(lock.maxAlignment.toFixed(5))
    }, at);
    state.trackingEvents.push({ at, targetId: lock.targetId, event });
    state.score += 2.9;
    const uniqueTargets = new Set(state.trackingEvents.map(e => e.targetId)).size;
    if (state.trackingEvents.length >= ANTI_CHEAT_RULES.trackingKickEvents && uniqueTargets >= ANTI_CHEAT_RULES.trackingKickEvents && state.score >= ANTI_CHEAT_RULES.trackingKickScore) {
      this._kick(state, 'AIMBOT_TRACKING_HIGH_CONFIDENCE', 'repeated host-observed head locks across targets', true);
    }
    return true;
  }

  score(id) { return this.decay(id)?.score || 0; }

  // A shot ray that is absent from every recent host-observed view is not
  // allowed to reach HostCombat. Keep this preflight separate from evidence
  // recording so the host can reject the packet before applying damage.
  shotRayAllowed(id, ray, at = this.now()) {
    const state = this.decay(id, at), rayUnit = vec(ray) ? unit(ray) : null;
    if (!state || !rayUnit || !state.directionHistory.length) return true;
    return state.directionHistory.some(sample => angleBetween(sample.direction, rayUnit) <= ANTI_CHEAT_RULES.recentAimWindow);
  }

  _event(state, kind, severity, details = {}, at = this.now()) {
    const event = { kind, severity, at, ...safeDetails(details) };
    state.events.push(event);
    if (state.events.length > 96) state.events.splice(0, state.events.length - 96);
    try { this.onEvent({ playerId: state.id, ...event }); } catch { /* host logging must never break the match */ }
    return event;
  }

  _kick(state, reason, evidence, ban = true) {
    if (state.kicked) return false;
    state.kicked = true;
    try { this.onKick(state.id, { reason, ban, evidence: this.evidence(state.id) }); } catch { /* enforcement caller owns transport failures */ }
    return true;
  }

  _maybeKickProtocol(state, kind, severity, at) {
    const count = state.protocol.get(kind) || 0;
    // Legacy/unsupported message types are useful telemetry but can be emitted
    // by old clients during a version mismatch. Require a longer run for those;
    // malformed combat and forged authority packets retain the short threshold.
    const threshold = severity === 'low' ? ANTI_CHEAT_RULES.protocolStrikeKick + 5 : ANTI_CHEAT_RULES.protocolStrikeKick;
    if (severity === 'critical' || count >= threshold || state.strikes >= 5 || state.score >= ANTI_CHEAT_RULES.protocolScoreKick) {
      this._kick(state, `protocol_${String(kind).toUpperCase()}`, 'deterministic protocol violation', true);
    }
    return count;
  }

  recordProtocolViolation(id, kind = 'invalid-packet', severity = 'hard', details = {}) {
    const state = this.decay(id);
    if (!state || state.kicked) return state;
    const at = this.now();
    const count = (state.protocol.get(kind) || 0) + 1;
    state.protocol.set(kind, count);
    state.strikes += severity === 'critical' ? 2 : severity === 'low' ? 0 : 1;
    state.score += severity === 'critical' ? 8 : severity === 'medium' ? 2 : severity === 'low' ? .8 : 3;
    this._event(state, kind, severity, { count, strikes: state.strikes, ...details }, at);
    this._maybeKickProtocol(state, kind, severity, at);
    return state;
  }

  recordMovementViolation(id, { distance: moved, maxDistance, dt, reason = 'impossible-movement' } = {}) {
    const state = this.decay(id);
    if (!state || state.kicked) return state;
    const at = this.now();
    state.movement.push({ at, distance: moved, maxDistance, dt });
    this._event(state, reason, 'hard', { distance: moved, maxDistance, dt, count: state.movement.length }, at);
    state.score += 2.5;
    if (state.movement.length >= ANTI_CHEAT_RULES.movementKickEvents) this._kick(state, 'MOVEMENT_HIGH_CONFIDENCE', 'repeated impossible movement', true);
    return state;
  }

  // Feed every accepted host snapshot. Engagement entry is measured by host
  // orientation, never by a client supplied "target acquired" timestamp.
  recordSnapshot(id, { at = this.now(), position, yaw, pitch, targets = [] } = {}) {
    const state = this.decay(id, at);
    if (!state || state.kicked) return state;
    const direction = directionFromAngles(yaw, pitch);
    if (direction && state.previousDirection) state.angularDelta = angleBetween(state.previousDirection, direction);
    if (direction) state.previousDirection = direction;
    if (direction) {
      state.directionHistory.push({ at, direction });
      state.directionHistory = state.directionHistory.filter(sample => at - sample.at < 0.45).slice(-12);
    }
    state.lastSnapshot = { at, position: vec(position) ? position.slice() : null, yaw, pitch, direction };
    if (state.lock && at - state.lock.lastAt > ANTI_CHEAT_RULES.trackingGap) this._finishTracking(state, at);
    let bestLock = null;
    for (const target of Array.isArray(targets) ? targets : []) {
      if (!target || typeof target.id !== 'string' || !vec(target.position) || target.id === id) continue;
      const targetPoint = [target.position[0], target.position[1] + (target.height || 1), target.position[2]];
      const toTarget = position && vec(position) ? sub(targetPoint, position) : null;
      const alignment = direction && toTarget ? dot(direction, unit(toTarget) || [0, 0, 0]) : -1;
      const entry = state.engagements.get(target.id);
      if (alignment >= ANTI_CHEAT_RULES.engagementCone) {
        if (!entry) state.engagements.set(target.id, { enteredAt: at, lastAt: at, alignment, position: target.position.slice() });
        else Object.assign(entry, { lastAt: at, alignment, position: target.position.slice() });
      } else if (entry && alignment < ANTI_CHEAT_RULES.engagementLeaveCone) {
        state.engagements.delete(target.id);
      }
      if (alignment >= ANTI_CHEAT_RULES.trackingAlignment && (!bestLock || alignment > bestLock.alignment)) bestLock = { id: target.id, alignment };
    }
    if (bestLock) {
      if (!state.lock || state.lock.targetId !== bestLock.id) {
        if (state.lock) this._finishTracking(state, at);
        state.lock = { targetId: bestLock.id, startedAt: at, lastAt: at, samples: 1, maxAlignment: bestLock.alignment, shots: 0, headShots: 0 };
      } else {
        state.lock.lastAt = at;
        state.lock.samples++;
        state.lock.maxAlignment = Math.max(state.lock.maxAlignment, bestLock.alignment);
      }
    }
    return state;
  }

  // A shot is accepted/rejected by HostCombat first. This method only adds
  // host-observed behavioral evidence and never trusts client timing claims.
  recordShot(id, {
    at = this.now(), targetId = null, targetPosition = null, targetHeight = 1,
    point = null, ray = null, part = '', accepted = false, reason = '', acquisitionMs = null,
    triggerDelayMs = null, angularDelta = null, headError = null, immediate = false
  } = {}) {
    const state = this.decay(id, at);
    if (!state || state.kicked) return state;
    const entry = targetId ? state.engagements.get(targetId) : null;
    const measuredAcquisition = finite(acquisitionMs) ? acquisitionMs : entry ? Math.max(0, (at - entry.enteredAt) * 1000) : Infinity;
    let measuredHeadError = finite(headError) ? headError : Infinity;
    if (!finite(headError) && vec(point) && vec(targetPosition)) {
      const head = [targetPosition[0], targetPosition[1] + targetHeight, targetPosition[2]];
      measuredHeadError = distance(point, head);
    }
    const measuredDelta = finite(angularDelta) ? angularDelta : state.angularDelta;
    const hostHeadAngle = state.lastSnapshot?.position && state.lastSnapshot.direction && vec(targetPosition)
      ? angleBetween(state.lastSnapshot.direction, sub([targetPosition[0], targetPosition[1] + targetHeight, targetPosition[2]], state.lastSnapshot.position))
      : Infinity;
    const silentInconsistency = reason === 'ray' || reason === 'aim' || reason === 'silent-aim';
    if (silentInconsistency) this.recordProtocolViolation(id, 'silent-aim', 'hard', { reason });
    // A coherent client-supplied aim/ray pair can still be silently aimed at a
    // target from outside the host's recent view history. Allow a generous
    // 0.65-radian window for latency and fast human flicks, but reject a ray
    // that is absent from every recent host snapshot.
    const hasRecentView = this.shotRayAllowed(id, ray, at);
    if (!hasRecentView && !silentInconsistency && accepted) this.recordProtocolViolation(id, 'silent-aim', 'hard', { reason: 'outside-recent-view' });

    const triggerLike = measuredAcquisition <= ANTI_CHEAT_RULES.triggerDelayMs || (finite(triggerDelayMs) && triggerDelayMs <= ANTI_CHEAT_RULES.triggerDelayMs);
    const headLock = part === 'head' && measuredHeadError <= ANTI_CHEAT_RULES.headPointError;
    if (state.lock && state.lock.targetId === targetId && accepted) {
      state.lock.shots++;
      if (headLock && hostHeadAngle <= ANTI_CHEAT_RULES.hostHeadAngle) state.lock.headShots++;
    }
    const snap = measuredDelta >= 0.65;
    const extreme = headLock && measuredAcquisition <= ANTI_CHEAT_RULES.shortAcquisitionMs && (snap || immediate);
    if (triggerLike) {
      state.triggerSamples.push({ at, targetId, delay: measuredAcquisition });
      this._event(state, 'triggerbot-sample', 'low', { targetId, delay: Math.round(measuredAcquisition) }, at);
      state.score += 2.3;
    }
    if (extreme) {
      state.aimEvents.push({ at, targetId, acquisition: measuredAcquisition, error: measuredHeadError, delta: measuredDelta });
      if (targetId) state.targets.add(targetId);
      this._event(state, 'aim-pattern', 'medium', { targetId, acquisition: Math.round(measuredAcquisition), error: Number(measuredHeadError.toFixed(4)) }, at);
      state.score += 2.1;
    }
    const uniqueAimTargets = new Set(state.aimEvents.map(e => e.targetId).filter(Boolean)).size;
    const uniqueTriggerTargets = new Set(state.triggerSamples.map(e => e.targetId).filter(Boolean)).size;
    if (state.aimEvents.length >= ANTI_CHEAT_RULES.aimKickEngagements && uniqueAimTargets >= 3 && state.score >= ANTI_CHEAT_RULES.aimKickScore) {
      this._kick(state, 'AIMBOT_HIGH_CONFIDENCE', 'repeated extreme snaps and head convergence', true);
    } else if (state.triggerSamples.length >= ANTI_CHEAT_RULES.triggerKickSamples && uniqueTriggerTargets >= ANTI_CHEAT_RULES.triggerKickTargets && state.score >= ANTI_CHEAT_RULES.aimKickScore) {
      this._kick(state, 'TRIGGERBOT_HIGH_CONFIDENCE', 'repeated near-zero acquisition timing', true);
    }
    return state;
  }

  recordHitResult(id, result, context = {}) {
    return this.recordShot(id, { ...context, accepted: !!result?.amount, reason: result?.reason || '' });
  }

  evidence(id) {
    const state = this.decay(id);
    if (!state) return null;
    return {
      score: Number(state.score.toFixed(2)),
      strikes: state.strikes,
      events: state.events.slice(-24),
      protocol: Object.fromEntries(state.protocol),
      movementViolations: state.movement.length,
      aimEngagements: state.aimEvents.length,
      triggerSamples: state.triggerSamples.length,
      trackingLocks: state.trackingEvents.length,
      targets: state.targets.size
    };
  }
}
