// The settings panel: one row of segmented buttons per option, plus a sound
// switch. Changes apply at once and are saved by the caller.
import { OPTIONS } from './settings.js';

const LABELS = {
  replays: ['Replays', 'Which kicks replay by themselves. You can always replay from the card.'],
  celebrations: ['Celebrations', 'Auto keeps them short in practice and quick matches.'],
  motion: ['Motion', 'Reduced turns off camera sweeps, slow motion, confetti and fireworks.'],
  keeperHints: ['Keeper hints', 'When their taker plants a foot, a glowing zone shows where the shot is going.'],
};

export function createSettingsPanel(container, settings, onChange) {
  container.replaceChildren();
  for (const [key, choices] of Object.entries(OPTIONS)) {
    const [label, help] = LABELS[key];
    const row = document.createElement('div');
    row.className = 'set-row';
    row.innerHTML = `<div class="set-label" id="set-${key}">${label}<small>${help}</small></div>`;
    const group = document.createElement('div');
    group.className = 'seg';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-labelledby', `set-${key}`);
    for (const [value, text] of choices) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.setAttribute('role', 'radio');
      b.dataset.value = value;
      b.addEventListener('click', () => { settings[key] = value; sync(); onChange(key); });
      group.append(b);
    }
    row.append(group);
    container.append(row);
  }
  const sound = document.createElement('div');
  sound.className = 'set-row';
  sound.innerHTML = '<div class="set-label" id="set-sound">Sound<small>Crowd, kicks and whistles.</small></div>';
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'switch';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-labelledby', 'set-sound');
  toggle.addEventListener('click', () => { settings.sound = !settings.sound; sync(); onChange('sound'); });
  sound.append(toggle);
  container.append(sound);

  function sync() {
    container.querySelectorAll('.seg').forEach((group, i) => {
      const key = Object.keys(OPTIONS)[i];
      group.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === settings[key])));
    });
    toggle.setAttribute('aria-checked', String(settings.sound));
    toggle.textContent = settings.sound ? 'On' : 'Off';
  }
  sync();
  return { sync };
}
