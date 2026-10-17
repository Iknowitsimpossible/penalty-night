export function shootoutWinner(you, cpu) {
  const ky = you.length, kc = cpu.length;
  const gy = you.filter(Boolean).length, gc = cpu.filter(Boolean).length;
  if (ky <= 5 && kc <= 5) {
    if (gy + (5 - ky) < gc) return 'cpu';
    if (gc + (5 - kc) < gy) return 'you';
    if (ky === 5 && kc === 5 && gy !== gc) return gy > gc ? 'you' : 'cpu';
    return null;
  }
  if (ky === kc && gy !== gc) return gy > gc ? 'you' : 'cpu';
  return null;
}
