// ==================================================================
// ===== MOTION TIMING ==============================================
// ==================================================================

/**
 * The shared clock behind every animation Cartographer runs: parallax layers
 * scrolling, tiles spinning and scrolling. All of them are driven by a
 * "motion", a handful of numbers saved on the scene:
 *
 *   playing      whether it is running (Stop eases it to zero)
 *   masterSpeed  the multiplier it runs at while playing; may be negative
 *   easeSeconds  how long a change of speed takes to arrive
 *   anchorAt     server time the numbers below were taken at
 *   rampFrom     the speed actually in effect at anchorAt, eased from
 *
 * Positions are never streamed. Each client works out where things stand from
 * these numbers and the server clock, so everyone sees the same thing and a
 * reload mid-run picks up exactly where the others are. Every change folds the
 * travel so far into the anchored positions first ("rebasing"), which is what
 * keeps a change of speed from making anything jump.
 */

/** How long a change of speed takes by default, in seconds. */
export const DEFAULT_EASE_SECONDS = 2;

export function defaultMotion() {
    return {
        playing: false,
        masterSpeed: 1,
        easeSeconds: DEFAULT_EASE_SECONDS,
        anchorAt: 0,
        rampFrom: null
    };
}

/**
 * The ease used for every change of speed: smoothstep, gentle at both ends.
 * Its integral is what turns an eased speed into a distance travelled, and
 * having that in closed form is what lets every client compute the same
 * position from the same few numbers instead of stepping frame by frame.
 */
function ease(u) {
    return u * u * (3 - 2 * u);
}
function easeIntegral(u) {
    return u * u * u - (u * u * u * u) / 2;
}

/** The same ease, for anything that eases from one value to another: 0 at u=0, 1 at u>=1. */
export function easeProgress(u) {
    return u <= 0 ? 0 : (u >= 1 ? 1 : ease(u));
}

/** The master speed a motion is heading for: its setting while playing, zero when stopped. */
export function targetSpeed(motion) {
    return motion.playing ? motion.masterSpeed : 0;
}

/** The master speed actually in effect at `now`, partway through any ease. */
export function motionSpeed(motion, now) {
    const target = targetSpeed(motion);
    const from = motion.rampFrom ?? target;
    const duration = Math.max(0, Number(motion.easeSeconds) || 0);
    const elapsed = Math.max(0, now - motion.anchorAt) / 1000;
    if (duration === 0 || elapsed >= duration) return target;
    return from + (target - from) * ease(elapsed / duration);
}

/**
 * How far something of speed 1 has moved since anchorAt: the eased master
 * speed integrated over the time elapsed. During the ease it is the area
 * under the curve; after it, that plus steady travel at the target.
 */
export function motionTravel(motion, now) {
    const target = targetSpeed(motion);
    const from = motion.rampFrom ?? target;
    const duration = Math.max(0, Number(motion.easeSeconds) || 0);
    const elapsed = Math.max(0, now - motion.anchorAt) / 1000;
    if (duration === 0 || from === target) return elapsed * target;
    if (elapsed < duration) {
        const u = elapsed / duration;
        return duration * (from * u + (target - from) * easeIntegral(u));
    }
    return duration * (from + (target - from) / 2) + (elapsed - duration) * target;
}

/**
 * Re-anchor a motion at `now`, so whatever changes next eases from the speed
 * in effect right now. The caller folds positions forward with the old motion
 * before calling this.
 */
export function rebaseMotion(motion, now) {
    return { ...motion, rampFrom: motionSpeed(motion, now), anchorAt: now };
}

/** The unit vector for an angle in degrees: 0 is right, 90 down. */
export function angleVector(angle) {
    const radians = (Number(angle) || 0) * Math.PI / 180;
    return { x: Math.cos(radians), y: Math.sin(radians) };
}

/** Wrap a value into [0, size), so tile positions stay small however far things travel. */
export function wrap(value, size) {
    if (!(size > 0)) return 0;
    return ((value % size) + size) % size;
}
