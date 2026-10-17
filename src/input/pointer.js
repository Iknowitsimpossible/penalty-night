// Mouse and touch: captures a swipe (with a glowing trail) or reports a tap.
// What a press means (skip, swipe, dive) is decided by the game via onPress.
export function createPointerInput({ stage, canvas, trail }, { onPress, onSwipe }) {
  const ctx = trail.getContext('2d');
  let swipe = null, lastTrail = null, fade = 0;

  const point = (e) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, t: performance.now() };
  };
  canvas.addEventListener('pointerdown', (e) => {
    const p = point(e);
    // onPress returns 'swipe' to start capturing a swipe from this point.
    if (onPress(p, e) === 'swipe') {
      swipe = [p]; fade = 1;
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener('pointermove', (e) => { if (swipe) swipe.push(point(e)); });
  canvas.addEventListener('pointerup', (e) => {
    if (!swipe) return;
    swipe.push(point(e));
    const pts = swipe; swipe = null;
    onSwipe(pts);
  });
  canvas.addEventListener('pointercancel', () => { swipe = null; });

  return {
    cancel() { swipe = null; },
    resize(w, h, dpr) {
      trail.width = w * dpr; trail.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    // The trail follows the finger, then fades after release.
    draw(dt) {
      ctx.clearRect(0, 0, stage.clientWidth, stage.clientHeight);
      const pts = swipe || lastTrail;
      if (swipe) lastTrail = swipe; else fade = Math.max(0, fade - dt * 2.5);
      if (!pts || pts.length < 2 || fade <= 0) return;
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < pts.length; i++) {
        const a = i / pts.length;
        ctx.strokeStyle = `rgba(246,231,168,${0.85 * a * fade})`;
        ctx.lineWidth = 2 + 7 * a;
        ctx.beginPath(); ctx.moveTo(pts[i - 1].x, pts[i - 1].y); ctx.lineTo(pts[i].x, pts[i].y); ctx.stroke();
      }
    },
  };
}
