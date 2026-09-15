import { ui } from './i18n.js';
// DOM heads-up display drawn in "pen" style (multiplied over the paper canvas).
export class HUD {
  constructor(root) {
    this.root = root;
    root.innerHTML = ui`
      <div class="scope" id="scope"><div class="mask"></div><div class="ring"></div><div class="cx"></div><div class="cy"></div><div class="dot"></div><div class="scope-info" id="scopeinfo"></div></div>
      <div class="focus-meter" id="focusmeter"><div class="fm-label">Katana</div><div class="fm-tube"><div class="fm-fill" id="fmfill"></div><i class="fm-f1"></i><i class="fm-f2"></i><i class="fm-f3"></i></div><div class="fm-ready" id="fmready">Dash ready</div></div>
      <div class="focus-mark" id="focusmark"><i></i><i></i><i></i><i></i></div>
      <div class="crosshair" id="crosshair"><i class="ch-t"></i><i class="ch-b"></i><i class="ch-l"></i><i class="ch-r"></i><i class="ch-dot"></i></div>
      <div class="grapple-ret" id="gret"></div><div class="gstam" id="gstam" hidden><i id="gstamfill"></i></div>
      <div class="hitmarker" id="hitmarker"><i></i><i></i></div>
      <div class="dmg-ind" id="dmg"></div>
      <div class="hud-tl"><div class="score">Score <b id="score">0</b></div><div class="combo" id="combo"></div></div>
      <div class="hud-tr"><div class="wave">Wave <b id="wave">1</b></div><div class="modifier" id="modifier"></div><div class="left"><b id="left">0</b> enemies left</div><div class="timer" id="timer"></div><div class="pvpscore" id="pvpscore" hidden></div></div><div class="board" id="board" hidden></div>
      <div class="bossbar" id="bossbar"><div class="bossname" id="bossname"></div><div class="bar big"><div class="fill red" id="bossfill"></div></div></div>
      <div class="hud-bl">
        <div class="health"><span>Health</span><div class="bar"><div class="fill" id="hpfill"></div></div><span id="hpnum">100</span></div>
        <div class="ammo"><b id="mag">30</b><span id="reserve">/120</span><span class="reloading" id="reloading"></span><span class="nades" id="nades" title="Grenade"></span></div>
        <div class="tally" id="tally"></div><div class="support-status" id="supportstatus"></div>
      </div>
      <div class="hud-br"><div class="slots" id="slots"></div><div class="weapon" id="weapon">Rifle</div><div class="hint" id="hint"></div></div>
      <div class="tip" id="tip"></div>
      <div class="message"><div class="msg-main" id="msg"></div><div class="msg-sub" id="msgsub"></div></div>
      <div class="killfeed" id="killfeed"></div>
      <div class="screen" id="screen"><div class="panel" id="panel"></div></div>`;
    this.respawn = document.createElement('div'); this.respawn.className = 'respawn'; this.respawn.hidden = true;
    this.respawnButton = document.createElement('button'); this.respawnButton.id = 'respawnBtn'; this.respawnButton.type = 'button';
    this.respawnHint = document.createElement('small'); this.respawn.append(this.respawnButton, this.respawnHint); root.append(this.respawn);
    this.respawnButton.addEventListener('click', () => this.onRespawn?.());
    const q = (id) => root.querySelector('#' + id);
    this.el = { crosshair: q('crosshair'), gret: q('gret'), hitmarker: q('hitmarker'), dmg: q('dmg'), score: q('score'), combo: q('combo'), wave: q('wave'), modifier: q('modifier'), left: q('left'), timer: q('timer'), hpfill: q('hpfill'), hpnum: q('hpnum'), mag: q('mag'), reserve: q('reserve'), reloading: q('reloading'), tally: q('tally'), weapon: q('weapon'), hint: q('hint'), supportstatus: q('supportstatus'), slots: q('slots'), tip: q('tip'), msg: q('msg'), msgsub: q('msgsub'), killfeed: q('killfeed'), screen: q('screen'), panel: q('panel'), nades: q('nades'), scope: q('scope'), focusmark: q('focusmark'), focusmeter: q('focusmeter'), fmfill: q('fmfill'), bossbar: q('bossbar'), bossname: q('bossname'), bossfill: q('bossfill'), pvpscore: q('pvpscore'), board: q('board'), gstam: q('gstam'), gstamfill: q('gstamfill') };
    this._msgT = 0; this._scope = false; this._nades = -1; this._pad = false; this.onDevice = null; this._fmShow = false; this._fmFrac = -1; this._fmReady = false; this._lastTally = -1; this._lastSlots = ''; this._ads = false; this._mode = ''; this.onScreenClick = null; this._tipT = 0;
    this.el.screen.addEventListener('click', (event) => { if (event.target.closest('.controls, .credits, a')) return; if (this.onScreenClick) this.onScreenClick(); });
  }
  // katana charge gauge: fills with katana kills, catches fire when a focus slash is ready
  setFocusMeter(show, frac, ready, label = 'Katana') {
    const m = this.el.focusmeter;
    if (show !== this._fmShow) { this._fmShow = show; m.classList.toggle('on', show); }
    if (!show) return;
    if (label !== this._fmLabel) { this._fmLabel = label; m.querySelector('.fm-label').textContent = label; }
    const f = Math.max(0, Math.min(1, frac));
    if (Math.abs(f - (this._fmFrac ?? -1)) > 0.005) { this._fmFrac = f; this.el.fmfill.style.height = (f * 100).toFixed(1) + '%'; }
    if (ready !== this._fmReady) { this._fmReady = ready; m.classList.toggle('ready', ready); }
  }
  setGrenades(n) { if (n === this._nades) return; this._nades = n; let h = ''; for (let i = 0; i < n; i++) h += '<i></i>'; this.el.nades.innerHTML = h; }
  // control labels follow whatever you touched last
  setDevice(pad) { if (pad === this._pad) return; this._pad = pad; this.root.classList.toggle('pad', pad); if (this.onDevice) this.onDevice(pad); }
  key(action) { return (this._pad ? PAD_KEYS : KB_KEYS)[action] || action; }
  setRespawn(left = null) {
    this.respawn.hidden = left == null;
    if (left == null) return;
    this.respawnButton.disabled = left > 0;
    const label = left > 0 ? ui`Respawn in ${Math.ceil(left)}` : ui('Respawn');
    if (this.respawnButton.textContent !== label) this.respawnButton.textContent = label;
    this.respawnHint.textContent = ui`Click or press ${this.key('confirm')} / Enter`;
  }
  clearMessage() { this._msgT = 0; this.el.msg.classList.remove('show'); this.el.msgsub.textContent = ''; }
  setScope(on, zoom = 1) { if (on !== this._scope) { this._scope = on; this.el.scope.classList.toggle('on', on); this.root.classList.toggle('scoped', on); } if (on) this.el.scope.querySelector('#scopeinfo').textContent = ui`${zoom}× · ${this._pad ? ui("D-pad") : ui("Wheel / + −")}: zoom`; }
  setFocusMark(x, y) {
    const m = this.el.focusmark;
    if (x == null) { m.classList.remove('on'); return; }
    m.classList.add('on'); m.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
  }
  setSpread(px) { this.el.crosshair.style.setProperty('--s', px.toFixed(1) + 'px'); }
  setCrosshairMode(mode) { this._mode = mode; this._applyCross(); }
  setAds(on) { if (on === this._ads) return; this._ads = on; this._applyCross(); }
  _applyCross() { this.el.crosshair.className = 'crosshair ' + this._mode + (this._ads ? ' ads' : ''); }
  setGrappleStamina(f) { const show = f < 0.995; if (this.el.gstam.hidden === show) this.el.gstam.hidden = !show; if (show) { this.el.gstamfill.style.width = (f * 100).toFixed(0) + '%'; this.el.gstam.classList.toggle('low', f < 0.2); } }
  grappleTarget(state) { this.el.gret.className = 'grapple-ret' + (state === 1 ? ' on' : state === 2 ? ' on attached' : ''); }
  hitmarker(kill = false, crit = false) { const h = this.el.hitmarker; h.className = 'hitmarker' + (kill ? ' kill' : '') + (crit ? ' crit' : ''); void h.offsetWidth; h.classList.add('show'); }
  setAmmo(mag, reserve, magSize, reloading = false) {
    this.el.mag.textContent = mag; this.el.reserve.textContent = '/' + reserve; this.el.reloading.textContent = reloading ? ui(" Reloading…") : mag === 0 && reserve === 0 ? ' 5 → Revolver' : '';
    if (mag !== this._lastTally) { this._lastTally = mag; let s = ''; for (let i = 0; i < Math.min(mag, 40); i++) s += '<i></i>'; this.el.tally.innerHTML = s; }
  }
  setSupport(o) {
    const status = ui`B · Mine ${o.mineStock}/3 · Placed ${o.mines.length}/4   |   Q · Grapple birds`;
    if (status !== this._support) { this._support = status; this.el.supportstatus.textContent = status; }
  }
  setKatana() { this.el.mag.textContent = '∞'; this.el.reserve.textContent = ''; this.el.reloading.textContent = ''; if (this._lastTally !== -1) { this.el.tally.innerHTML = ''; this._lastTally = -1; } }
  setSlots(slots) {
    const key = slots.map((s) => `${s.name}|${s.active ? 1 : 0}|${s.ammo}`).join(';'); if (key === this._lastSlots) return; this._lastSlots = key;
    this.el.slots.innerHTML = slots.map((s, i) => `<div class="slot${s.active ? ' active' : ''}${s.empty ? ' empty' : ''}"><span class="num">${i < 10 ? (i + 1) % 10 : '↕'}</span>${s.name}<span class="sammo">${s.ammo}</span></div>`).join('');
  }
  setHealth(hp, max) { const f = Math.max(0, hp / max); this.el.hpfill.style.width = (f * 100).toFixed(1) + '%'; this.el.hpnum.textContent = Math.ceil(hp); this.root.classList.toggle('low', f < 0.3); }
  setBoard(html) { const on = !!html; this.el.board.hidden = !on; if (on) this.el.board.innerHTML = html; }
  setPvpScore(html) { const on = !!html; this.el.pvpscore.hidden = !on; if (on) this.el.pvpscore.innerHTML = html; this.el.wave.parentElement.hidden = on; this.el.left.parentElement.hidden = on; }
  setWave(n, left) { this.el.wave.textContent = n; this.el.left.textContent = left; }
  setModifier(text) { this.el.modifier.textContent = text || ''; }
  setTimer(text) { this.el.timer.textContent = text || ''; }
  setScore(score, combo) { this.el.score.textContent = score; this.el.combo.textContent = combo > 1 ? ui("Combo x") + combo : ''; }
  setWeapon(name, hint) { this.el.weapon.textContent = name; this.el.hint.textContent = hint || ''; }
  setBoss(name, frac) { if (frac == null) { this.el.bossbar.classList.remove('show'); return; } this.el.bossbar.classList.add('show'); this.el.bossname.textContent = name; this.el.bossfill.style.width = (Math.max(0, frac) * 100).toFixed(1) + '%'; }
  tip(text, dur = 5) { this.el.tip.innerHTML = text; this.el.tip.classList.add('show'); this._tipT = dur; }
  message(main, sub = '', dur = 2.2) { const m = this.el.msg; m.textContent = main; m.classList.remove('show'); void m.offsetWidth; m.classList.add('show'); this.el.msgsub.textContent = sub; this._msgT = dur; }
  kill(text, pts) {
    const d = document.createElement('div'); d.textContent = String(text);
    if (pts > 0) { const score = document.createElement('span'); score.className = 'pts'; score.textContent = ` +${pts}`; d.appendChild(score); }
    this.el.killfeed.appendChild(d);
    setTimeout(() => d.remove(), 1700); while (this.el.killfeed.children.length > 6) this.el.killfeed.firstChild.remove();
  }
  damageFrom(angle) { const i = document.createElement('i'); i.style.transform = `rotate(${(angle * 180 / Math.PI).toFixed(1)}deg)`; this.el.dmg.appendChild(i); setTimeout(() => i.remove(), 1000); }
  showScreen(html) { this.el.panel.innerHTML = html; this.el.screen.classList.add('show'); }
  hideScreen() { this.el.screen.classList.remove('show'); }
  setGameplayVisible(v) { this.root.classList.toggle('nogame', !v); }
  update(dt) {
    if (this._msgT > 0) { this._msgT -= dt; if (this._msgT <= 0) { this.el.msg.classList.remove('show'); this.el.msgsub.textContent = ''; } }
    if (this._tipT > 0) { this._tipT -= dt; if (this._tipT <= 0) this.el.tip.classList.remove('show'); }
  }
}

export const KB_KEYS = { fire: 'LMB', aim: 'RMB', block: 'RMB', jump: 'Space', sprint: 'Shift', slide: 'C', dash: 'C', grapple: 'Q', melee: 'F', reload: 'R', grenade: 'G', focus: ui("Both mouse buttons / X"), next: ui("Wheel"), pause: 'Esc', confirm: 'Space', score: 'Tab' };
export const PAD_KEYS = { fire: 'R2', aim: 'L2', block: 'L2', jump: '✕', sprint: 'L3', slide: '○', dash: '○', grapple: 'L1', melee: 'R1', reload: '□', grenade: 'R3', focus: 'L2 + R2', next: '△', pause: 'Options', confirm: '✕', score: 'Create' };
export const CONTROLS_HTML = ui`
<details class="controls"><summary>Controls · Keyboard / Gamepad</summary>
<div class="cols">
  <div><div class="colhead">MOUSE + KEYBOARD</div>
    <div><b>WASD</b> Move &nbsp; <b>Mouse</b> Look &nbsp; <b>Shift</b> Sprint</div>
    <div><b>LMB</b> Fire / slash &nbsp; <b>RMB</b> Aim / block</div>
    <div><b>Space</b> Jump · Press again to double jump</div>
    <div><b>C</b> Slide · Dash in the air</div>
    <div><b>Hold Q</b> Grapple and reel in · Release to detach</div>
    <div><b>Release Q</b> Detach &nbsp; <b>Space</b> Leap off the rope</div>
    <div><b>F</b> Quick slash &nbsp; <b>R</b> Reload &nbsp; <b>M</b> Music</div>
    <div><b>G</b> Grenade · Hold to throw farther</div>
    <div><b>1–6 / Wheel</b> Rifle · Shotgun · Sniper · Katana · Revolver · SMG</div>
    <div><b>7</b> AK-47 &nbsp; <b>8</b> M4A1 &nbsp; <b>9</b> Dual Pistols &nbsp; <b>0</b> FAMAS</div><div><b>Wheel</b> All weapons, including M249 and DMR</div><div><b>Wheel / + − while scoped</b> Zoom in / out</div><div><b>B</b> Mine &nbsp; <b>Hold Q</b> Grapple a flying bird or duck and swing</div>
    <div><b>5</b> Revolver: unlimited reserve ammo in solo</div>
    <div><b>X / Both mouse buttons</b> Finishing dash when katana energy is full</div>
    <div><b>Esc</b> Pause &nbsp; <b>Tab</b> Online scoreboard</div>
  </div>
  <div><div class="colhead">GAMEPAD</div>
    <div><b>Left stick</b> Move &nbsp; <b>Right stick</b> Look</div>
    <div><b>R2</b> Fire / slash &nbsp; <b>L2</b> Aim / block</div>
    <div><b>✕</b> Jump &nbsp; <b>○</b> Slide / air dash</div>
    <div><b>Hold L1</b> Grapple and reel in</div>
    <div><b>Release L1</b> Detach &nbsp; <b>✕</b> Leap off the rope</div>
    <div><b>R1</b> Quick slash, then return to your weapon</div>
    <div><b>□</b> Reload &nbsp; <b>△</b> Next weapon</div>
    <div><b>D-pad down</b> Revolver &nbsp; <b>L3</b> Sprint</div>
    <div><b>R3 / D-pad up</b> Grenade</div>
    <div><b>L2 + R2</b> Dash when katana energy is full</div>
    <div><b>Options</b> Menu &nbsp; <b>Create</b> Score</div>
  </div>
</div></details>`;
