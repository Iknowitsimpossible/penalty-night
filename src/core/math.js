export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
// Frame-rate independent easing toward a target: rate is "how fast per second".
export const ease = (rate, dt) => 1 - Math.exp(-dt * rate);
