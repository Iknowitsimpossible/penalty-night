// Unseeded randomness for things that only look random (confetti, crowd,
// stars). Gameplay decisions use the seedable generator in random.js.
export const rand = (a, b) => a + Math.random() * (b - a);
export const gauss = () => {
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
