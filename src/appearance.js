// Appearance is a local, per-map preference; it never changes shared geometry.
const modes = new Set(['notebook', 'solid']);
const choices = new Map();
export function appearanceFor(map) {
  if (choices.has(map)) return choices.get(map);
  let saved;
  try { saved = localStorage.getItem('doodle_appearance_' + map); } catch { /* use the map default */ }
  return modes.has(saved) ? saved : map === 'dust2' ? 'solid' : 'notebook';
}
export function saveAppearance(map, mode) {
  if (!modes.has(mode)) return false;
  choices.set(map, mode);
  try { localStorage.setItem('doodle_appearance_' + map, mode); } catch { /* keep the session choice */ }
  return true;
}
