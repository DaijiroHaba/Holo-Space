// Screen-space, single-user hand interaction. No image, landmark, or identifier storage.
// update() returns state:null when no transform changed; the caller owns the state.
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const TAU = Math.PI * 2;
const wrapAngle = n => ((n + Math.PI) % TAU + TAU) % TAU - Math.PI;
const distance = (a, b, aspect = 1) => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
const center = hands => ({
  x: hands.reduce((sum, h) => sum + h.x, 0) / hands.length,
  y: hands.reduce((sum, h) => sum + h.y, 0) / hands.length,
});
const validState = s => s && ['x', 'y', 'scale', 'rotation'].every(k => Number.isFinite(s[k]))
  && (s.tilt === undefined || Number.isFinite(s.tilt))
  && (s.roll === undefined || Number.isFinite(s.roll)) && s.scale > 0;

export const SPATIAL_LIMITS = Object.freeze({minScale: .2, maxScale: 64, pan: 4});

export class SpatialController {
  constructor({reducedMotion = false} = {}) {
    this.reducedMotion = reducedMotion;
    this.reset();
  }

  reset() {
    this.active = false;
    this.blocked = false;
    this.requireRelease = false;
    this.lastTime = null;
    this.candidate = null;
    this.baseline = null;
    this.missingAt = null;
    this.neutralAt = null;
    this.coast = null;
    this.velocity = {yaw: 0, pitch: 0};
    this.lastMotionMode = null;
  }

  // UI pause can require all hands to leave before a fresh engagement.
  // Fist stop uses the default: open the fist to make re-engagement possible.
  stop({requireRelease = false} = {}) {
    this.reset();
    this.blocked = true;
    this.requireRelease = requireRelease;
  }

  result(phase, state = null, progress = 0) {
    return {state, active: this.active, phase, progress: clamp(progress, 0, 1), coasting: Boolean(this.coast)};
  }

  snapshot(hands, mode, time, delay = 0) {
    this.baseline = {key: hands.map(h => String(h.id)).join('|'), hands, mode, readyAt: time + delay};
    this.velocity = {yaw: 0, pitch: 0};
    this.coast = null;
  }

  update(hands, time, {enabled = true, canEngage = false, mode = 'rotate', state, reducedMotion = this.reducedMotion, aspect = 1, panZoom = state?.scale} = {}) {
    if (!enabled || !Number.isFinite(time) || !validState(state)) {
      this.reset();
      return this.result('idle');
    }
    const gap = this.lastTime === null ? 0 : time - this.lastTime;
    // Stale frames cannot revive a manipulation or continue its velocity.
    if (this.lastTime !== null && (gap <= 0 || gap > 300)) {
      const blocked = this.blocked;
      const requireRelease = this.requireRelease;
      this.reset();
      this.blocked = blocked;
      this.requireRelease = requireRelease;
    }
    const dt = clamp(gap / 1000, .001, .08);
    this.lastTime = time;
    mode = mode === 'move' ? 'move' : 'rotate';
    aspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
    panZoom = Number.isFinite(panZoom) && panZoom > 0 ? panZoom : state.scale;
    const seen = new Set();
    const visible = (Array.isArray(hands) ? hands : []).flatMap(h => {
      if (!h || (typeof h.id !== 'number' && typeof h.id !== 'string') || seen.has(String(h.id))) return [];
      const x = h.px ?? h.x, y = h.py ?? h.y;
      if (![x, y].every(Number.isFinite) || x < -.15 || x > 1.15 || y < -.15 || y > 1.15) return [];
      seen.add(String(h.id));
      return [{id: h.id, x, y, open: Boolean(h.open), down: Boolean(h.down), fist: Boolean(h.fist)}];
    }).slice(0, 2).sort((a, b) => String(a.id).localeCompare(String(b.id)));

    if (visible.some(h => h.fist)) {
      this.stop({requireRelease: this.requireRelease});
      this.lastTime = time;
      return this.result('stopped');
    }
    if (this.blocked) {
      if (this.requireRelease ? !visible.length : visible.some(h => h.open && !h.fist)) {
        this.blocked = false;
        this.requireRelease = false;
      }
      return this.result('stopped');
    }

    const eligible = visible.filter(h => !h.fist && (h.open || h.down));
    if (!this.active) {
      if (!canEngage || !eligible.length) {
        this.candidate = null;
        return this.result('idle');
      }
      const hand = eligible.find(h => h.down) || eligible[0];
      if (!this.candidate || this.candidate.id !== hand.id || distance(hand, this.candidate.hand) > .085) {
        this.candidate = {id: hand.id, hand, at: time};
      }
      const progress = hand.down ? 1 : (time - this.candidate.at) / 350;
      if (progress < 1) return this.result('arming', null, progress);
      this.active = true;
      this.candidate = null;
      this.snapshot(eligible, mode, time, eligible.length === 2 ? 120 : 0);
      return this.result(eligible.length === 2 ? 'arming' : mode, null, 1);
    }

    if (!visible.length) {
      if (this.missingAt === null) this.missingAt = time;
      this.baseline = null;
      this.coast = null;
      this.velocity = {yaw: 0, pitch: 0};
      this.neutralAt = null;
      if (time - this.missingAt >= 300) {
        this.reset();
        this.lastTime = time;
        return this.result('idle');
      }
      return this.result('paused');
    }
    this.missingAt = null;

    if (!eligible.length) {
      // A visible relaxed hand, held for 80ms, releases a swipe. Detection loss
      // never enters this branch. Fist is always an immediate stop.
      if (this.neutralAt === null) this.neutralAt = time;
      this.baseline = null;
      if (reducedMotion) this.coast = null;
      if (!this.coast && !reducedMotion && this.lastMotionMode === 'rotate'
          && time - this.neutralAt >= 80 && Math.hypot(this.velocity.yaw, this.velocity.pitch) > .3) {
        this.coast = {yaw: this.velocity.yaw, pitch: this.velocity.pitch, last: time};
        this.velocity = {yaw: 0, pitch: 0};
      }
      if (!this.coast) return this.result('paused');
      const seconds = clamp((time - this.coast.last) / 1000, 0, .08);
      this.coast.last = time;
      const decay = Math.exp(-6 * seconds), integral = (1 - decay) / 6;
      const next = {...state, rotation: state.rotation + this.coast.yaw * integral, tilt: (state.tilt || 0) + this.coast.pitch * integral};
      this.coast.yaw *= decay;
      this.coast.pitch *= decay;
      if (Math.hypot(this.coast.yaw, this.coast.pitch) < .04) this.coast = null;
      return this.result(this.coast ? 'coasting' : 'paused', seconds > 0 ? next : null);
    }

    this.neutralAt = null;
    this.coast = null;
    const key = eligible.map(h => String(h.id)).join('|');
    if (!this.baseline || this.baseline.key !== key || this.baseline.mode !== mode) {
      this.snapshot(eligible, mode, time, 120);
      return this.result('arming');
    }
    if (time <= this.baseline.readyAt) {
      this.baseline.hands = eligible;
      return this.result('arming', null, 1 - (this.baseline.readyAt - time) / 120);
    }
    const before = this.baseline.hands;
    this.baseline.hands = eligible;
    // A same-ID teleport is a tracking discontinuity, not a fast swipe.
    if (eligible.some((h, i) => distance(h, before[i]) > .45)) {
      this.snapshot(eligible, mode, time, 120);
      return this.result('paused');
    }
    const current = center(eligible), previous = center(before);
    const dx = current.x - previous.x, dy = current.y - previous.y;
    let next = {...state}, phase = mode;
    if (eligible.length === 2) {
      // Pair lengths and angles use video-height units so an in-plane twist on
      // a widescreen camera cannot be mistaken for a spread/shrink gesture.
      const d = distance(eligible[0], eligible[1], aspect), oldD = distance(before[0], before[1], aspect);
      if (d < .07 || oldD < .07) {
        this.velocity = {yaw: 0, pitch: 0};
        return this.result('paused');
      }
      next.scale = clamp(state.scale * Math.pow(d / oldD, 1.35), SPATIAL_LIMITS.minScale, SPATIAL_LIMITS.maxScale);
      next.x = clamp(state.x + dx * 4 / panZoom, -SPATIAL_LIMITS.pan, SPATIAL_LIMITS.pan);
      next.y = clamp(state.y - dy * 4 / panZoom, -SPATIAL_LIMITS.pan, SPATIAL_LIMITS.pan);
      const angle = Math.atan2(eligible[1].y - eligible[0].y, (eligible[1].x - eligible[0].x) * aspect);
      const oldAngle = Math.atan2(before[1].y - before[0].y, (before[1].x - before[0].x) * aspect);
      next.roll = (state.roll || 0) - wrapAngle(angle - oldAngle);
      this.velocity = {yaw: 0, pitch: 0};
      this.lastMotionMode = 'zoom';
      phase = 'zoom';
    } else if (mode === 'move') {
      next.x = clamp(state.x + dx * 4 / panZoom, -SPATIAL_LIMITS.pan, SPATIAL_LIMITS.pan);
      next.y = clamp(state.y - dy * 4 / panZoom, -SPATIAL_LIMITS.pan, SPATIAL_LIMITS.pan);
      this.velocity = {yaw: 0, pitch: 0};
      this.lastMotionMode = 'move';
    } else {
      const yaw = dx * 7.5, pitch = dy * 6;
      next.rotation = state.rotation + yaw;
      next.tilt = (state.tilt || 0) + pitch;
      const blend = 1 - Math.exp(-dt / .055);
      this.velocity.yaw += (clamp(yaw / dt, -6, 6) - this.velocity.yaw) * blend;
      this.velocity.pitch += (clamp(pitch / dt, -6, 6) - this.velocity.pitch) * blend;
      this.lastMotionMode = 'rotate';
    }
    if (Object.keys(next).every(k => next[k] === state[k] || (state[k] === undefined && next[k] === 0))) next = null;
    return this.result(phase, next, 1);
  }
}
