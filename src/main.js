import { TeamMatch, TEAMS, teamTarget } from './team-match.js';
import { TEAM_BLOCKS } from './team-maps.js';
import { ui, language, selectLanguage } from './i18n.js';
import { appearanceFor, saveAppearance } from './appearance.js';
// Game bootstrap: solo waves, free-for-all lobbies, checkpoints, scoring, screens and the loop.
// Online play is peer-to-peer: one player's browser hosts the lobby and keeps score, every
// player runs their own body. The host validates combat and owns health and respawns.
import * as THREE from 'three';
import { InkRenderer, INK, makeInkMaterial, setInk } from './render.js';
import { World } from './physics.js';
import { Input } from './input.js';
import { buildLevel, LEVELS } from './level.js';
import { NavGrid } from './nav.js';
import { Effects } from './effects.js';
import { EnemyManager, BOSSES } from './enemies.js';
import { Player } from './player.js';
import { RemotePlayer, encodeLocal } from './players.js';
import { Net } from './net.js';
import { HUD, CONTROLS_HTML } from './hud.js';
import { HostCombat, COMBAT_RULES, movementLimit, vector } from './host-combat.js';
import { AntiCheat } from './anti-cheat.js';
import { Nameplates } from './nameplates.js';
import { audio } from './audio.js';
import { inMeleeArc, WEAPON_ORDER } from './combat.js';
import { pickupPosition, needsPickup } from './supplies.js';
import { SceneClock } from './sky.js';
import { DUST_OUTLINE, DUST_ISLANDS } from './dust2.js';
import { rand, choose, clamp } from './util.js';

const canvas = document.getElementById('c');
const R = new InkRenderer(canvas);
const world = new World();
const knownMap = (k) => (LEVELS.some((m) => m.key === k) ? k : 'district');
let mapKey = knownMap(localStorage.getItem('doodle_map') || 'district');
let level = buildLevel(R.scene, world, mapKey, { arena: false });
let nav = new NavGrid(world, level.bounds, level.navCell || 1).build();
R.post.uniforms.uDesert.value = mapKey === 'dust2' ? 1 : 0;
R.setAppearance(appearanceFor(mapKey));
let loadedKey = mapKey, arenaLoaded = false;
audio.setTune(mapKey === 'mexico' ? 'mexico' : 'district');
// the map in play: solo uses the picked map, a match uses the host's choice; a rebuild wipes broken props
function setLevel(key, on, force = false) {
  if (!force && key === loadedKey && on === arenaLoaded) return; loadedKey = key; arenaLoaded = on;
  const geometries = new Set(), materials = new Set();
  for (const m of level.meshes) {
    R.scene.remove(m);
    m.traverse(o => { if (o.geometry) geometries.add(o.geometry); if (o.material) for (const mat of Array.isArray(o.material) ? o.material : [o.material]) materials.add(mat); });
  }
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  level.animated.length = 0; world.clear();
  level = buildLevel(R.scene, world, key, { arena: on }); nav = new NavGrid(world, level.bounds, level.navCell || 1).build();
  R.post.uniforms.uDesert.value = key === 'dust2' ? 1 : 0;
  R.setAppearance(appearanceFor(key));
  ctx.level = level; ctx.nav = nav; if (DEV_DEBUG && window.__game) { window.__game.level = level; window.__game.nav = nav; }
  audio.setTune(key === 'mexico' ? 'mexico' : 'district');
}
const setArena = (on) => setLevel(knownMap(net.active ? (lobby.map || mapKey) : mapKey), on);
const input = new Input(canvas);
const hud = new HUD(document.getElementById('hud'));
const effects = new Effects(R.scene, world);
const ctx = { scene: R.scene, camera: R.camera, world, level, nav, input, hud, effects, audio, renderer: R };

// ---------------- persistent bits ----------------
let best = Number(localStorage.getItem('doodle_best') || 0);
let musicWanted = localStorage.getItem('doodle_music') !== '0';
let checkpoint = Number(localStorage.getItem('doodle_checkpoint') || 0);
let myName = (localStorage.getItem('doodle_name') || '').slice(0, 14) || 'Doodle' + Math.floor(Math.random() * 90 + 10);
const settings = { sens: Number(localStorage.getItem('doodle_sens') || 100), invert: localStorage.getItem('doodle_invert') === '1' };
function applySettings() {
  input.mouseSens = 0.0022 * settings.sens / 100; input.padSensX = 3.4 * settings.sens / 100; input.padSensY = 2.6 * settings.sens / 100; input.invertY = settings.invert;
  localStorage.setItem('doodle_sens', String(settings.sens)); localStorage.setItem('doodle_invert', settings.invert ? '1' : '0');
}
// ---------------- game state ----------------
const DEFAULT_KILL_TARGET = 20, FFA_TIME = 600, RESPAWN = 2.5;
let matchLeft = FFA_TIME, clockT = 0, clockRunning = false;
const mmss = (t) => { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
const game = ctx.game = {
  state: 'start', mode: 'solo', menu: false, time: 0, hitstopT: 0, hitstopScale: 1, wave: 0, score: 0, combo: 0, comboT: 0, kills: 0, intermission: 0, queue: [], spawnT: 0, maxAlive: 6, deathT: 0,
  focus: { active: false, t: 0, chain: 0, target: null, dash: null, arm: 0, ready: false }, katanaStreak: 0, boss: null, respawnT: 0, matchT: 0, over: null, overT: 0,
  hitstop(d, s) { this.hitstopT = Math.max(this.hitstopT, d); this.hitstopScale = s; },
  addScore(pts, label) { const mult = 1 + Math.min(this.combo, 9) * 0.25; const p = Math.round(pts * mult); this.score += p; if (label) hud.kill(label, p); hud.setScore(this.score, this.combo); },
  onPlayerDeath() { endFocus(); onLocalDeath(); },
};
const online = () => game.mode === 'ffa';
const enemies = ctx.enemies = new EnemyManager(ctx);
const player = ctx.player = new Player(ctx);
player.name = myName;
const net = new Net();
const nameplates = new Nameplates(hud.root);
const remote = new Map();      // peer id -> RemotePlayer
const lobby = { matchMode: 'ffa', roundTarget: 16, killTarget: DEFAULT_KILL_TARGET, katana: true, players: new Map(), hostId: null, isPublic: true, status: '', code: '', map: null };
const validKillTarget = n => Number.isInteger(n) && n >= 1 && n <= 999;
const normalizeKillTarget = n => validKillTarget(n) ? n : DEFAULT_KILL_TARGET;
const matchTarget = () => online() && ['play', 'dying', 'over'].includes(game.state) ? normalizeKillTarget(game.killTarget) : normalizeKillTarget(lobby.killTarget);
const teamMode = () => online() && ['teams','tdm'].includes(game.matchMode);
const roundMode = () => online() && game.matchMode === 'teams';
const teamOf = id => lobby.players.get(id)?.team;
const friendly = (a,b) => teamMode() && a !== b && TEAMS.includes(teamOf(a)) && teamOf(a) === teamOf(b);
const roundLive = () => !roundMode() || game.round?.phase === 'live';
const teamMaps = ['dust2', 'foundry', 'quarter'];
let teamMatch = null, teamSyncT = 0;
const scores = new Map();      // peer id -> { name, kills, deaths }
let screen = 'main';           // which start-screen panel is showing: main | online | lobby
// The complete debug object is useful for local automated tests and development,
// but it must never become a production cheat API.
const DEV_DEBUG = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
const debugGame = { ctx, game, player, enemies, nav, world, level, hud, effects, input, net, remote, lobby, scores };
if (DEV_DEBUG) window.__game = debugGame;

const deathEvents = new Set(), hostMines = new Map(), approvedGrenades = new Map();
let combatSyncT = 0;
const combat = new HostCombat({
 enabled: roundLive, friendly, regenerate: () => !roundMode(),
 sight: (a,b) => world.hasLineOfSight(new THREE.Vector3(...a), new THREE.Vector3(...b), box => box.data.noShoot === true),
 changed: v => publishVitals(v),
 died: d => {
  // The impact origin is useful to the victim's local damage UI, but it is
  // unnecessary for a death feed and would leak the shooter's position to
  // every other guest.
  const { from: _impactOrigin, ...publicDeath } = d;
  net.send('combat-death', publicDeath); combatDeath(publicDeath); tallyDeath(d.victim, d.killer);
 }
});
function kickForCheating(id, info = {}) {
  if (!net.isHost || id === net.id) return false;
  console.warn('[anti-cheat] player removed', id, info.reason, info.evidence);
  return net.enforceKick(id, { reason: info.reason || 'anti-cheat', ban: info.ban !== false, evidence: info.evidence || null });
}
const antiCheat = new AntiCheat({
  onKick: kickForCheating,
  onEvent: event => { if (net.isHost) console.info('[anti-cheat]', event); }
});
if (DEV_DEBUG) window.__game.combat = combat;
if (DEV_DEBUG) window.__game.antiCheat = antiCheat;
ctx.controlsFrozen = () => roundMode() && !roundLive();
ctx.authorityActive = () => net.active && online();
function applyVitals(v) {
 if (!online() || !inMatch() || !v || !Number.isFinite(v.hp) || !Number.isFinite(v.life)) return;
 if (v.id !== net.id) {
  const r = remote.get(v.id); if (r) { r.hp=v.hp; r.protected=v.protection>0; r.lifeId=v.life; if(v.hp<=0)r.alive=false; }
  return;
 }
 if ((v.life !== player.lifeId || v.spawn) && v.hp > 0) {
  const wasDead = !player.alive || game.state === 'dying';
  player.reset(new THREE.Vector3(...v.pos), { preserveWorld: true }); player.lifeId=v.life; player.name=myName;
  if(level.key==='skyline'&&v.pos[1]>10){player.yaw=Math.atan2(v.pos[0],v.pos[2]);player.pitch=-.12;}
  if(wasDead && !game.over) { game.state='play';game.menu=false;game.respawnRequestAt=0;hud.hideScreen();hud.setGameplayVisible(true);hud.setRespawn();hud.clearMessage();hud.tip(ui('Spawn protection · 2 s'),1.6); }
 }
 player.maxHp=110; player.shieldT=v.protection;
 if(v.correction && v.hp>0) {player.body.pos.fromArray(v.pos);player.body.vel.set(0,0,0);}
 if(v.lastHit) {player.lastHitBy=v.lastHit.killer;player.lastHit=v.lastHit;}
 if(v.hp<player.hp && Number.isFinite(player.hp)) {
  ctx.applyingVitals=true; try {player.takeDamage(Math.min(110,player.hp-v.hp),v.lastHit?.from?new THREE.Vector3(...v.lastHit.from):null);} finally {ctx.applyingVitals=false;}
 }
 player.hp=v.hp;
 if(v.hp<=0) {if(player.alive)player.die();player.alive=false;game.respawnT=v.wait;game.respawnAt=performance.now()+v.wait*1000;}
}
// Combat-state packets still need to tell peers about health, life and spawn
// protection, but a guest must not receive everybody's exact spawn position
// through this side channel. Position is reserved for the owner; all other
// recipients get a deliberately inert coordinate and no last-hit origin.
const vitalsFor = (v, viewerId) => v?.id === viewerId ? v : { ...v, pos: [0, -100, 0], spawn: false, lastHit: null };
const viewsFor = viewerId => [...combat.players.values()].map(p => vitalsFor(combat.view(p, true), viewerId));
function publishVitals(v) {
 applyVitals(v);
 if (!net.isHost) { net.send('combat-state', v); return; }
 for (const pid of net.conns.keys()) net.sendTo(pid, 'combat-state', vitalsFor(v, pid));
}
function combatRequest(type,d) { if(!net.active||!online())return;if(net.isHost)net._emit(type,d,net.id);else net.send(type,d); }
ctx.onWeaponSwitch = index => {
 if (!net.active || !online() || !Number.isInteger(index)) return;
 if (net.isHost) {
  const p = combat.players.get(net.id); if (p?.snap) p.snap[5] = index;
 } else net.send('weapon-select', { weapon: index });
};
net.on('combat-state',(v,from)=>{if(from===net.hostId)applyVitals(v);});
net.on('combat-hit',(d,from)=>{
 if(!net.isHost||!online()||!inMatch()||game.over)return;
 // The host's local weapon switch is already in memory; mirror it into the
 // ledger before a same-frame shot, while guests must wait for a sanitized ps
 // snapshot and therefore cannot spoof a different weapon in combat-hit.
 if (from === net.id) {
  const local = combat.players.get(from), index = WEAPON_ORDER.indexOf(d?.src);
  if (local?.snap && index >= 0) local.snap[5] = index;
 }
 const rayConsistent = (() => {
  if (d?.src === 'katana' || !vector(d?.aim) || !vector(d?.ray) || !vector(d?.from) || !vector(d?.point)) return false;
  const aimLength = Math.hypot(...d.aim), rayLength = Math.hypot(...d.ray);
  if (Math.abs(aimLength - 1) > .015 || Math.abs(rayLength - 1) > .015) return false;
  const alignment = d.aim.reduce((sum, n, i) => sum + n * d.ray[i], 0);
  const offset = d.point.map((n, i) => n - d.from[i]), along = offset.reduce((sum, n, i) => sum + n * d.ray[i], 0);
  return alignment >= .955 && along >= 0 && Math.hypot(...offset.map((n, i) => n - along * d.ray[i])) <= .18;
 })();
 if (from !== net.id && rayConsistent && !antiCheat.shotRayAllowed(from, d?.ray)) {
  // The shot is blocked immediately; keep the first impossible ray as low
  // severity evidence so it does not combine with unrelated life packets to
  // remove an otherwise legitimate player.
  antiCheat.recordProtocolViolation(from, 'silent-aim', 'low', { reason: 'outside-recent-view' });
  const rejected = { id: d?.id, amount: 0, reason: 'silent-aim', target: d?.target };
  net.sendTo(from, 'combat-result', rejected);
  return;
 }
 const result={...combat.hit(from,d),target:d?.target};
 if (from !== net.id && combat.players.get(from)?.hp > 0) {
  const target = combat.players.get(d?.target); antiCheat.recordHitResult(from, result, {
   targetId: d?.target,
   targetPosition: target?.pos,
   targetHeight: (target?.snap?.[6] & 1) ? 1.45 : 1.75,
   point: d?.point,
   ray: d?.ray,
   part: d?.part,
   immediate: result.reason === 'rate'
  });
  const deterministic = { invalid: 'invalid-combat', duplicate: 'replay-hit', origin: 'impossible-origin', stale: 'forged-life', rate: 'weapon-cadence', 'weapon-state': 'forged-weapon-state', cover: 'blocked-shot', target: 'invalid-impact', friendly: 'friendly-fire' }[result.reason];
  if (deterministic) {
   const severity = result.reason === 'cover' || result.reason === 'friendly' ? 'low' : result.reason === 'invalid' || result.reason === 'origin' ? 'hard' : 'medium';
   antiCheat.recordProtocolViolation(from, deterministic, severity, { weapon: d?.src });
  }
 }
 if(from===net.id)acceptHitResult(result);else net.sendTo(from,'combat-result',result);
});
net.on('combat-respawn',(d,from)=>{
 if(!net.isHost||!inMatch()||game.over||roundMode())return;const p=combat.players.get(from);if(!p||d?.life!==p.life)return;
 const v=combat.respawn(from,arenaSpawn(from).toArray());if(v){clearHostMines(from);publishVitals(v);}else publishVitals(combat.view(p));
});
function combatDeath(d) {
 const key=d.victim+':'+d.life;if(deathEvents.has(key))return;deathEvents.add(key);if(deathEvents.size>512)deathEvents.delete(deathEvents.values().next().value);
 if(d.victim===net.id)return;
 const r=remote.get(d.victim),vn=r?.name||ui('Player'),kn=scores.get(d.killer)?.name;
 if(r){r.ragdoll(null,d.crit||d.amount>=90);audio.enemyDie(r.center);}
 const weapon=howWord(d.src),how=weapon?' · '+weapon+(d.crit?ui(' Headshot'):''):'';
 if(d.killer===net.id){game.kills++;game.addScore(100,ui('Eliminated: ')+vn+how);audio.kill(true);}
 else hud.kill(kn?kn+ui(' eliminated ')+vn+how:vn+ui(' fell off the page'),0);
}
net.on('combat-death',(d,from)=>{if(from===net.hostId)combatDeath(d);});
net.on('combat-cut',(d,from)=>{
 if(!net.isHost||!inMatch()||game.over||!roundLive()||!combat.katana||!vector(d?.point))return;
 const a=combat.players.get(from),b=combat.players.get(d.target);
 if(!a||!b||a.hp<=0||b.hp<=0||a.life!==d.life||a.snap?.[5]!==3||friendly(from,d.target)||!(b.snap?.[6]&128))return;
 const eye=new THREE.Vector3(...a.pos).add(new THREE.Vector3(0,1.6,0)),point=new THREE.Vector3(...d.point);
 const rope=new THREE.Line3(new THREE.Vector3(...b.pos).add(new THREE.Vector3(0,1.25,0)),new THREE.Vector3(...b.snap.slice(11,14)));
 if(eye.distanceTo(point)>4.4||rope.closestPointToPoint(point,true,new THREE.Vector3()).distanceTo(point)>1||!combat.sight(eye.toArray(),d.point)||!combat.allow(a,'cut',.36,1))return;
 if(d.target===net.id)net._emit('cut',{},net.id);else net.sendTo(d.target,'cut',{});
});
function allowGrenade(d,from) {
 if(!roundLive())return false;
 const p=combat.players.get(from);if(!p||p.hp<=0||!vector(d?.pos)||!vector(d?.vel)||typeof d.id!=='string'||d.id.length>100||p.grenades<=0)return false;
 if(new THREE.Vector3(...d.pos).distanceTo(new THREE.Vector3(...p.pos))>5||!combat.sight([p.pos[0],p.pos[1]+1.6,p.pos[2]],d.pos)||Math.hypot(...d.vel)>40+Math.hypot(...(p.snap?.slice(8,11)||[0,0,0]))*.5||!combat.allow(p,'grenade',.55,1))return false;
 const key=from+':'+d.id;if(approvedGrenades.has(key))return false;approvedGrenades.set(key,{owner:from,id:d.id});p.grenades--;return true;
}
ctx.authorityExplosion=(n,c)=>{
 if(!net.isHost)return;const owner=n.owner||net.id,key=n.owner?n.id:owner+':'+n.id,entry=approvedGrenades.get(key);
 if(!entry)return;approvedGrenades.delete(key);combat.blast(owner,entry.id,c.toArray(),'grenade');ctx.blastBreakables?.(c,8.5);
};
function allowMine(d,from) {
 if(!roundLive())return false;
 const p=combat.players.get(from),key=from+':'+d?.id;
 if(!p||typeof d?.id!=='string'||d.id.length>100||!vector(d.pos)||d.map!==level.key)return false;
 if(d.op==='remove'){
  // Only the owner may retract a live mine. Without this ownership check a
  // guest could erase another player's mine through a forged remove packet.
  const mine=hostMines.get(key); if(!mine||mine.owner!==from)return false;
  hostMines.delete(key); return true;
 }
 if(d.op!=='place'||p.hp<=0||p.mines<=0||hostMines.has(key)||[...hostMines.values()].filter(m=>m.owner===from).length>=4)return false;
 const minePos=new THREE.Vector3(...d.pos),ground=world.raycast({x:minePos.x,y:minePos.y+.55,z:minePos.z},{x:0,y:-1,z:0},.9);
 if(!ground||ground.normal.y<.75||Math.abs(ground.point.y-minePos.y)>.35)return false;
 if(minePos.distanceTo(new THREE.Vector3(...p.pos))>4.5||!combat.sight([p.pos[0],p.pos[1]+1.5,p.pos[2]],d.pos)||!combat.allow(p,'mine',.6,1))return false;
 hostMines.set(key,{owner:from,id:d.id,pos:[...d.pos],at:performance.now()/1000});p.mines--;return true;
}
function mineVisibleTo(viewerId, pos, owner) {
 if (viewerId === owner) return true;
 const viewer=combat.players.get(viewerId); if(!viewer||viewer.hp<=0)return false;
 const eye=new THREE.Vector3(viewer.pos[0],viewer.pos[1]+1.6,viewer.pos[2]);
 return world.hasLineOfSight(eye,new THREE.Vector3(...pos));
}
function relayMineVisual(d, owner) {
 const out={op:d.op,id:d.id,pos:[...d.pos],map:level.key,owner};
 for(const pid of net.conns.keys()) if(mineVisibleTo(pid,out.pos,owner)) net.sendTo(pid,'ordnance',out,owner);
 // The host also renders remote mines locally after validation.
 if(owner!==net.id) net._emit('ordnance',out,owner);
}
function removeHostMine(key,m,boom=false) {
 hostMines.delete(key);const d={op:boom?'boom':'remove',id:m.id,pos:m.pos,map:level.key,owner:m.owner};
 player.ordnance.receive(d,m.owner);relayMineVisual(d,m.owner);
 if(boom){const c=new THREE.Vector3(...m.pos);c.y+=.12;combat.blast(m.owner,m.id,c.toArray(),'mine');ctx.blastBreakables?.(c,6);}
}
function clearHostMines(owner) {for(const [key,m]of hostMines)if(m.owner===owner)removeHostMine(key,m);}
function tickHostMines() {
 const now=performance.now()/1000;
 for(const [key,m]of hostMines){
  if(now-m.at>90){removeHostMine(key,m);continue;}if(now-m.at<1)continue;
  const target=[...combat.players.values()].some(p=>p.id!==m.owner&&!friendly(m.owner,p.id)&&p.hp>0&&Math.hypot(p.pos[0]-m.pos[0],p.pos[1]+1-m.pos[1],p.pos[2]-m.pos[2])<3.2&&combat.sight(m.pos,[p.pos[0],p.pos[1]+1,p.pos[2]]));
  if(target)removeHostMine(key,m,true);
 }
}
const antiReject = (from, kind, details = {}, severity = 'hard') => { if (net.isHost && from !== net.id) antiCheat.recordProtocolViolation(from, kind, severity, details); return null; };
net.onProtocolViolation = (from, kind, details) => { if (net.isHost && from !== net.id) antiCheat.recordProtocolViolation(from, kind, kind === 'protocol-bypass' ? 'low' : 'hard', details); };

// A peer-to-peer browser cannot hide the map or its own source from a curious
// client, but it can avoid handing every peer the exact position of everyone
// else. The host checks line of sight per recipient and sends an away snapshot
// while a player is behind solid cover. This removes the useful wallhack data
// (position, aim, weapon, velocity and hook point) without affecting the
// authoritative host combat checks.
const hiddenSnapshot = snap => {
  const out = [...snap];
  out.splice(0, 3, 0, -100, 0);
  out[3] = out[4] = out[5] = 0;
  out[6] = (snap[6] & 64) | 2048;
  out[7] = 0;
  out[8] = out[9] = out[10] = out[11] = out[12] = out[13] = 0;
  return out;
};
const visibleSnapshotFor = (from, snap, viewerId) => {
  if (viewerId === from) return null;
  const source = combat.players.get(from), viewer = combat.players.get(viewerId);
  if (!source || !viewer || source.hp <= 0 || viewer.hp <= 0) return hiddenSnapshot(snap);
  const viewerCrouched = !!(viewer.snap?.[6] & 1);
  const sourceCrouched = !!(snap[6] & 1);
  const eye = new THREE.Vector3(viewer.pos[0], viewer.pos[1] + (viewerCrouched ? .88 : 1.6), viewer.pos[2]);
  const center = new THREE.Vector3(snap[0], snap[1] + (sourceCrouched ? .6 : 1), snap[2]);
  const head = new THREE.Vector3(snap[0], snap[1] + (sourceCrouched ? .95 : 1.55), snap[2]);
  const visible = world.hasLineOfSight(eye, center) || world.hasLineOfSight(eye, head);
  return visible ? snap : hiddenSnapshot(snap);
};
const relayPlayerSnapshot = (from, snap) => {
 if (!net.isHost) { net.send('ps', snap, true); return; }
 for (const pid of net.conns.keys()) {
  const view = visibleSnapshotFor(from, snap, pid);
  if (view) net.sendTo(pid, 'ps', view, from);
 }
};
const relayShotVisual = (from, data) => {
 if (!net.isHost) { net.send('shots', data, true); return; }
 const source = combat.players.get(from);
 if (!source?.snap) return;
 for (const pid of net.conns.keys()) {
  const view = visibleSnapshotFor(from, source.snap, pid);
  if (view && !(view[6] & 2048)) net.sendTo(pid, 'shots', data, from);
 }
 if (from !== net.id) {
  const view = visibleSnapshotFor(from, source.snap, net.id);
  if (view && !(view[6] & 2048)) net._emit('shots', data, from);
 }
};
// A movement envelope alone still permits a cheater to walk straight through
// a wall at a plausible speed. The host has the authoritative collision world,
// so reject destinations inside geometry and short straight-line crossings.
const snapshotPathViolation = (p, d) => {
 if (!d.every(Number.isFinite)) return null;
 const pos = new THREE.Vector3(d[0], d[1], d[2]);
 const crouched = !!(d[6] & 1);
 const body = { pos, halfW: .36, height: crouched ? 1.1 : 1.8 };
 if (world.overlapsBody(body)) return 'inside-collider';
 const previous = new THREE.Vector3(...p.pos), distance = previous.distanceTo(pos);
 if (distance < .18 || distance > 6) return null;
 const from = previous.clone(); from.y += crouched ? .55 : .9;
 const to = pos.clone(); to.y += crouched ? .55 : .9;
 return world.hasLineOfSight(from, to) ? null : 'through-collider';
};
net.onIngress=(msg,from)=>{
 const d=msg.d,p=combat.players.get(from);
 if(!roundLive() && !['ps','scene-ping','mine-sync','team-select','weapon-select'].includes(msg.t))return antiReject(from,'out-of-phase-packet',{type:msg.t},'medium');
 if(!['team-select','weapon-select','ps','nade','ordnance','shots','brk','mine-sync','take','scene-ping','combat-hit','combat-respawn','combat-fall','combat-cut'].includes(msg.t))return antiReject(from,'unknown-combat-packet',{type:msg.t},'hard');
 if(['team-select','mine-sync','take','scene-ping'].includes(msg.t))return {...msg,relay:false,to:undefined};
 if(msg.t==='weapon-select') {
  // A dead spectator can still have one reliable switch packet in flight
  // while a team round or the lobby is changing. It has no combat effect, so
  // discard it without turning a transport race into anti-cheat evidence.
  if (p?.hp <= 0) return null;
  if(!p || !Number.isInteger(d?.weapon) || d.weapon<0 || d.weapon>=WEAPON_ORDER.length) return antiReject(from,'invalid-weapon-select',{weapon:d?.weapon});
  if(!lobby.katana && d.weapon===3) return antiReject(from,'katana-disabled',{},'hard');
  p.snap = p.snap || [...p.pos,0,0,0,64,p.hp,0,0,0,0,0,0,0,p.life]; p.snap[5] = d.weapon;
  return null;
 }
 if(msg.t==='ps') {
  // Reliable WebRTC can deliver the final snapshot after a round has ended;
  // it is stale state with no authority effect, not a cheat signal.
  if(!inMatch())return null;
  if(!p || !Array.isArray(d) || d.length !== 15) return antiReject(from,'malformed-snapshot',{length:Array.isArray(d)?d.length:null});
  // Dead clients may keep rendering stale local state while waiting to
  // respawn. Ignore those snapshots quietly; forged life ids from a living
  // combat record remain a deterministic violation and accumulate strikes.
  if (p.hp <= 0) return null;
  const now = performance.now() / 1000;
  if (d[14] !== p.life) { if (now <= (p.spawnGraceUntil || 0)) return null; return antiReject(from,'forged-life',{expected:p.life,received:d[14]}); }
  if (!Number.isInteger(d[5]) || d[5] < 0 || d[5] >= WEAPON_ORDER.length) return antiReject(from,'invalid-weapon',{weapon:d[5]});
  if (Number.isInteger(p.snap?.[5]) && d[5] !== p.snap[5]) {
   antiCheat.recordProtocolViolation(from, 'forged-weapon-state', 'medium', { expected: p.snap[5], received: d[5] });
  }
  const velocity = Math.hypot(d[8], d[9], d[10]);
  if (velocity > COMBAT_RULES.maxSnapshotVelocity) {
   antiCheat.recordProtocolViolation(from, 'forged-velocity', 'medium', { velocity: Number(velocity.toFixed(1)) });
   net.sendTo(from,'combat-state',{...combat.view(p),correction:true});
   return null;
  }
  const moved = vector(d.slice(0,3)) ? Math.hypot(d[0]-p.pos[0],d[1]-p.pos[1],d[2]-p.pos[2]) : Infinity, dt = Math.max(.001, now - p.lastSnap), maxDistance = movementLimit(dt);
  if (p.hp > 0 && now > (p.movementGraceUntil || 0) && (moved > maxDistance || moved / dt > 75)) antiCheat.recordMovementViolation(from,{distance:moved,maxDistance,dt,reason:moved / dt > 75 ? 'impossible-speed' : 'impossible-snapshot'});
  if (p.hp > 0 && now > (p.movementGraceUntil || 0)) {
   const pathViolation = snapshotPathViolation(p, d);
   if (pathViolation) {
    // A destination inside a collider is deterministic. A short segment that
    // crosses a corner can also be produced by a legitimate packet gap, so it
    // is logged at the slower protocol threshold while the snapshot is still
    // rejected and the host position remains authoritative.
    if (pathViolation === 'inside-collider') antiCheat.recordMovementViolation(from,{distance:moved,maxDistance,dt,reason:pathViolation});
    else antiCheat.recordProtocolViolation(from,'noclip-path','low',{distance:Number(moved.toFixed(2)),dt:Number(dt.toFixed(3))});
    net.sendTo(from,'combat-state',{...combat.view(p),correction:true});
    return null;
   }
  }
  const snap=combat.snapshot(from,d);
  if(!snap){if(p)net.sendTo(from,'combat-state',{...combat.view(p),correction:true});return null;}
  antiCheat.recordSnapshot(from,{at:now,position:snap.slice(0,3),yaw:snap[3],pitch:snap[4],targets:[...combat.players.values()].filter(t=>t.id!==from&&t.hp>0).map(t=>({id:t.id,position:t.pos,height:(t.snap?.[6]&1)?1.45:1.75}))});
  relayPlayerSnapshot(from, snap);
  return {...msg,d:snap,relay:false,to:undefined};
 }
 if(msg.t==='nade'){if(!allowGrenade(d,from))return null;return {...msg,d:{id:d.id,pos:d.pos,vel:d.vel},relay:true,to:undefined};}
 if(msg.t==='ordnance'){
  if(!allowMine(d,from))return null;
  relayMineVisual(d,from); return null;
 }
 if(msg.t==='shots') {
  if(!p||p.hp<=0||!Array.isArray(d.e)||d.e.length>120||d.e.length%3!==0||!d.e.every(n=>Number.isFinite(n)&&Math.abs(n)<=2000)||!WEAPON_ORDER.includes(d.k))return antiReject(from,'invalid-shot',{weapon:d?.k});
  relayShotVisual(from, { k: d.k, e: d.e }); return null;
 }
 if(['cut','parry'].includes(msg.t))return antiReject(from,'protocol-bypass',{type:msg.t}); // Never accept unverified client knockbacks/rope cuts.
 if(msg.t==='brk'&&(!p||p.hp<=0||!Number.isInteger(d.id)||!level.breakables[d.id]||new THREE.Vector3(...p.pos).distanceTo(level.breakables[d.id].pos)>600||!world.hasLineOfSight(new THREE.Vector3(...p.pos).add(new THREE.Vector3(0,1.6,0)),level.breakables[d.id].pos,box=>box===level.breakables[d.id].box)||!combat.allow(p,'break',.08,4)))return antiReject(from,'invalid-breakable',{id:d?.id},'medium');
 if(msg.t==='fell')return antiReject(from,'unverified-fall',{},'medium');
 return msg;
};
ctx.localPeerId=()=>net.id;


ctx.reportFall = pos => {if(performance.now()-(game.fallRequestAt||0)<800)return;game.fallRequestAt=performance.now();combatRequest('combat-fall',{pos,life:player.lifeId});};
net.on('combat-fall',(d,from)=>{
 if(!net.isHost||!inMatch()||game.over||!roundLive()||!vector(d?.pos))return;
 const p=combat.players.get(from),B=level.bounds;if(!p||p.hp<=0||p.life!==d.life||!combat.allow(p,'fall',1,1))return;
 if(d.pos[1]>=-12&&d.pos[0]>=B.minX-10&&d.pos[0]<=B.maxX+10&&d.pos[2]>=B.minZ-10&&d.pos[2]<=B.maxZ+10)return;
 combat.damage(p,20,null,{src:'fall'});p.pos=level.playerStart.toArray();p.history=[];publishVitals({...combat.view(p),correction:true});
 const sc=scores.get(from);if(sc){sc.kills=Math.max(0,sc.kills-1);sendScores();net.send('feed',{event:'fell',name:sc.name});}
});
function hostPickup(d,from) {
 if(!net.isHost||!inMatch()||game.over||!roundLive())return;
 const p=pickups.find(x=>x.id===d?.id),v=combat.players.get(from);if(!p||!v||v.hp<=0)return;
 const center=new THREE.Vector3(...v.pos);center.y+=1;
 if(center.distanceTo(p.mesh.position)>3.6||!world.hasLineOfSight(center,p.mesh.position))return;
 if(p.kind==='health')combat.heal(from,35);else {v.grenades=Math.min(5,v.grenades+1);v.mines=Math.min(3,v.mines+1);}
 if(from===net.id)collectPickup(p);removePickup(p);net.send('taken',{id:d.id,collector:from});
}
function moderationHTML() {
 const waiting=game.state==='lobby';
 const rule=waiting&&net.isHost?`<label><input type="checkbox" id="katanaRule" ${lobby.katana?'checked':''}> ${ui('Allow katana')}</label>`:`<strong>${(waiting?lobby.katana:game.katanaAllowed)?ui('Katana enabled'):ui('Katana disabled')}</strong>`;
 const target=waiting&&net.isHost&&lobby.matchMode!=='teams'?`<label class="kill-target" for="killTarget">${lobby.matchMode==='tdm'?ui('Team kill target'):ui('Kill target')}<input type="number" id="killTarget" min="1" max="999" step="1" required value="${normalizeKillTarget(lobby.killTarget)}"><small>1–999</small></label>`:'';
 const players=net.isHost?lobbyRows().filter(p=>p.id!==net.id).map(p=>`<div class="moderation-row"><span>${esc(p.name)}</span><button type="button" data-kick="${esc(p.id)}" aria-label="${esc(ui('Kick')+' '+p.name)}">${ui('Kick')}</button></div>`).join(''):'';
 return `<div class="moderation" id="moderation">${modeRulesHTML(waiting)}${rule}${target}${players?`<h3>${ui('Manage players')}</h3>${players}`:''}</div>`;
}
function wireModeration() {
 wireTeamRules();
 const box=hud.el.panel.querySelector('#moderation');if(!box)return;
 box.addEventListener('click',e=>{e.stopPropagation();const b=e.target.closest('[data-kick]');if(b&&net.isHost){net.kick(b.dataset.kick);if(game.menu)showPause();}});
 box.addEventListener('keydown',e=>e.stopPropagation());
 box.querySelector('#killTarget')?.addEventListener('change',e=>{
  if(!net.isHost||game.state!=='lobby')return;
  const value=e.target.valueAsNumber;
  if(!validKillTarget(value)){e.target.reportValidity();e.target.value=normalizeKillTarget(lobby.killTarget);return;}
  lobby.killTarget=value;broadcastLobby(false);
  // Keep the focused control intact so clicking Start after typing works once.
  hud.el.panel.querySelector('h2').textContent=lobby.matchMode==='tdm'?teamHeading():ui`Free for all · Target: ${value} kills · ${lobby.players.size}/${net.maxPlayers} players`;
 });
 box.querySelector('#katanaRule')?.addEventListener('change',e=>{if(net.isHost&&game.state==='lobby'){lobby.katana=e.target.checked;broadcastLobby();}});
}


// ---------------- team elimination ----------------
function tdmTimeWinner(){const s=game.teamScores,team=s.red===s.blue?'draw':s.red>s.blue?'red':'blue';return {id:'team-'+team,team,name:teamName(team)};}
function teamName(t) { return t==='red'?ui('Red team'):t==='blue'?ui('Blue team'):ui('Draw'); }
function balancedTeam() { return [...lobby.players.values()].filter(p=>p.team==='red').length <= [...lobby.players.values()].filter(p=>p.team==='blue').length ? 'red':'blue'; }
function syncTeamColors() {
 const enabled = game.state==='lobby' ? lobby.matchMode!=='ffa' : teamMode();
 for(const [id,r]of remote){r.team=enabled?teamOf(id):null;r.ink=r.team==='red'?INK.TEAM_RED:r.team==='blue'?INK.TEAM_BLUE:INK.RED;setInk(r.mat,r.ink);}
 player.team=enabled?teamOf(net.id):null;
}
function assignTeam(id,team) {
 if(!net.isHost||game.state!=='lobby'||lobby.matchMode==='ffa'||!TEAMS.includes(team)||!lobby.players.has(id))return;
 if([...lobby.players].filter(([pid,p])=>pid!==id&&p.team===team).length>=13){lobby.status=ui('A team can have at most 13 players');broadcastLobby();return;}
 lobby.players.get(id).team=team;lobby.status='';syncTeamColors();broadcastLobby();
}
net.on('team-select',(d,from)=>assignTeam(from,d?.team));
function modeRulesHTML(waiting) {
 if(!waiting)return '';
 return `<label class="mode-rule">${ui('Game mode')}${net.isHost?`<select id="matchMode"><option value="ffa" ${lobby.matchMode==='ffa'?'selected':''}>${ui('Free for all')}</option><option value="teams" ${lobby.matchMode==='teams'?'selected':''}>${ui('Team elimination')}</option><option value="tdm" ${lobby.matchMode==='tdm'?'selected':''}>${ui('Team Deathmatch')}</option></select>`:`<strong>${lobby.matchMode==='teams'?ui('Team elimination'):lobby.matchMode==='tdm'?ui('Team Deathmatch'):ui('Free for all')}</strong>`}</label>`+
 (lobby.matchMode==='teams'?`<div class="hint">${ui('Eliminate the other team. No respawns until the next round. Friendly fire is off.')}<br>${ui('2 minutes per round · At timeout: survivors, then health · Equal teams draw')}</div>${net.isHost?`<label class="kill-target">${ui('Rounds to win')}<input id="roundTarget" type="number" min="1" max="99" step="1" value="${teamTarget(lobby.roundTarget)}"><small>1–99</small></label>`:''}`:'');
}
function wireTeamRules() {
 const panel=hud.el.panel;
 panel.querySelector('#matchMode')?.addEventListener('change',e=>{
  if(!net.isHost||game.state!=='lobby')return;lobby.matchMode=['teams','tdm'].includes(e.target.value)?e.target.value:'ffa';lobby.status='';
  if(lobby.matchMode!=='ffa'){let i=0;for(const p of lobby.players.values())p.team=TEAMS[i++%2];if(lobby.matchMode==='teams'&&!teamMaps.includes(lobby.map))lobby.map='dust2';}
  syncTeamColors();broadcastLobby();
 });
 panel.querySelector('#roundTarget')?.addEventListener('change',e=>{
  if(!net.isHost||game.state!=='lobby')return;const n=e.target.valueAsNumber;
  if(!Number.isInteger(n)||n<1||n>99){e.target.value=teamTarget(lobby.roundTarget);return;}
  lobby.roundTarget=n;broadcastLobby(false);panel.querySelector('h2').textContent=teamHeading();
 });
 for(const select of panel.querySelectorAll('[data-team-player]')){
  select.addEventListener('click',e=>e.stopPropagation());select.addEventListener('keydown',e=>e.stopPropagation());
  select.addEventListener('change',e=>{e.stopPropagation();if(net.isHost)assignTeam(select.dataset.teamPlayer,select.value);else if(select.dataset.teamPlayer===net.id)net.send('team-select',{team:select.value});});
 }
}
function teamHeading(){return `${lobby.matchMode==='teams'?ui('Team elimination'):ui('Team Deathmatch')} · ${lobby.matchMode==='teams'?ui('Rounds to win')+': '+teamTarget(lobby.roundTarget):ui('Team kill target')+': '+normalizeKillTarget(lobby.killTarget)} · ${lobby.players.size}/${net.maxPlayers}`;}
function teamLobbyHTML(){
 const host=net.isHost;
 const teams=TEAMS.map(team=>`<section class="team-roster" data-team="${team}"><h3>${teamName(team)} · ${lobbyRows().filter(p=>p.team===team).length}/13</h3>${lobbyRows().filter(p=>p.team===team).map(p=>`<div><span>${esc(p.name)}${p.id===net.id?ui(' (you)'):''}${p.id===lobby.hostId?' ♛':''}</span>${host||p.id===net.id?`<select data-team-player="${esc(p.id)}" aria-label="${esc(ui('Team')+' · '+p.name)}">${TEAMS.map(t=>`<option value="${t}" ${p.team===t?'selected':''}>${teamName(t)}</option>`).join('')}</select>`:''}</div>`).join('')}</section>`).join('');
 return `<h1>${ui('Lobby')}</h1><h2>${teamHeading()}</h2><div class="online" id="online"><div class="row"><span>${ui('Code')}</span><span class="code">${esc(String(net.isHost?(net.aliasCode||net.code):(lobby.shown||net.code)).replace(/-\d+$/,''))}</span></div><div class="team-rosters">${teams}</div>${moderationHTML()}${mapHTML(lobby.map,host)}<div class="hint">${lobby.matchMode==='teams'?ui('Teams are locked during the match. Late arrivals wait for the next round.'):ui('Respawn after each death. Every kill counts for your team. Friendly fire is off.')}</div><div class="row">${host?`<button type="button" class="big" id="startBtn">${ui('Start match')}</button>`:`<span id="hostWait">${ui('Waiting for the host to start')}</span>`}<button type="button" class="alt" id="leaveBtn">${ui('Leave')}</button></div><div class="status" id="status">${esc(lobby.status)}</div></div>`;
}
function teamBoardHTML(){
 const state=game.round;if(game.matchMode==='tdm')return `<h3>${ui('Team Deathmatch')}</h3>`+TEAMS.map(team=>`<h4 data-team="${team}">${teamName(team)} · ${game.teamScores?.[team]||0}</h4>`+sortedScores().filter(([id])=>teamOf(id)===team).map(([id,p])=>`<div><span>${esc(p.name)}</span><span>${p.kills} / ${p.deaths}</span></div>`).join('')).join('')+`<div class="foot">${ui('Team kill target')}: ${matchTarget()} · ${mmss(matchLeft)}</div>`;
 return `<h3>${ui('Team elimination')} · ${ui('Round')} ${state?.round||1}</h3>`+TEAMS.map(team=>`<h4 data-team="${team}">${teamName(team)} · ${state?.scores[team]||0}</h4>`+sortedScores().filter(([id])=>teamOf(id)===team).map(([id,p])=>`<div class="${id===net.id?'me':''}"><span>${esc(p.name)}</span><span>${p.kills} / ${p.deaths}</span></div>`).join('')).join('')+`<div class="foot">${ui('Rounds to win')}: ${state?.target||16} · ${ui('Kills / deaths')}</div>`;
}
function renderTeamHud(){
 if(game.matchMode==='tdm'){hud.setPvpScore(`<div class="team-score"><b data-team="red">${teamName('red')}<strong>${game.teamScores?.red||0}</strong></b><span>${ui('Team Deathmatch')}</span><b data-team="blue">${teamName('blue')}<strong>${game.teamScores?.blue||0}</strong></b></div><div class="target">${ui('Team kill target')}: ${matchTarget()} · ${teamName(teamOf(net.id))}</div>`);hud.setModifier('');return;}
 const s=game.round;if(!s)return;
 const status=s.phase==='freeze'?ui('Get ready'):s.phase==='intermission'?(s.result==='draw'?ui('Draw'):teamName(s.result)+ui(' wins')):ui('Round');
 hud.setPvpScore(`<div class="team-score"><b data-team="red">${teamName('red')}<strong>${s.scores.red}</strong></b><span>${ui('Round')} ${s.round}</span><b data-team="blue">${teamName('blue')}<strong>${s.scores.blue}</strong></b></div><div class="target">${ui('Rounds to win')}: ${s.target} · ${teamName(teamOf(net.id))}</div>`);
 hud.setTimer(`${status} · ${mmss(s.left)}`);
 hud.setModifier(player.alive?'':ui('Eliminated · Wait for the next round'));
}
function teamSpawnPositions(){
 // Dedicated map spawns are checked against collision so no player starts in props.
 const sets=level.teamSpawns.map(points=>points.filter(pos=>!world.overlapsBody({pos,halfW:.36,height:1.8})));
 if(sets.some(points=>points.length<13))throw new Error('Team map has fewer than 13 clear spawns per side: '+level.key);
 const counts=[0,0],out={};for(const [id,p]of lobby.players){const side=(p.team==='red'?0:1)^(teamMatch.view().swapped?1:0);out[id]=sets[side][counts[side]++].toArray();}return out;
}
function hostStartTeams(){
 if(!TEAMS.every(t=>[...lobby.players.values()].some(p=>p.team===t))){lobby.status=ui('Both teams need at least one player');renderLobby();return;}
 if(!teamMaps.includes(lobby.map))lobby.map='dust2';
 scores.clear();for(const[id,p]of lobby.players)scores.set(id,{name:p.name,kills:0,deaths:0});
 teamMatch=new TeamMatch({target:lobby.roundTarget});if(DEV_DEBUG&&window.__game)window.__game.teamMatch=teamMatch;teamMatch.startRound();hostTeamRound();sendScores();
}
function hostTeamRound(){
 setArena(true);const positions=teamSpawnPositions();
 hostMines.clear();approvedGrenades.clear();combat.clear(lobby.katana);
 for(const[id,pos]of Object.entries(positions))combat.add(id,pos);
 const d={state:teamMatch.view(),players:lobbyRows(),map:lobby.map,katana:lobby.katana,vitals:[...combat.players.values()].map(p=>combat.view(p,true))};
 applyTeamRound(d);
 for (const pid of net.conns.keys()) net.sendTo(pid, 'team-round', { ...d, vitals: viewsFor(pid) });
 teamSyncT=0;
}
function applyTeamRound(d){
 lobby.matchMode='teams';lobby.roundTarget=teamTarget(d.state.target);lobby.map=knownMap(d.map);lobby.katana=d.katana!==false;
 if(d.players){lobby.players.clear();for(const p of d.players){lobby.players.set(p.id,{name:p.name,team:p.team});if(p.id!==net.id)addRemote(p.id,p.name);}}
 game.mode='ffa';game.matchMode='teams';game.round=d.state;game.katanaAllowed=lobby.katana;net.inMatch=true;
 setArena(true);resetGame();pendingHits.clear();deathEvents.clear();shotQueue.length=0;
 game.state='play';game.menu=false;game.over=null;screen='lobby';hud.tip('',0);hud.clearMessage();hud.el.killfeed.innerHTML='';
 for(const r of remote.values()){r.lastSeen=performance.now();r.snapA=null;r.snapB=null;if(r.root)r.root.visible=false;}
 for(const v of d.vitals)applyVitals(v);
 const own=d.vitals.find(v=>v.id===net.id);
 if(own){player.yaw=own.pos[2]>0?0:Math.PI;player.pitch=0;}
 for(const id of d.broken||[]){const b=level.breakables[id];if(b)breakProp(b,null,false,true);}
 syncTeamColors();input.suppressUntilRelease(['fire','grenade','jump','confirm']);beginCommon();renderTeamHud();
 hud.message(ui('Round')+' '+d.state.round,teamName(teamOf(net.id))+' · '+(d.late?ui('Joined a match in progress'):ui('Get ready')),3);
 if(d.late)net.broadcast('mine-sync',{map:level.key});
 setTimeout(()=>{if(inMatch()&&!game.over&&!input.pointerLocked&&!input.usingGamepad){game.menu=true;showClickToPlay();}},250);
}
net.on('team-round',(d,from)=>{if(!net.isHost&&from===net.hostId)applyTeamRound(d);});
net.on('team-state',(d,from)=>{if(!net.isHost&&from===net.hostId&&game.matchMode==='tdm'&&d.mode==='tdm'){game.teamScores=d.scores;refreshScoreHud();return;}if(!net.isHost&&from===net.hostId&&roundMode()&&d.round===game.round?.round){game.round=d;renderTeamHud();}});
function addLateTeammate(id,name){
 combat.add(id,level.teamSpawns[0][0].toArray());const p=combat.players.get(id);p.hp=0;p.deadAt=performance.now()/1000;p.protectedUntil=0;
 scores.set(id,{name,kills:0,deaths:0});
 net.sendTo(id,'team-round',{state:teamMatch.view(),players:lobbyRows(),map:lobby.map,katana:lobby.katana,late:true,vitals:viewsFor(id),broken:level.breakables.filter(b=>!b.alive).map(b=>b.id)});
 publishVitals(combat.view(p));sendScores();syncTeamColors();
}
function updateTeamMatch(dt){
 if(!inMatch()||game.over)return;
 if(net.isHost&&teamMatch){
  const round=teamMatch.round,phase=teamMatch.phase;teamMatch.tick(lobby.players,combat.players);
  if(teamMatch.round!==round){hostTeamRound();return;}
  game.round=teamMatch.view();
  if(phase==='freeze'&&teamMatch.phase==='live')for(const p of combat.players.values())p.protectedUntil=0;
  teamSyncT-=dt;if(teamSyncT<=0||phase!==teamMatch.phase){net.send('team-state',game.round);teamSyncT=.25;}
  if(teamMatch.phase==='over'){const winner={id:'team-'+teamMatch.winner,team:teamMatch.winner,name:teamName(teamMatch.winner)};net.send('end',winner);endMatch(winner);return;}
 }
 renderTeamHud();
}
function spectateTeammate(){
 if(!roundMode()||player.alive||game.over||!inMatch())return;
 const teammate=[...remote.values()].find(r=>r.team===teamOf(net.id)&&r.alive&&r.snapB&&!r.away);
 player.rig.visible=false;hud.setScope(false);
 if(teammate){const c=ctx.camera;c.position.copy(teammate.eye);c.lookAt(teammate.eye.clone().add(teammate.forward));c.updateMatrixWorld();}
 // Never offer a free camera or an enemy's viewpoint to eliminated players.
}

// anything a bullet or a blade can hit besides enemies
ctx.targets = () => [player, ...remote.values()];
ctx.canHurt = (t) => online() && roundLive() && t !== player && !friendly(net.id,t.id);
ctx.raycastPlayers = (o, d, maxDist) => {
  let best = null;
  for (const t of remote.values()) {
    if (!t.alive || t.away || !t.root?.visible || !ctx.canHurt(t)) continue;
    for (let i = 0; i < t.hit.length; i++) {
      const c = t.hitSpheres[i], r = t.hit[i][1];
      _v.subVectors(c, o); const tca = _v.dot(d);
      const d2 = _v.lengthSq() - tca * tca; if (d2 > r * r) continue;
      const half = Math.sqrt(Math.max(0, r * r - d2)); if (tca + half < 0) continue;
      const tt = Math.max(0, tca - half); if (tt > maxDist) continue;
      if (!best || tt < best.dist) best = { player: t, part: t.hit[i][0], dist: tt, point: new THREE.Vector3(o.x + d.x * tt, o.y + d.y * tt, o.z + d.z * tt) };
    }
    // a raised katana sits in front of the chest: a ray that reaches it before the body is turned aside
    if (t.blocking && !net.active) {
      _bc.set(t.center.x + t.forward.x * 0.5, t.center.y + 0.3, t.center.z + t.forward.z * 0.5); const r = 0.42;
      _v.subVectors(_bc, o); const tca = _v.dot(d);
      if (tca > 0 && tca <= maxDist) { const d2 = _v.lengthSq() - tca * tca; if (d2 <= r * r) { const tt = tca - Math.sqrt(r * r - d2); if (tt >= 0 && (!best || best.player !== t || tt < best.dist)) best = { player: t, part: 'blade', dist: tt, point: new THREE.Vector3(o.x + d.x * tt, o.y + d.y * tt, o.z + d.z * tt) }; } }
    }
  }
  return best;
};
const _bc = new THREE.Vector3();
ctx.playersInArc = (pos, dir, range, cosHalf) => { const out = []; for (const t of remote.values()) { if (!t.alive || t.away || !t.root?.visible || !ctx.canHurt(t)) continue; if (!inMeleeArc(pos, dir, t.center, 0.35, range, cosHalf)) continue; if (!world.hasLineOfSight(pos, t.center)) continue; out.push(t); } return out; };
let hitSequence = 0;
const pendingHits = new Map();
function sendPlayerDamage(target, payload, feedback = null) {
  if (!ctx.canHurt(target) || !target.alive || target.away) return;
  const id = `${net.id}:${++hitSequence}`, now = performance.now();
  for (const [key, hit] of pendingHits) if (now - hit.time > 5000) pendingHits.delete(key);
  if (pendingHits.size >= 256) pendingHits.delete(pendingHits.keys().next().value);
  pendingHits.set(id, { target: target.id, time: now, feedback });
  combatRequest('combat-hit', { ...payload, id, target: target.id, life: target.lifeId, attackerLife: player.lifeId });
}
ctx.hitGrenadePlayer = (target, amount, from, explosionId, source = 'grenade') => {
  if (net.active) return; // Online blast damage is simulated by the host.
  if (!ctx.canHurt(target) || !target.alive) return;
  sendPlayerDamage(target, { amount: Math.round(amount), from: from.toArray(), by: net.id, src: source, explosionId });
};
ctx.hitPlayer = (t, dmg, info) => {
  if (!ctx.canHurt(t) || !t.alive) return;
  // a raised katana facing you parries a slash outright and turns some bullets aside
  // the bullet met the blade itself: it glances off, and now and then comes straight back at you

  if (info.part === 'blade') {
    effects.strokeBurst(info.point, INK.ORANGE, 8, 6, { life: 0.22, size: 0.035 }); audio.shieldHit(t.center);
    const ret = Math.random() < 0.4;
    if (ret) {
      effects.tracer(info.point, player.eye, INK.RED, 0.03, 0.08); hud.tip(ui("Returned to sender"), 0.9); input.rumble(0.5, 0.4, 90);
      player.lastHitBy = t.id; player.lastHit = { from: t.center.toArray(), crit: false, amount: dmg * 0.6, src: 'deflect' }; player.takeDamage(dmg * 0.6, t.center);
    } else hud.tip(ui("Deflected"), 0.7);
    net.sendTo(t.id, 'parry', { ret, by: net.id });
    return;
  }
  const facing = t.blocking ? _v.subVectors(player.center, t.center).normalize().dot(t.forward) : -1;
  const frontHit = /^(head|torso|arm|fore)/.test(info.part || '');
  // a slash is only parried by a guard that just came up and faces you
  if (!net.active && facing > 0.6 && frontHit && info.source === 'katana' && t.parryWindow) { effects.strokeBurst(info.point, INK.ORANGE, 10, 6, { life: 0.25, size: 0.04 }); audio.shieldHit(t.center); game.hitstop(0.08, 0.15); player.weapons[player.katanaIndex].cooldown = Math.max(player.weapons[player.katanaIndex].cooldown, 0.6); input.rumble(0.6, 0.3, 90); hud.tip(ui("Blocked"), 0.9); return; }
  sendPlayerDamage(t, { amount: Math.round(dmg), from: player.eye.toArray(), point: info.point.toArray(), aim: player.forward.toArray(), ray: info.dir.toArray(), part: info.part, crit: !!info.crit, src: info.source }, { point: info.point.clone(), dir: info.dir.clone() });
};
// a slash through another player's rope cuts it: their client drops the hook
const _rp = new THREE.Vector3(), _rq = new THREE.Vector3();
ctx.cutRopes = (eye, dir, range) => {
  let cut = false;
  for (const r of remote.values()) {
    if (!r.alive || !r.grappling) continue;
    _rp.set(r.body.pos.x + r.right.x * 0.35, r.body.pos.y + 1.25, r.body.pos.z + r.right.z * 0.35);
    for (let i = 0; i <= 14; i++) {
      _rq.lerpVectors(_rp, r.gPoint, i / 14).sub(eye); const t = _rq.dot(dir); if (t < 0.3 || t > range) continue;
      const lat = Math.sqrt(Math.max(0, _rq.lengthSq() - t * t)); if (lat > 0.9) continue;
      _rq.add(eye); effects.strokeBurst(_rq, INK.ORANGE, 10, 5, { life: 0.25, size: 0.035 }); combatRequest('combat-cut', {target:r.id,point:_rq.toArray(),life:player.lifeId}); hud.tip(ui("Rope cut"), 0.9); cut = true; break;
    }
  }
  return cut;
};
const _v = new THREE.Vector3();
// breakable props: bullets, blades and blasts break them, and everyone in a match sees it go
ctx.breakHit = (br, dmg, point, dir) => {
  if (!br.alive) return; br.hp -= dmg;
  if (br.hp <= 0) breakProp(br, dir, true); else { effects.strokeBurst(point, br.ink, 5, 4, { life: 0.2, size: 0.03 }); audio.shieldHit(point); }
};
ctx.breakablesInArc = (pos, dir, range, cosHalf) => level.breakables.filter(br => br.alive && inMeleeArc(pos, dir, br.pos, 0.5, range, cosHalf) && world.hasLineOfSight(pos, br.pos, box => box === br.box));
ctx.blastBreakables = (c, R) => { const visible = level.breakables.filter(br => br.alive && br.pos.distanceTo(c) < R && world.hasLineOfSight(c, br.pos, box => box === br.box)); for (const br of visible) breakProp(br, br.pos.clone().sub(c).normalize(), true); };
function breakProp(br, dir, local, quiet = false) {
  if (!br.alive) return; br.alive = false; world.removeBox(br.box);
  const g = br.group, pos = br.pos; const d = dir && dir.lengthSq() > 0.01 ? dir.clone().normalize() : new THREE.Vector3(rand(-1, 1), 1, rand(-1, 1)).normalize();
  if (quiet) { R.scene.remove(g); return; }
  g.updateMatrixWorld(true);
  for (const child of [...g.children]) {
    child.updateWorldMatrix(true, false); R.scene.attach(child);
    const v = d.clone().multiplyScalar(rand(2, 6)); v.x += rand(-3, 3); v.z += rand(-3, 3); v.y += rand(2.5, 6.5);
    effects.debris(child, child.position, v, new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)), { radius: 0.14, blood: false, life: rand(6, 9) });
  }
  R.scene.remove(g);
  const up = new THREE.Vector3(0, 1, 0);
  if (br.kind === 'pinata') {
    for (const ink of [INK.PINK, INK.ORANGE, INK.GREEN]) effects.strokeBurst(pos, ink, 16, 7, { life: 0.7, size: 0.05 });
    effects.explosion(pos, 2.5, INK.PINK); if (!net.active || net.isHost) for (let i = 0; i < 2; i++) spawnPickup('health', pos.clone().add(new THREE.Vector3(rand(-1.2, 1.2), 0, rand(-1.2, 1.2))));
    if (game.mode === 'solo') game.addScore(25, 'Piñata');
  } else if (br.kind === 'cactus') { effects.blood(pos, d, 1.4, { ink: INK.GREEN }); effects.bloodPool(new THREE.Vector3(pos.x, 0, pos.z), 1.1, INK.GREEN); }
  else { effects.strokeBurst(pos, br.ink, 12, 5, { life: 0.35, size: 0.04 }); effects.smoke(pos, up, 3); }
  audio.smash(pos, br.kind === 'barrel' || br.kind === 'crate' || br.kind === 'cactus');
  if (local && net.active) net.broadcast('brk', { id: br.id });
}
// every ray a gun fires this tick is sent to the others, who draw it as a tracer from the shooter's gun
const shotQueue = [];
ctx.onShot = (end) => { if (net.active && inMatch()) shotQueue.push(+end.x.toFixed(1), +end.y.toFixed(1), +end.z.toFixed(1)); };
const TRACER_THICK = { rifle: 0.02, shotgun: 0.014, sniper: 0.03, revolver: 0.026, smg: 0.016 };
const _sm = new THREE.Vector3(), _se = new THREE.Vector3();

// ---------------- pickups ----------------
const pickups = []; let pickupId = 1;
const pmat = { ammo: makeInkMaterial({ ink: INK.BLUE }), health: makeInkMaterial({ ink: INK.GREEN }), cap: makeInkMaterial({ ink: INK.BLACK }), shell: makeInkMaterial({ ink: INK.ORANGE }) };
function makePickup(kind) {
  const g = new THREE.Group();
  if (kind === 'ammo') { g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.5, 10), pmat.ammo)); const c = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 8), pmat.cap); c.position.y = 0.33; g.add(c); const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.02), pmat.cap); l.position.set(0, 0, 0.24); g.add(l); }
  else if (level.key === 'mexico') { const sh = new THREE.CylinderGeometry(0.42, 0.42, 0.22, 12, 1, false, 0, Math.PI); sh.rotateZ(Math.PI / 2); sh.rotateX(-Math.PI / 2); g.add(new THREE.Mesh(sh, pmat.shell)); const f = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.1, 0.2), pmat.health); f.position.y = 0.02; g.add(f); const m = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.08, 0.14), pmat.cap); m.position.y = 0.1; g.add(m); }
  else { g.add(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.2, 0.2), pmat.health), new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.6, 0.2), pmat.health)); }
  return g;
}
function spawnPickup(kind, pos, id = null) {
  const position = pickupPosition(world, pos, [...level.pickups, level.playerStart]); if (!position) return null;
  const m = makePickup(kind); m.position.copy(position); R.scene.add(m);
  const p = { id: id ?? pickupId++, kind, mesh: m, base: m.position.y, t: rand(0, 6), life: 90 }; pickups.push(p);
  if (net.isHost) net.send('pickup', { id: p.id, kind, pos: [position.x, position.y - 0.6, position.z] });
  return p;
}
function removePickup(p) { R.scene.remove(p.mesh); const i = pickups.indexOf(p); if (i >= 0) pickups.splice(i, 1); }
function collectPickup(p) {
  if (p.kind === 'ammo') { player.addAmmoAll(0.4); player.ordnance.resupply(); player.grenades = Math.min(player.maxGrenades, player.grenades + 1); hud.kill(ui("+Ammo · +Grenade"), 0); } else { if(!net.active) player.hp = Math.min(player.maxHp, player.hp + 35); hud.kill(level.key === 'mexico' ? ui("Taco · +35 health") : ui("+35 health"), 0); }
  audio.pickup(); effects.strokeBurst(p.mesh.position, p.kind === 'ammo' ? INK.BLUE : INK.GREEN, 12, 4, { life: 0.3 });
}
function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i]; p.t += dt; p.mesh.position.y = p.base + Math.sin(p.t * 2.5) * 0.12; p.mesh.rotation.y += dt * 1.8;
    const wanted = player.alive && needsPickup(p.kind, player);
    const distance = p.mesh.position.distanceTo(player.center);
    const visible = wanted && distance < 3.5 && world.hasLineOfSight(p.mesh.position, player.center);
    if (!net.active && visible && distance >= 1.8) { const pull = 1 - Math.exp(-8 * dt); p.mesh.position.x += (player.center.x - p.mesh.position.x) * pull; p.mesh.position.z += (player.center.z - p.mesh.position.z) * pull; p.base += (player.center.y - p.base) * pull; }
    if (visible && distance < 1.8) {
      if(net.active) {if(!p.requested || performance.now()-p.requested>1000){p.requested=performance.now();if(net.isHost)hostPickup({id:p.id},net.id);else net.send('take',{id:p.id});}}
      else {collectPickup(p);removePickup(p);}
      continue;
    }
    if (!net.active || net.isHost) { p.life -= dt; if (p.life <= 0) { removePickup(p); if (net.isHost) net.send('taken', { id: p.id }); } }
  }
}
let pickupClock = 0;
function updateArenaPickups(dt) {
  if (!net.isHost || !roundLive() || !level.pickups.length) return; pickupClock -= dt;
  if (pickupClock <= 0 && pickups.length < 10) { pickupClock = 7; spawnPickup('ammo', choose(level.pickups)); }
}

// ---------------- solo waves ----------------
const ROSTER = [
  { t: 'grunt', from: 1, w: 10 }, { t: 'rusher', from: 2, w: 6 }, { t: 'bomber', from: 3, w: 3 },
  { t: 'sniper', from: 3, w: 4 }, { t: 'flyer', from: 4, w: 4 }, { t: 'heavy', from: 5, w: 4 }, { t: 'shield', from: 6, w: 4 },
];
const MODIFIERS = [
  { name: '', apply: () => { enemies.mods.speed = 1; enemies.mods.damage = 1.2; enemies.mods.incomingDamage = 1.2; } },
  { name: ui("Caffeine · Faster enemies"), apply: () => { enemies.mods.speed = 1.35; enemies.mods.damage = 1.02; enemies.mods.incomingDamage = 1.2; } },
  { name: ui("Dark ink · Stronger attacks"), apply: () => { enemies.mods.speed = 0.9; enemies.mods.damage = 1.68; enemies.mods.incomingDamage = 1.2; } },
  { name: ui("Swarm · More enemies, less health"), swarm: true, apply: () => { enemies.mods.speed = 1.15; enemies.mods.damage = 1.08; enemies.mods.incomingDamage = 1.5; } },
];
const tips = () => [
  ui`Grapple: <b>${hud.key('grapple')}</b> hold to reel in · Release to detach`,
  ui`Out of ammo? Press <b>${hud._pad ? ui("D-pad down") : '5'}</b>: revolver with unlimited reserve ammo`,
  ui("Katana kills refill ammo · Press F to slash and return to your gun"),
  ui`<b>${hud.key('grenade')}</b> hold: trajectory and blast preview`,
  ui`In the air, press again <b>${hud.key('jump')}</b>: double jump`,
];
const bossFor = (n) => BOSSES[(Math.floor(n / 5) - 1) % BOSSES.length];
const enemyName = (t) => ({ boss: ui("Doodler"), eraser: ui("Eraser"), inkblot: ui("Inkblot") })[t] || t.toUpperCase();
function startWave(n) {
  player.ordnance.resupply();
  game.wave = n; game.queue = []; game.spawnT = 2; game.intermission = 0; game.boss = null; hud.setBoss(null, null);
  const boss = n > 0 && n % 5 === 0;
  const allowed = boss || n < 4 ? 1 : n < 6 ? 3 : MODIFIERS.length; const mod = MODIFIERS[Math.floor(Math.random() * allowed)];
  mod.apply(); hud.setModifier(mod.name);
  const swarm = !!mod.swarm;
  // the crowd on screen and the wave size both keep growing with the wave number
  game.maxAlive = Math.min(4 + Math.floor(n * 0.9) + (swarm ? 3 : 0), (swarm ? 22 : 18) + Math.floor(n / 3));
  let count = Math.round(Math.min(5 + n * 2.0, 32 + n) * (swarm ? 1.35 : 1));
  if (boss) { count = 7 + n; game.maxAlive += 2 + Math.floor(n / 5); game.queue.push(bossFor(n)); }
  game.maxAlive = Math.min(game.maxAlive, 28);
  const pool = ROSTER.filter((r) => n >= r.from).map((r) => ({ t: r.t, w: r.w * Math.min(1, 0.3 + 0.25 * (n - r.from)) }));
  const total = pool.reduce((a, r) => a + r.w, 0);
  for (let i = 0; i < count; i++) { let r = Math.random() * total, t = pool[0].t; for (const c of pool) { r -= c.w; if (r <= 0) { t = c.t; break; } } game.queue.push(t); }
  if (boss) { hud.message(ui("WAVE ") + n, enemyName(bossFor(n)) + ui(" approaching"), 3); audio.bossRoar(player.center); }
  else hud.message(ui("WAVE ") + n, n === 1 ? ui("The first enemies are coming · Keep moving") : mod.name || choose([ui("Break the line"), ui("Let the ink flow"), ui("Take to the rooftops"), ui("Earn ammo with katana kills"), ui("Deflect bullets back")]), 2.6);
  audio.wave();
  if (n <= tips().length) hud.tip(tips()[n - 1], 7);
  player.grenades = Math.min(player.maxGrenades, player.grenades + 1);
  player.addAmmoAll(0.1);
  for (let i = 0; i < 7; i++) spawnPickup(i < 5 ? 'ammo' : 'health', choose(level.pickups));
  if (n >= 5 && n % 5 === 0 && n > checkpoint) { checkpoint = n; localStorage.setItem('doodle_checkpoint', String(n)); hud.kill(ui("Checkpoint · ") + n + ui(". wave"), 0); }
}
function pickSpawn(type) {
  const spots = type === 'sniper' ? level.snipers : level.spawns; const pp = player.body.pos;
  if (type === 'flyer') { const a = Math.random() * Math.PI * 2, r = 22 + Math.random() * 10; return new THREE.Vector3(clamp(pp.x + Math.cos(a) * r, level.bounds.minX + 4, level.bounds.maxX - 4), pp.y + 12 + Math.random() * 6, clamp(pp.z + Math.sin(a) * r, level.bounds.minZ + 4, level.bounds.maxZ - 4)); }
  if (BOSSES.includes(type)) {
    const fits = (sp) => !world.overlapsAABB({ x: sp.x - 1.1, y: sp.y + 0.1, z: sp.z - 1.1 }, { x: sp.x + 1.1, y: sp.y + 5.2, z: sp.z + 1.1 });
    const open = spots.filter((sp) => fits(sp)); const far = open.filter((sp) => sp.distanceTo(pp) > 20);
    if (far.length) return choose(far).clone(); if (open.length) return choose(open).clone();
    for (let i = 0; i < 200; i++) { const a = Math.random() * Math.PI * 2, r = 22 + Math.random() * 18; const c = new THREE.Vector3(clamp(pp.x + Math.cos(a) * r, -44, 44), 0, clamp(pp.z + Math.sin(a) * r, -44, 44)); c.y = world.groundBelow(c.x, 30, c.z, 40); if (c.y > -3 && fits(c)) return c; }
    return level.playerStart.clone();
  }
  let cands = spots.filter((s) => { const d = s.distanceTo(pp); return d > 14 && d < 48; });
  if (cands.length < 2) cands = spots.filter((s) => s.distanceTo(pp) > 14);
  const hidden = cands.filter((s) => !world.hasLineOfSight(player.eye, new THREE.Vector3(s.x, s.y + 1.2, s.z)));
  return (choose(hidden.length ? hidden : cands.length ? cands : spots)).clone();
}
function updateWaves(dt) {
  if (game.intermission > 0) {
    game.intermission -= dt; hud.setTimer(ui("Next wave: ") + Math.ceil(game.intermission) + ui(" s"));
    if (game.intermission <= 0) { hud.setTimer(''); startWave(game.wave + 1); }
    return;
  }
  if (game.queue.length && enemies.alive < game.maxAlive) {
    game.spawnT -= dt;
    if (game.spawnT <= 0) {
      game.spawnT = Math.max(0.7, 2.9 - game.wave * 0.13); const t = game.queue.shift(); const e = enemies.spawn(t, pickSpawn(t));
      if (e.T.boss) { const mul = 1 + 0.35 * Math.floor((game.wave - 5) / 15); e.hp = e.maxHp = Math.round(e.T.hp * mul); }
    }
  }
  if (!game.queue.length && enemies.alive === 0) {
    game.intermission = 8; hud.message(ui("WAVE ") + game.wave + ui(" CLEARED"), ui("Take a breath · +") + 200 * game.wave, 2.5);
    game.addScore(200 * game.wave, null); audio.waveClear(); player.hp = Math.min(player.maxHp, player.hp + 40);
  }
  hud.setWave(game.wave, enemies.alive + game.queue.length);
}
enemies.onKill = (e, info, over) => {
  game.kills++; game.combo++; game.comboT = 3.5;
  let label = e.T.name, pts = e.T.score;
  if (info.crit) { label = ui("Headshot"); pts += 60; }
  if (info.source === 'katana') { label = over ? ui("Clean cut") : ui("Slashed"); pts += 50; }
  if (info.source === 'focus') { label = ui("Finisher"); pts += 150; }
  if (info.source === 'katana' || info.source === 'focus') { game.katanaStreak++; player.weapons[player.katanaIndex].addBlood(0.42); if (game.katanaStreak >= KATANA_CHARGE_KILLS) enterFocus(); }
  else if (!['blast', 'mine'].includes(info.source)) game.katanaStreak = 0;
  if (info.source === 'deflect') { label = ui("Returned to sender"); pts += 120; }
  if (info.source === 'fall') label = ui("fell off the page");
  else if (!player.body.onGround && info.source !== 'deflect') { label += ui(" · Air kill"); pts += 40; }
  game.addScore(pts, label); audio.kill(!!info.crit || e.T.boss);
  if (game.mode === 'solo' && (info.source === 'katana' || info.source === 'focus')) player.addAmmoAll(0.04);
  const r = Math.random(); if (r < 0.5) spawnPickup('ammo', e.body.pos); else if (r < 0.62) spawnPickup('health', e.body.pos);
};
enemies.onBoss = (e) => { if (!e.alive) { hud.setBoss(null, null); game.boss = null; } else { game.boss = e; hud.setBoss(e.T.name, e.hp / e.maxHp); } };
ctx.onOrdnance = d => { if (net.active) { const msg={...d,map:level.key}; if(net.isHost){if(!allowMine(msg,net.id))return;relayMineVisual(msg,net.id);} else net.send('ordnance',msg); } };
net.on('ordnance', (d, from) => { if (d?.map === level.key) player.ordnance.receive(d, d.owner || from); });
net.on('mine-sync', (d, from) => {
  if (!net.isHost || !net.inMatch || d?.map !== level.key) return;
  for (const m of hostMines.values()) if(mineVisibleTo(from,m.pos,m.owner)) net.sendTo(from,'ordnance',{op:'place',id:m.id,pos:m.pos,map:level.key,owner:m.owner},m.owner);
});
player.onThrow = d => { if(net.active){if(net.isHost&&!allowGrenade(d,net.id))return;net.broadcast('nade',d);} };

// ---------------- focus slash (solo only) ----------------
const FOCUS_TIME = 2.6, FOCUS_SCALE = 0.26, FOCUS_RANGE = 24, FOCUS_MAX_CHAIN = 2, FOCUS_ARM = 0.18, DASH_SPEED = 46, KATANA_CHARGE_KILLS = 3;
const _fv = new THREE.Vector3();
function focusCandidate() {
  let best = null, bestScore = -1;
  for (const e of enemies.enemies) {
    if (!e.alive || e.state === 'spawn') continue;
    _fv.subVectors(e.center, player.eye); const d = _fv.length(); if (d > FOCUS_RANGE || d < 0.5) continue;
    const aim = _fv.divideScalar(d).dot(player.forward); if (aim < 0.4) continue;
    if (!world.hasLineOfSight(player.eye, e.center)) continue;
    const score = aim * 3 - d / FOCUS_RANGE; if (score > bestScore) { bestScore = score; best = e; }
  }
  return best;
}
function enterFocus() {
  if (online() || game.focus.chain >= FOCUS_MAX_CHAIN || !focusCandidate()) return;
  const fresh = !game.focus.active;
  game.focus.active = true; game.focus.t = FOCUS_TIME; game.focus.chain++; game.focus.arm = FOCUS_ARM; game.focus.ready = false;
  if (fresh) { audio.focusIn(); hud.tip(ui`<b>Katana dash ready</b> · ${hud.key('focus')} hold`, 2.2); }
}
function endFocus() { if (!game.focus.active && !game.focus.dash) return; game.focus.active = false; game.focus.target = null; game.focus.chain = 0; game.focus.dash = null; game.katanaStreak = 0; player.dashLock = false; hud.setFocusMark(null); }
function startFocusDash(target) { game.focus.dash = { target, t: 0, trail: player.center.clone(), lastTrail: 0 }; player.dashLock = true; player.body.vel.set(0, 0, 0); audio.dash(); player.kickFov(5); input.rumble(0.5, 0.4, 120); hud.setFocusMark(null); }
function marchBody(b, nx, nz, dist) {
  let moved = 0;
  for (let step = Math.min(0.22, dist); moved + 1e-4 < dist;) { const s2 = Math.min(step, dist - moved); b.pos.x += nx * s2; b.pos.z += nz * s2; if (world.overlapsBody(b)) { b.pos.y += 0.65; if (world.overlapsBody(b)) { b.pos.y -= 0.65; b.pos.x -= nx * s2; b.pos.z -= nz * s2; return moved; } } moved += s2; }
  return moved;
}
function updateFocusDash(dt) {
  const d = game.focus.dash; if (!d) return true;
  const target = d.target; d.t += dt;
  if (!target.alive || d.t > 1.2) { endDash(false); return true; }
  const b = player.body; const dx = target.body.pos.x - b.pos.x, dz = target.body.pos.z - b.pos.z; const flat = Math.hypot(dx, dz); const nx = dx / (flat || 1), nz = dz / (flat || 1);
  player.yaw = Math.atan2(-dx, -dz); _fv.subVectors(target.center, player.eye); player.pitch = clamp(Math.atan2(_fv.y, Math.hypot(_fv.x, _fv.z)), -1.2, 1.2);
  const want = Math.max(0, flat - 1.1); const moved = marchBody(b, nx, nz, Math.min(DASH_SPEED * dt, want));
  const aimY = target.body.pos.y + (target.T.flying ? 0.2 : 0); const dy = aimY - b.pos.y;
  if (Math.abs(dy) > 0.05) { const y = b.pos.y; b.pos.y += clamp(dy, -DASH_SPEED * dt, DASH_SPEED * dt); if (world.overlapsBody(b)) { b.pos.y = y; d.stuckY = (d.stuckY || 0) + dt; } else d.stuckY = 0; }
  d.lastTrail += dt; if (d.lastTrail > 0.02) { d.lastTrail = 0; effects.tracer(d.trail, player.center, INK.BLUE, 0.045, 0.28); d.trail.copy(player.center); effects.strokeBurst(player.center, INK.BLUE, 2, 5, { life: 0.22, size: 0.03 }); }
  const reach = Math.hypot(flat, Math.max(0, Math.abs(dy) - 0.6));
  if (reach <= 1.5) { focusExecute(target); return true; }
  if (moved < 1e-4 && want > 0.05 && (d.stuckY || 0) > 0.08) { endDash(true); return true; }
  return false;
}
function endDash(blocked) { player.dashLock = false; game.focus.dash = null; player.body.vel.set(0, 0, 0); if (blocked) { player.weapons[player.katanaIndex].startSlash(player._weaponState(false, false, 0)); audio.katanaSwing(); hud.tip(ui("Dash blocked"), 1.2); } }
function focusExecute(target) {
  player.dashLock = false; game.focus.dash = null; player.body.vel.set(0, 0, 0);
  player.weapons[player.katanaIndex].startSlash(player._weaponState(false, false, 0));
  _fv.subVectors(target.center, player.eye); const dir = _fv.clone().normalize(); const chainBefore = game.focus.chain;
  enemies.damage(target, 100000, { point: target.center.clone(), dir, part: 'head', source: 'focus', crit: true });
  audio.focusSlash(); game.hitstop(0.1, 0.08); effects.shakeAmt += 0.35; input.rumble(0.9, 0.7, 140); player.kickFov(6); player.hp = Math.min(player.maxHp, player.hp + 6);
  if (game.focus.chain === chainBefore) game.focus.t = Math.min(game.focus.t, 0.35);
  game.focus.target = null; hud.setFocusMark(null);
}
function updateFocus(dt) {
  const f = game.focus; if (!f.active) return;
  if (f.dash) { updateFocusDash(dt); return; }
  f.t -= dt; f.arm -= dt; if (f.t <= 0 || !player.alive) { endFocus(); return; }
  const combo = (input.down('aim') && input.down('fire')) || input.down('dash'); if (!combo) f.ready = true;
  const target = focusCandidate(); f.target = target;
  if (!target) { hud.setFocusMark(null); return; }
  _fv.copy(target.center).project(R.camera);
  if (_fv.z < 1) hud.setFocusMark((_fv.x * 0.5 + 0.5) * window.innerWidth, (-_fv.y * 0.5 + 0.5) * window.innerHeight); else hud.setFocusMark(null);
  if (combo && f.ready && f.arm <= 0) { input.consume('fire'); startFocusDash(target); }
}

// ---------------- free for all: spawning, death, scoring ----------------
const HOW = { rifle: ui("Rifle"), shotgun: ui("Shotgun"), sniper: ui("Sniper"), katana: 'Katana', revolver: 'Revolver', smg: 'SMG', ak47: 'AK-47', m4a1: 'M4A1', dual: ui("Dual Pistols"), famas: 'FAMAS', m249: 'M249', dmr: 'DMR', mine: ui("Mine"), grenade: ui("Grenade"), deflect: ui('Deflected bullet') };
const howWord = (src) => HOW[src] || null;
const spawnSpots = () => (level.arenaSpawns && level.arenaSpawns.length ? level.arenaSpawns : level.spawns);
function arenaSpawn(owner=net.id) {
  const spots = spawnSpots();
  const others = net.isHost ? [...combat.players.values()].filter(p=>p.hp>0&&p.id!==owner&&!friendly(owner,p.id)).map(p=>new THREE.Vector3(...p.pos)) : [...remote.values()].filter(r=>r.alive&&r.root?.visible&&!friendly(owner,r.id)).map(r=>r.body.pos);
  const scored = spots.map((s) => ({ s, d: others.reduce((a, pos) => Math.min(a, pos.distanceTo(s)), 999) }));
  scored.sort((a, b) => b.d - a.d);
  return choose(scored.slice(0, Math.min(3, scored.length))).s.clone();
}
// a spot for a late joiner: the one farthest from everybody already in the match
function farthestSpawnIndex() {
  const spots = spawnSpots(); const bodies = [player, ...remote.values()].filter((r) => r.alive); let best = 0, bd = -1;
  spots.forEach((s, i) => { const d = bodies.reduce((a, r) => Math.min(a, r.body.pos.distanceTo(s)), 999); if (d > bd) { bd = d; best = i; } });
  return best;
}
function onLocalDeath() {
  hud.setScope(false);
  if (!online()) { game.state = 'dying'; game.deathT = 0; return; }
  const killer = player.lastHitBy || null; const h = player.lastHit || {};
    const how = killer ? howWord(h.src) : null;
  // The host ledger emits the death and owns score changes.
  if (game.over) return;
  if (roundMode()) { game.state='dying'; game.deathT=0; game.respawnAt=Infinity; hud.setRespawn(); hud.tip(ui('Eliminated · Wait for the next round'),4); return; }
  game.respawnT = RESPAWN; game.respawnAt = performance.now() + RESPAWN * 1000; game.state = 'dying'; game.deathT = 0; hud.setRespawn(game.menu ? null : RESPAWN); input.exitLock();
  const kn = killer && scores.get(killer) ? scores.get(killer).name : null;
  hud.kill(kn ? kn + ui(" eliminated you") + (how ? ' · ' + how + (h.crit ? ui(" Headshot") : '') : '') : ui("Out of ink"), 0);
}
function respawnLocal() {
  if (!online() || roundMode() || game.state !== 'dying' || performance.now() < game.respawnAt || game.over) return false;
  if (performance.now() - (game.respawnRequestAt || 0) < 500) return false;
  game.respawnRequestAt = performance.now();
  document.activeElement?.blur(); input.suppressUntilRelease(['fire', 'jump', 'confirm']);
  if (!input.usingGamepad) input.requestLock();
  combatRequest('combat-respawn', { life: player.lifeId });
  return true;
}
hud.onRespawn = respawnLocal;
function tallyDeath(victim, killer) {
  const v = scores.get(victim); if (v) v.deaths++;
  if (killer && killer !== victim) { const k = scores.get(killer); if (k) k.kills++; }
  if(game.matchMode==='tdm'&&killer&&killer!==victim&&TEAMS.includes(teamOf(killer))&&!friendly(killer,victim))game.teamScores[teamOf(killer)]++;
  sendScores(); checkWin();
}
function sendScores() { if(game.matchMode==='tdm')net.send('team-state',{mode:'tdm',scores:game.teamScores}); const rows = [...scores.entries()].map(([id, s]) => ({ id, ...s })); net.send('score', rows); applyScores(rows); }
function applyScores(rows) { scores.clear(); for (const r of rows) scores.set(r.id, { name: r.name, kills: r.kills, deaths: r.deaths }); refreshScoreHud(); }
function sortedScores() { return [...scores.entries()].sort((a, b) => b[1].kills - a[1].kills || a[1].deaths - b[1].deaths); }
function refreshScoreHud() {
  if (!online()) return;
  if (teamMode()) { renderTeamHud(); if(!hud.el.board.hidden)hud.setBoard(boardHTML()); return; }
  const rows = sortedScores(); const top = rows.slice(0, 3); const myIdx = rows.findIndex(([id]) => id === net.id);
  if (myIdx >= 3) top.push(rows[myIdx]);
  hud.setPvpScore(top.map(([id, sc]) => `<div class="row${id === net.id ? ' me' : ''}"><span class="rank">${rows.findIndex(([x]) => x === id) + 1}.</span><span>${esc(sc.name)}${id === net.id ? ui(" (you)") : ''}</span><b>${sc.kills}</b></div>`).join('') + ui`<div class="target">Target: ${matchTarget()} kills</div>`);
  hud.setModifier('');
  if (!hud.el.board.hidden) hud.setBoard(boardHTML());
}
function boardHTML(title = ui("Free for all")) {
  if(teamMode())return teamBoardHTML();
  const rows = sortedScores();
  return ui`<h3>${title}</h3>${rows.map(([id, s]) => ui`<div class="${id === net.id ? 'me' : ''}"><span>${esc(s.name)}${id === net.id ? ui(" (you)") : ''}</span><span>${s.kills} kills · ${s.deaths} deaths</span></div>`).join('')}<div class="foot">Target: ${matchTarget()} kills · Remaining ${mmss(matchLeft)} · Lobby ${String(net.aliasCode || net.code || '').replace(/-\d+$/, '')}</div>`;
}
function checkWin() {
  if (!net.isHost || !online() || game.over || roundMode()) return;
  if(game.matchMode==='tdm'){const team=TEAMS.find(t=>game.teamScores[t]>=matchTarget());if(team){const winner={id:'team-'+team,team,name:teamName(team)};net.send('end',winner);endMatch(winner);}return;}
  let winner = null;
  for (const [id, s] of scores) if (s.kills >= matchTarget()) winner = { id, name: s.name };
  if (winner) { net.send('end', winner); endMatch(winner); }
}
function endMatch(winner) {
  game.over = winner; game.overT = 0; game.state = 'over'; endFocus(); input.exitLock(); hud.setBoard(null);
  const title = winner.team==='draw' ? ui('Draw') : winner.team ? teamName(winner.team)+ui(' wins') : winner.id === net.id ? ui("You win") : (winner.name || ui("Player")) + ui(" wins");
  hud.setGameplayVisible(false); hud.showScreen(ui`<h1>${esc(title)}</h1><div class="scoreboard">${sortedScores().map(([id, s]) => ui`<div class="${id === net.id ? 'me' : ''}"><span>${esc(s.name)}</span><span>${s.kills} kills · ${s.deaths} deaths</span></div>`).join('')}</div><div class="go" id="overGo">Returning to lobby…</div>`);
}

// ---------------- networking ----------------
function addRemote(id, name) {
  if (remote.has(id)) { const r = remote.get(id); r.name = name; return r; }
  const rp = new RemotePlayer(ctx, id, name, 0, INK.RED);
  rp.onDamage = (t, amount, fromPos) => { if (!ctx.canHurt(t) || !t.alive) return; sendPlayerDamage(t, { amount: Math.round(amount), from: fromPos ? fromPos.toArray().map((v) => +v.toFixed(1)) : null, by: net.id, src: 'grenade' }); };
  remote.set(id, rp); return rp;
}
function removeRemote(id) {
  clearHostMines(id); combat.players.delete(id); if (!net.bannedPeers.has(id)) antiCheat.remove(id);
  for (const [key, hit] of pendingHits) if (hit.target === id) pendingHits.delete(key); player.ordnance.removePeer(id); const r = remote.get(id); if (r) { r.dispose(); remote.delete(id); } lobby.players.delete(id); scores.delete(id); }
function lobbyRows() { return [...lobby.players.entries()].map(([id, p]) => ({ id, name: p.name, team: p.team })); }
function broadcastLobby(render = true) { net.send('lobby', { matchMode: lobby.matchMode, roundTarget: teamTarget(lobby.roundTarget), players: lobbyRows(), hostId: net.id, isPublic: lobby.isPublic, map: lobby.map || mapKey, katana: lobby.katana, killTarget: normalizeKillTarget(lobby.killTarget), shown: net.aliasCode || net.code }); syncTeamColors(); if(render)renderLobby(); }
const inMatch = () => ['play', 'dying', 'over'].includes(game.state);
net.onPeerLeave = (id) => { const nm = (lobby.players.get(id) || {}).name; removeRemote(id); broadcastLobby(); if (inMatch()) { hud.kill((nm || ui("Player")) + ui(" left"), 0); sendScores(); } };
net.onDisconnect = () => leaveOnline(ui('The host left'));
net.on('refused', (d) => leaveOnline(friendlyError(d.reason)));
net.hostName = myName;
net.onPeerJoin = (from, meta) => {
  const name = (typeof meta?.name === 'string' ? meta.name : 'doodle').slice(0, 14);

  antiCheat.ensure(from);
  lobby.players.set(from, { name, team: balancedTeam() }); addRemote(from, name); broadcastLobby();
  if (roundMode() && inMatch() && !game.over) { addLateTeammate(from,name); return; }
  if (game.state === 'play' || game.state === 'dying') { const spawn = farthestSpawnIndex(); const v = combat.add(from, spawnSpots()[spawn].toArray()); publishVitals(v); if (!scores.has(from)) scores.set(from, { name, kills: 0, deaths: 0 }); net.sendTo(from, 'start', { late: true, spawn, matchMode: game.matchMode, katana: lobby.katana, killTarget: game.killTarget, vitals: viewsFor(from), map: lobby.map || mapKey, broken: level.breakables.filter((b) => !b.alive).map((b) => b.id) }); sendScores(); hud.kill(name + ui(" joined"), 0); }
};
net.on('lobby', (d) => {
  lobby.matchMode = ['teams','tdm'].includes(d.matchMode) ? d.matchMode : 'ffa'; lobby.roundTarget=teamTarget(d.roundTarget);
  lobby.katana = d.katana !== false; lobby.killTarget = normalizeKillTarget(d.killTarget); lobby.hostId = d.hostId; lobby.isPublic = !!d.isPublic; lobby.code = net.code; lobby.shown = d.shown || net.code; if (d.map) lobby.map = knownMap(d.map); lobby.order = d.players.map((p) => p.id); lobby.players.clear();
  for (const p of d.players) lobby.players.set(p.id, { name: p.name, team: TEAMS.includes(p.team)?p.team:'red' });
  for (const p of d.players) if (p.id !== net.id) addRemote(p.id, p.name);
  for (const id of [...remote.keys()]) if (!lobby.players.has(id)) removeRemote(id);
  if (inMatch()) { for (const p of d.players) if (!scores.has(p.id)) scores.set(p.id, { name: p.name, kills: 0, deaths: 0 }); refreshScoreHud(); }
  syncTeamColors(); renderLobby();
});
net.on('leave', (d) => { const nm = (lobby.players.get(d.id) || {}).name; removeRemote(d.id); if (inMatch()) hud.kill((nm || ui("Player")) + ui(" left"), 0); renderLobby(); });
net.on('start', (d, from) => { if (net.isHost || from !== net.hostId) return; lobby.katana = d.katana !== false; lobby.killTarget = normalizeKillTarget(d.killTarget); if (d.map) { lobby.map = knownMap(d.map); setLevel(lobby.map, true, true); } lobby.matchMode=d.matchMode==='tdm'?'tdm':'ffa'; startMatch(!!d.late, d.spawns ? d.spawns[net.id] : d.spawn); for (const v of d.vitals || []) applyVitals(v); if (d.broken) for (const id of d.broken) { const br = level.breakables[id]; if (br) breakProp(br, null, false, true); } });
net.on('end', (d) => endMatch(d));
net.on('backtolobby', () => { if (!net.isHost) toLobbyScreen(); });
net.on('pickup', (d) => { if (!net.isHost) spawnPickup(d.kind, new THREE.Vector3().fromArray(d.pos), d.id); });
net.on('taken',d=>{const p=pickups.find(x=>x.id===d.id);if(p){if(d.collector===net.id)collectPickup(p);removePickup(p);}});
net.on('take',(d,from)=>{if(net.isHost)hostPickup(d,from);});
net.on('ps', (d, from) => { const r = remote.get(from); if (r) { r.push(d, performance.now() / 1000); r.lastSeen = performance.now(); } });
net.on('combat-result', (d, from) => {
  if (from !== net.hostId) return;
  acceptHitResult(d);
});
function acceptHitResult(d) {
  const from = d.target;
  const hit = pendingHits.get(d?.id);
  if (!hit || hit.target !== from) return;
  pendingHits.delete(d.id);
  if (!online() || !inMatch() || performance.now() - hit.time > 5000) return;
  if (!(d.amount > 0)) { if (d.reason === 'protected') hud.tip(ui('Spawn protected'), .8); if(d.reason==='blocked')hud.tip(ui('Blocked'),.8); return; }
  hud.hitmarker(!!d.killed, !!d.crit);
  const target = remote.get(from);
  if (target) { audio.hitEnemy(target.center); target.flash(); }
  if (hit.feedback) effects.blood(hit.feedback.point, hit.feedback.dir, clamp(.4 + d.amount / 80, .4, 1.6), { ink: INK.RED });
}
net.on('nade', (d, from) => { if (d) player.throwGrenade({ ...d, owner: from, id: `${from}:${d.id || ''}` }); });
net.on('brk', (d) => { const br = level.breakables[d.id]; if (br) breakProp(br, null, false); });
net.on('parry', (d) => { audio.shieldHit(player.center); input.rumble(0.35, 0.3, 60); effects.strokeBurst(player.eye.clone().addScaledVector(player.forward, 0.5), INK.ORANGE, 8, 5, { life: 0.2, size: 0.03 }); hud.kill(d.ret ? ui("Returned to sender") : ui("Deflected"), d.ret ? 25 : 0); });
net.on('shots', (d, from) => {
  const r = remote.get(from); if (!r || !r.root || !r.alive) return;
  _sm.set(r.body.pos.x + r.right.x * 0.3 + r.forward.x * 0.8, r.body.pos.y + 1.35 + r.forward.y * 0.8, r.body.pos.z + r.right.z * 0.3 + r.forward.z * 0.8);
  const th = TRACER_THICK[d.k] || 0.02; const e = d.e || [];
  for (let i = 0; i + 2 < e.length; i += 3) { _se.set(e[i], e[i + 1], e[i + 2]); effects.tracer(_sm, _se, INK.BLUE, th, 0.06); }
  r.flash(); audio.remoteShot(d.k, _sm);
});
net.on('cut', () => { if (player.grapple.state !== 'idle') { player.detachGrapple(false); effects.strokeBurst(player.center, INK.ORANGE, 8, 4, { life: 0.25, size: 0.03 }); hud.tip(ui("Your rope was cut"), 1.3); input.rumble(0.5, 0.3, 80); } });
net.on('score', (rows) => { if (!net.isHost) applyScores(rows); });
net.on('fell', (d, from) => { if (!net.isHost) return; const sc = scores.get(from); if (sc) { sc.kills = Math.max(0, sc.kills - 1); sendScores(); net.send('feed', { event: 'fell', name: sc.name }); hud.kill(sc.name + ui(" fell off the page · -1"), 0); } });
net.on('feed', (d, from) => { if (from === net.hostId && d.event === 'fell') hud.kill(String(d.name || '') + ui(" fell off the page · -1"), 0); });
player.onFall = () => {
  if (!online() || !inMatch()) return;
  hud.kill(ui("fell off the page · Kills -1"), 0);
  if (net.isHost) { const sc = scores.get(net.id); if (sc) { sc.kills = Math.max(0, sc.kills - 1); sendScores(); net.send('feed', { event: 'fell', name: sc.name }); } }
  else net.send('fell', {});
};
net.on('clock', (d) => { if (!net.isHost) { matchLeft = d.left; clockRunning = !!d.on; } });

// ---- idle players: a warning, then out; a lobby with nobody active in it shuts down ----
const IDLE_FLAG = 30, IDLE_MATCH = 150, IDLE_LOBBY = 300, IDLE_WARN = 20;
let idleWarned = false, idleCheckT = 0;
function idleUpdate(dt) {
  if (!net.active) { idleWarned = false; return; }
  idleCheckT -= dt; if (idleCheckT > 0) return; idleCheckT = 1;
  const limit = inMatch() ? IDLE_MATCH : IDLE_LOBBY; const idle = input.idleSeconds;
  const othersActive = [...remote.values()].some((r) => !r.idle);
  // a host that still has active players stays; kicking it would end their match
  const canDrop = !net.isHost || !othersActive;
  if (idle > limit - IDLE_WARN && !idleWarned && canDrop) { idleWarned = true; hud.message(ui("Still there?"), ui("Move to avoid being removed for inactivity."), 3); audio.empty(); }
  if (idle <= limit - IDLE_WARN) idleWarned = false;
  if (idle > limit && canDrop) { const back = net.isHost ? null : String(net.aliasCode || net.code || '').replace(/-\d+$/, ''); leaveOnline(net.isHost ? ui("Room closed: all players are inactive") : ui("Removed for inactivity")); lobby.rejoinCode = back; if (back) showStart(); return; }
  // the host also clears out a client that has sat idle past the limit, in case its tab cannot do it itself
  if (net.isHost) for (const [id, r] of remote) if (r.idle && r.idleSince && performance.now() / 1000 - r.idleSince > limit - IDLE_FLAG + 15) net.enforceKick(id, { reason: 'idle', ban: false });
}
net.on('kick', (d) => { const anti = d?.reason === 'anti-cheat'; const back = d?.reason === 'idle' ? String(net.aliasCode || net.code || '').replace(/-\d+$/, '') : null; leaveOnline(anti ? ui('Removed from match: anti-cheat violation') : d?.reason === 'idle' ? ui('Removed for inactivity') : ui('Removed from the room')); lobby.rejoinCode = anti ? null : back; showStart(); });
const sceneClock = new SceneClock();
let scenePingT = 0, sceneHost = null;
net.on('scene-ping', (d, from) => { if (net.isHost && Number.isInteger(d?.id)) net.sendTo(from, 'scene-pong', { id: d.id, time: sceneClock.time() }); });
net.on('scene-pong', (d, from) => { if (!net.isHost && from === net.hostId) sceneClock.accept(d); });
if (DEV_DEBUG) Object.assign(window.__game, { sceneClock });
let syncTick = 0;
function netUpdate(dt) {
  if (net.isHost && online() && inMatch() && !game.over) { combat.tick(); tickHostMines(dt); combatSyncT -= dt; if (combatSyncT <= 0) { combatSyncT = .2; for (const v of combat.views()) publishVitals(v); } }
  idleUpdate(dt);
  if (!net.active) return; const now = performance.now() / 1000; syncTick++;
  if (sceneHost !== net.hostId) { sceneHost = net.hostId; sceneClock.changeHost(); scenePingT = 0; }
  if (!net.isHost) { scenePingT -= dt; if (scenePingT <= 0) { scenePingT = 1; net.send('scene-ping', sceneClock.request()); } }
  for (const r of remote.values()) r.update(dt, now);
  // a connection that died without saying so leaves a figure standing around: drop anyone silent too long
  if (inMatch()) for (const [id, r] of remote) { if (r.lastSeen && performance.now() - r.lastSeen > 9000) { if (!net.isHost && id === net.hostId) { leaveOnline(ui('The host left')); break; } const nm = r.name; removeRemote(id); hud.kill(nm + ui(" disconnected"), 0); if (net.isHost) { const c = net.conns.get(id); if (c) { try { c.close(); } catch (e) { /* ignore */ } net.conns.delete(id); } net.send('leave', { id }); broadcastLobby(); sendScores(); } } }
  if (syncTick % 3 === 0 && inMatch()) {
    let snap = encodeLocal(player, player.weaponIndex, { firing: player.firing, idle: input.idleSeconds > IDLE_FLAG });
    if (net.isHost) {snap = combat.snapshot(net.id, snap);if(!snap){const p=combat.players.get(net.id);if(p)applyVitals({...combat.view(p),correction:true});}}
    if (snap) relayPlayerSnapshot(net.id, snap);
  }
  if (shotQueue.length) relayShotVisual(net.id, { k: player.weapon.kind, e: shotQueue.splice(0) });
  if(roundMode()) { updateTeamMatch(dt); return; }
  if (net.isHost && inMatch() && remote.size > 0) game.clockStarted = true;
  const clockOn = inMatch() && !game.over && (net.isHost ? !!game.clockStarted : clockRunning);
  if (inMatch() && !game.over) { if (clockOn) matchLeft = Math.max(0, matchLeft - dt); if (net.isHost) { clockT -= dt; if (clockT <= 0) { clockT = 2; net.send('clock', { left: Math.round(matchLeft), on: clockOn }); } } hud.setTimer(clockOn ? mmss(matchLeft) : ui("The timer starts when another player joins")); }
  if (net.isHost && clockOn) { game.matchT += dt; if (matchLeft <= 0) { const rows = sortedScores(); const w = game.matchMode==='tdm' ? tdmTimeWinner() : rows.length ? { id: rows[0][0], name: rows[0][1].name } : { id: net.id, name: myName }; net.send('end', w); endMatch(w); } }
}
function leaveOnline(reason) {
  net.leave(); for (const id of [...remote.keys()]) removeRemote(id); antiCheat.players.clear(); lobby.players.clear(); scores.clear(); hud.setBoard(null);
  if (game.state !== 'start') { game.state = 'start'; game.mode = 'solo'; setArena(false); resetGame(); hud.setGameplayVisible(false); }
  game.menu = false; lobby.status = reason || ''; screen = 'online'; showStart();
}
async function createLobby(isPublic) {
  setStatus(ui("Creating room…"));
  try { await net.host({ isPublic }); }
  catch (err) { setStatus(friendlyError(err)); unlockButtons(); return; }
  lobby.isPublic = isPublic; lobby.map = mapKey; lobby.players.clear(); lobby.players.set(net.id, { name: myName, team: 'red' }); lobby.hostId = net.id; lobby.status = '';
  game.state = 'lobby'; screen = 'lobby'; showStart();
}
async function joinLobby(code) {
  setStatus(ui("Connecting…"));
  try { await net.join(code, { name: myName }); } catch (err) { setStatus(friendlyError(err)); unlockButtons(); return; }
  lobby.isPublic = net.isPublic; lobby.status = ''; game.state = 'lobby'; screen = 'lobby'; showStart();
}
async function quickPlay() {
  try { await net.quickJoin({ name: myName }, setStatus); lobby.isPublic = true; lobby.status = ''; game.state = 'lobby'; screen = 'lobby'; showStart(); return; }
  catch (err) { if (!/no open public/.test(String(err.message))) { setStatus(friendlyError(err)); unlockButtons(); return; } }
  setStatus(ui("No open rooms · Creating a new room…"));
  await createLobby(true);
}
function friendlyError(err) {
  const m = String(err && err.message || err || ''); if (!m) return ui("Something went wrong");
  if (/removed from this room/.test(m)) return ui('Removed from the room');
  if (/networking library/.test(m)) return ui("Networking could not load · Check your connection and refresh.");
  if (/timed out|signalling/.test(m)) return ui("Could not reach matchmaking · Check your connection.");
  if (/no lobby with that code/.test(m)) return ui("Room not found · Check the code with your friend.");
  if (/no answer/.test(m)) return ui("Room found, but direct connection failed · Try another network.");
  if (/closed/.test(m)) return ui('Room closed · Try another room.');
  if (/public lobbies are busy/.test(m)) return ui('Public rooms are busy · Create a private room.');
  if (/could not connect|could not start/.test(m)) return ui('Could not connect · Try another network.');
  if (/full/.test(m)) return ui("Room full · Try another room.");
  if (/leave the lobby/.test(m)) return ui("Leave your current room first.");
  return m;
}
function setStatus(t) { lobby.status = t; const el = hud.el.panel.querySelector('#status'); if (el) el.textContent = t; }

// ---------------- screens ----------------
function settingsHTML() {
  return ui`<div class="settings" id="settings">
    <label>Mouse sensitivity <input type="range" id="setSens" min="25" max="250" step="5" value="${settings.sens}"><b id="setSensV">${settings.sens}%</b></label>
    <label><input type="checkbox" id="setInv" ${settings.invert ? 'checked' : ''}> Invert vertical look</label>
    <label><input type="checkbox" id="setMus" ${musicWanted ? 'checked' : ''}> Music <span class="k">(M)</span></label>
  </div>`;
}
function wireSettings() {
  const box = hud.el.panel.querySelector('#settings'); if (!box) return;
  box.addEventListener('click', (e) => e.stopPropagation()); box.addEventListener('keydown', (e) => e.stopPropagation());
  const sens = box.querySelector('#setSens'), out = box.querySelector('#setSensV');
  sens.addEventListener('input', () => { settings.sens = Number(sens.value); out.textContent = settings.sens + '%'; applySettings(); });
  box.querySelector('#setInv').addEventListener('change', (e) => { settings.invert = e.target.checked; applySettings(); });
  box.querySelector('#setMus').addEventListener('change', (e) => { musicWanted = e.target.checked; localStorage.setItem('doodle_music', musicWanted ? '1' : '0'); audio.musicOn(musicWanted); });
}
function wireName(box) {
  const nb = box.querySelector('#setName'); if (!nb) return;
  nb.addEventListener('input', (e) => { myName = e.target.value.trim().slice(0, 14) || myName; localStorage.setItem('doodle_name', myName); player.name = myName; net.hostName = myName; });
}
function checkpointHTML() {
  if (checkpoint < 5) return '';
  let h = ui("<div class=\"checkpoints\"><span>Checkpoint</span>");
  for (let w = 5; w <= checkpoint; w += 5) h += ui`<button type="button" data-cp="${w}">${w}. wave</button>`;
  return h + '</div>';
}
function wireCheckpoints(onGo) { const box = hud.el.panel.querySelector('.checkpoints'); if (!box) return; box.addEventListener('click', (e) => { e.stopPropagation(); const b = e.target.closest('button'); if (b) onGo(Number(b.dataset.cp)); }); }
const mapName = (k) => (LEVELS.find((m) => m.key === k) || LEVELS[0]).name;
function mapSketch(key) {
  if (key === 'dust2') {
    const outline = [DUST_OUTLINE, ...DUST_ISLANDS].map(poly => 'M' + poly.map(([x,z]) => `${((x-640)*.145).toFixed(1)},${((z-360)*.145).toFixed(1)}`).join('L') + 'Z').join('');
    return `<svg class="map-sketch" viewBox="-56 -56 112 112" aria-hidden="true"><path d="${outline}" fill="currentColor" fill-opacity=".16" fill-rule="evenodd"/></svg>`;
  }
  const shapes = {
    ...Object.fromEntries(Object.entries(TEAM_BLOCKS).map(([k,blocks])=>[k,blocks.map(([x,z,w,d])=>[x-w/2,z-d/2,w,d])])),
    district: [[-43, 4, 18, 16], [24, 4, 20, 16], [-7, -7, 14, 14], [-48, -34, 96, 8]],
    harbor: [[-28, -26, 12, 14], [16, -26, 12, 14], [-28, 12, 12, 14], [16, 12, 12, 14], [-39, -27, 6, 10], [-39, -5, 6, 10], [-39, 17, 6, 10], [33, -27, 6, 10], [33, -5, 6, 10], [33, 17, 6, 10], [-34, -32, 68, 2]],
    canyon: [[-40, -28, 24, 56], [16, -28, 24, 56], [-16, -14, 32, 4], [-16, 10, 32, 4]],
    forest: [[-37,-35,6,70],[31,-35,6,70],[-27,-24,8,8],[19,-24,8,8],[-14,15,5,2],[9,-17,5,2]],
    duel: [[-38,-38,76,76],[-20,-16,8,3],[12,-16,8,3],[-20,12,8,3],[12,12,8,3],[-3,-3,6,6]],
    meadow: [[-16,-24,32,44],[-14,-24,4,48],[10,-24,4,48],[-29,-34,8,8],[21,-34,8,8]],
    gardens: [[-25, -25, 16, 16], [9, -25, 16, 16], [-25, 9, 16, 16], [9, 9, 16, 16], [-19, -2, 38, 4], [-6, -6, 12, 12]],
    deepforest: [[-40,-40,14,12],[25,-35,14,12],[-34,22,12,12],[24,24,12,12],[-15,-35,4,14],[10,-5,4,20],[-16,16,4,25]],
    lostwoods: [[-43,-40,20,4],[-43,-36,4,16],[23,-34,20,4],[39,-30,4,16],[-35,22,18,4],[23,25,18,4],[-8,-28,5,18],[8,8,5,20]],
    skyline: [-36,-18,0,18,36].flatMap(x => [-36,-18,0,18,36].filter(z => x || z).map(z => [x-6,z-6,12,12])),
  };
  return `<svg class="map-sketch" viewBox="-56 -56 112 112" aria-hidden="true"><rect class="map-edge" x="-52" y="-52" width="104" height="104" rx="3"/>${(shapes[key] || []).map(([x, z, w, d]) => `<rect x="${x}" y="${z}" width="${w}" height="${d}"/>`).join('')}<path d="M0 48v-15m-3 4 3-4 3 4"/></svg>`;
}
function mapHTML(sel, canPick) {
  if (LEVELS.length < 2) return '';
  const maps = game.state==='lobby' && lobby.matchMode==='teams' ? LEVELS.filter(m=>teamMaps.includes(m.key)) : LEVELS;
  return ui`<div class="mapsel" id="mapsel" role="group" aria-label="Map selection"><span>CHOOSE A MAP · ${maps.length} maps</span><div class="mapgrid">${maps.map(m => `<button type="button" class="mapbtn map-${m.style}${m.key === sel ? ' on' : ''}" data-map="${m.key}" aria-pressed="${m.key === sel}" ${canPick ? '' : 'disabled'}>${mapSketch(m.key)}<strong>${m.name}</strong><i>${m.blurb}</i><small>${m.key === sel ? ui("SELECTED") : ui("SELECT")}</small></button>`).join('')}</div></div>` + appearanceHTML(sel);
}
function wireMap(onPick) { const box = hud.el.panel.querySelector('#mapsel'); if (!box) return; box.addEventListener('click', (e) => { e.stopPropagation(); const b = e.target.closest('.mapbtn'); if (b && !b.disabled) { onPick(b.dataset.map); hud.el.panel.querySelector('#appearance')?.scrollIntoView({ block: 'nearest' }); } }); }
function appearanceHTML(key) {
  const selected = appearanceFor(key);
  return `<fieldset class="appearance" id="appearance" data-appearance-map="${key}"><legend>${ui('Visual style')} · ${mapName(key)}</legend><div class="appearance-options">${[['notebook', ui('Lined notebook'), ui('Original ink and paper')], ['solid', ui('Solid colors'), ui('Smooth surfaces, no paper lines')]].map(([mode, name, hint]) => `<label><input type="radio" name="appearance" value="${mode}" ${selected === mode ? 'checked' : ''}><span class="appearance-card"><span class="appearance-swatch ${mode}" aria-hidden="true"></span><strong>${name}</strong><small>${hint}</small></span></label>`).join('')}</div><p>${ui('Your view only · Other players choose their own style')}</p></fieldset>`;
}
function wireAppearance() {
  const box = hud.el.panel.querySelector('#appearance'); if (!box) return;
  for (const event of ['click', 'keydown']) box.addEventListener(event, e => e.stopPropagation());
  box.addEventListener('change', e => {
    if (!e.target.matches('input[name="appearance"]')) return;
    const key = box.dataset.appearanceMap, mode = e.target.value;
    if (saveAppearance(key, mode) && loadedKey === key) R.setAppearance(mode);
  });
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function mainHTML() {
  const languagePicker = `<label class="language-picker" id="languagePicker">Language / Dil <select id="setLanguage" aria-label="Language / Dil"><option value="en" ${language === 'en' ? 'selected' : ''}>English</option><option value="tr" ${language === 'tr' ? 'selected' : ''}>Türkçe</option></select></label>`;
  return languagePicker + ui`<h1>Doodle District</h1><h2>REMIX · Ink, movement and survival</h2>
    <section class="credits" aria-label="Original game and creator">
      <p>Original game: <strong>DoodleShooter · iifor</strong><br>A community remix of DoodleShooter. Thanks to the original creator and contributors!</p>
      <nav aria-label="Original game links"><a href="https://doodleshooter.vercel.app/" target="_blank" rel="noopener noreferrer">Play the original ↗</a><a href="https://github.com/iifor/doodleshooter" target="_blank" rel="noopener noreferrer">iifor / GitHub source ↗</a></nav>
    </section>
    <div class="mainbtns"><button type="button" class="start" id="soloBtn">PLAY<i>Solo · Survive the waves</i></button><button type="button" id="onlineBtn">ONLINE<i>Free for all / Teams · Up to 25 players</i></button></div>
    ${mapHTML(mapKey, true) + `<button type="button" class="play-map" id="playMapBtn">${ui('Play selected map')}</button>`}${CONTROLS_HTML}${settingsHTML()}${checkpointHTML()}${best ? ui`<div class="beststat">Best score：${best}</div>` : ''}`;
}
function onlineHTML() {
  return ui`<h1>ONLINE</h1><h2>Free for all · Target: ${matchTarget()} kills · Up to 25 players</h2>
    <div class="online" id="online">
      <div class="row"><span>Your name</span><input type="text" class="namebox" id="setName" maxlength="14" value="${esc(myName)}"></div>
      <div class="row"><button type="button" class="big" id="quickBtn">Quick play</button><span class="hint">Join an open room, or create one if none are available.</span></div>
      <div class="row split"><span>or</span></div>
      <div class="row"><button type="button" id="createBtn">Create room</button><div class="radio"><label><input type="radio" name="vis" value="public" ${lobby.isPublic ? 'checked' : ''}> Public</label><label><input type="radio" name="vis" value="private" ${lobby.isPublic ? '' : 'checked'}> Private · Friends</label></div></div>
      <div class="row"><span>Room code</span><input type="text" id="codeBox" placeholder="CODE" maxlength="5" autocomplete="off"><button type="button" id="joinBtn">Join</button></div>
      <div class="lobbylist" id="lobbylist"><div class="row"><span>Public rooms</span><button type="button" class="alt" id="refreshBtn">Refresh</button></div><div class="rows" id="lobbyRows">${lobbyListHTML()}</div></div>
      <div class="status" id="status">${esc(lobby.status || '')}</div>
      ${lobby.rejoinCode ? ui`<div class="row"><button type="button" class="big" id="rejoinBtn">Rejoin ${esc(lobby.rejoinCode)}</button></div>` : ''}
      <div class="row"><button type="button" class="alt" id="backBtn">Back</button></div>
    </div>`;
}
function lobbyHTML() {
  if(lobby.matchMode!=='ffa')return teamLobbyHTML();
  const rows = lobbyRows(); const host = net.isHost; const n = rows.length;
  const startButton = host ? `<button type="button" class="big" id="startBtn">${ui('Start match')}</button>` : `<span class="hint" id="hostWait">${ui('Waiting for the host to start')}</span>`;
  return ui`<h1>Lobby</h1><h2>Free for all · Target: ${matchTarget()} kills · ${n}/${net.maxPlayers} players</h2>
    <div class="online" id="online">
      <div class="row"><span>Code</span><span class="code">${String(net.isHost ? (net.aliasCode || net.code) : (lobby.shown || net.code) || '').replace(/-\d+$/, '')}</span></div>
      ${mapHTML(lobby.map || mapKey, host)}
      <div class="hint">${lobby.isPublic ? ui("Anyone can join through quick play or a room code.") : ui("Your friend can enter this code on the ONLINE screen and press Join.")}</div>
      <div class="plist">${rows.map((p) => `<div class="${p.id === lobby.hostId ? 'host' : ''}${p.id === net.id ? ' me' : ''}"><span>${esc(p.name)}</span><span>${p.id === net.id ? ui("you") : ''}</span></div>`).join('')}</div>
      <div class="row">${startButton}<button type="button" class="alt" id="leaveBtn">${ui('Leave')}</button></div>
      <div class="status" id="status">${esc(lobby.status || '')}</div><div class="hint">${ui('Only the host can start the match')} · ${n < 2 ? ui("You can also join after the match starts") : n + ui(" players ready")}</div>
    </div>` + moderationHTML();
}
let lobbyList = null, listBusy = false;
function lobbyListHTML() {
  if (listBusy) return ui("<div class=\"hint\">Looking for rooms…</div>");
  if (!lobbyList) return ui("<div class=\"hint\">Press Refresh to find public rooms.</div>");
  if (!lobbyList.length) return ui("<div class=\"hint\">Press Quick play to enter a room.</div>");
  return lobbyList.map((l) => ui`<div class="lobbyrow"><span class="code">${esc(l.code)}</span><span>${esc(l.hostName || ui("Player"))} room</span><span>${l.players}/${l.max}${l.inMatch ? ui(" · Match in progress") : ''}</span>${l.full ? ui("<span class=\"status\">Full</span>") : ui`<button type="button" data-join="${esc(l.code)}">Join</button>`}</div>`).join('');
}
async function refreshLobbies() {
  if (listBusy || net.active) return; listBusy = true; const box = hud.el.panel.querySelector('#lobbyRows'); if (box) box.innerHTML = lobbyListHTML();
  let err = null; try { lobbyList = await net.listLobbies({ name: myName }); } catch (e) { lobbyList = []; err = e; }
  listBusy = false; const rows = hud.el.panel.querySelector('#lobbyRows'); if (rows) rows.innerHTML = err ? ui`<div class="hint">Could not find rooms: ${esc(friendlyError(err))}</div>` : lobbyListHTML();
}
function wireOnline() {
  const box = hud.el.panel.querySelector('#online'); if (!box) return;
  box.addEventListener('click', (e) => e.stopPropagation()); box.addEventListener('keydown', (e) => e.stopPropagation());
  const controls=hud.el.panel.querySelector('#moderation'),maps=box.querySelector('#mapsel');if(game.state==='lobby'&&controls&&maps)maps.before(controls);
  const q = (id) => box.querySelector('#' + id); wireName(box); wireModeration();
  if (q('quickBtn')) q('quickBtn').addEventListener('click', () => { lockButtons(box); quickPlay(); });
  if (q('createBtn')) q('createBtn').addEventListener('click', () => { lockButtons(box); createLobby(box.querySelector('input[name=vis]:checked').value === 'public'); });
  if (q('joinBtn')) { q('joinBtn').addEventListener('click', () => { const c = q('codeBox').value.trim().toUpperCase(); if (!c) { setStatus(ui("Enter the room code from your friend.")); return; } lockButtons(box); joinLobby(c); }); q('codeBox').addEventListener('keydown', (e) => { if (e.key === 'Enter') q('joinBtn').click(); }); }
  if (q('rejoinBtn')) q('rejoinBtn').addEventListener('click', () => { const c = lobby.rejoinCode; lobby.rejoinCode = null; lockButtons(box); joinLobby(c); });
  if (q('backBtn')) q('backBtn').addEventListener('click', () => { lobby.status = ''; lobby.rejoinCode = null; screen = 'main'; showStart(); });
  if (q('refreshBtn')) { q('refreshBtn').addEventListener('click', () => refreshLobbies()); if (!lobbyList && !listBusy) refreshLobbies(); }
  if (q('lobbyRows')) q('lobbyRows').addEventListener('click', (e) => { const b = e.target.closest('button[data-join]'); if (b) { lockButtons(box); joinLobby(b.dataset.join); } });
  wireMap((k) => { if (net.isHost) { lobby.map = k; broadcastLobby(); } });
  if (q('startBtn')) q('startBtn').addEventListener('click', () => { if (net.isHost) hostStart(); });
  if (q('leaveBtn')) q('leaveBtn').addEventListener('click', () => { lobby.rejoinCode = null; leaveOnline(''); });
}
function lockButtons(box) { for (const b of box.querySelectorAll('button')) if (b.id !== 'backBtn') b.disabled = true; }
function unlockButtons() { const box = hud.el.panel.querySelector('#online'); if (box) for (const b of box.querySelectorAll('button')) b.disabled = false; }
function renderLobby() { if (game.state === 'lobby') showStart(); }
function showStart() {
  hud.setGameplayVisible(false);
  if (game.state === 'lobby') screen = 'lobby';
  const html = screen === 'lobby' ? lobbyHTML() : screen === 'online' ? onlineHTML() : mainHTML();
  hud.showScreen(html);
  wireAppearance();
  const p = hud.el.panel;
  if (screen === 'main') {
    const languagePicker = p.querySelector('#languagePicker');
    for (const event of ['click', 'keydown']) languagePicker.addEventListener(event, e => e.stopPropagation());
    p.querySelector('#setLanguage').addEventListener('change', e => selectLanguage(e.target.value));
    wireSettings(); wireCheckpoints((w) => beginAtWave(w)); wireMap((k) => { mapKey = k; localStorage.setItem('doodle_map', k); showStart(); });
    for (const id of ['soloBtn', 'playMapBtn']) p.querySelector('#' + id).addEventListener('click', (e) => { e.stopPropagation(); begin(); });
    p.querySelector('#onlineBtn').addEventListener('click', (e) => { e.stopPropagation(); screen = 'online'; showStart(); });
  } else wireOnline();
}
function showPause() {
  if (online()) {
    hud.showScreen(ui`<h1>Menu</h1><h2>Free for all · Lobby ${String(net.aliasCode || net.code || '').replace(/-\d+$/, '')}</h2><div class="scoreboard">${sortedScores().map(([id, s]) => ui`<div class="${id === net.id ? 'me' : ''}"><span>${esc(s.name)}</span><span>${s.kills} kills · ${s.deaths} deaths</span></div>`).join('')}</div>${CONTROLS_HTML}${settingsHTML()}<div class="online" id="online"><div class="row"><button type="button" class="alt" id="leaveBtn">Leave match</button></div></div><div class="go">Click to resume or press ${hud.key('confirm')} </div>`);
    if(teamMode()){hud.el.panel.querySelector('h2').textContent=(roundMode()?ui('Team elimination'):ui('Team Deathmatch'))+' · '+teamName(teamOf(net.id));hud.el.panel.querySelector('.scoreboard').innerHTML=teamBoardHTML();}
    hud.el.panel.insertAdjacentHTML('beforeend',moderationHTML()); wireSettings(); wireOnline(); return;
  }
  hud.showScreen(ui`<h1>Paused</h1><h2>${mapName(level.key)} · Wave ${game.wave} · Score ${game.score}</h2>${CONTROLS_HTML}${settingsHTML()}${menuBtnHTML()}<div class="go">Click to resume or press ${hud.key('confirm')} </div>`);
  wireSettings(); wireMenuBtn();
}
function showClickToPlay() { if(teamMode()){hud.showScreen(`<h1>${ui('Match ready')}</h1><h2>${roundMode()?ui('Team elimination'):ui('Team Deathmatch')} · ${teamName(teamOf(net.id))}</h2><div class="go">${ui('Click to play')}</div>`);return;} hud.showScreen(ui`<h1>Match ready</h1><h2>Free for all · Target: ${matchTarget()} kills</h2><div class="go">Click to start or press ${hud.key('confirm')} .</div>`); }
function showDead() {
  hud.setGameplayVisible(false); const nb = game.score > best; if (nb) { best = game.score; localStorage.setItem('doodle_best', String(best)); }
  hud.showScreen(ui`<h1>Out of ink</h1><div class="stats"><b>${game.wave}</b> wave · <b>${game.kills}</b> kills · Score <b>${game.score}</b>${nb ? ui(" · <b>New record</b>") : ui` · Best score ${best}`}</div>${checkpointHTML()}${menuBtnHTML()}<div class="go">Click to play again or press ${hud.key('confirm')} </div>`);
  wireCheckpoints((w) => beginAtWave(w)); wireMenuBtn();
}
function menuBtnHTML() { return ui("<div class=\"online menubtn\"><div class=\"row\"><button type=\"button\" class=\"alt\" id=\"menuBtn\">Main menu</button></div></div>"); }
function wireMenuBtn() { const b = hud.el.panel.querySelector('#menuBtn'); if (b) b.addEventListener('click', (e) => { e.stopPropagation(); toMainMenu(); }); }
function toMainMenu() { game.state = 'start'; game.mode = 'solo'; game.menu = false; setArena(false); resetGame(); audio.reelLoop(false); input.exitLock(); hud.setGameplayVisible(false); screen = 'main'; showStart(); }
function toLobbyScreen() { net.inMatch = false; for (const r of remote.values()) r.lastSeen = performance.now(); setArena(true); resetGame(); game.state = 'lobby'; game.over = null; game.menu = false; hud.setGameplayVisible(false); hud.setBoard(null); screen = 'lobby'; showStart(); }

// ---------------- run control ----------------
function resetGame() {
  if (level.breakables.some((b) => !b.alive)) setLevel(loadedKey, arenaLoaded, true);
  enemies.clear(); effects.clear(); for (const p of pickups) R.scene.remove(p.mesh); pickups.length = 0; pickupClock = 0;
  player.maxHp = online() ? 110 : 120; player.regenDelay = online() ? 4 : 4.5; player.regenRate = online() ? 14 : 11;
  player.reset(level.playerStart); player.name = myName; player.lastHitBy = null; player.lastHit = null; enemies.mods.speed = 1; enemies.mods.damage = 1; enemies.mods.incomingDamage = 1.2; hud.setModifier(''); hud.setBoss(null, null); game.boss = null; endFocus(); game.katanaStreak = 0;
  game.score = 0; game.kills = 0; game.combo = 0; game.wave = 0; game.intermission = 0; game.queue = []; game.time = 0; game.over = null; game.matchT = 0; hud.setScore(0, 0); hud.setTimer(''); hud.setPvpScore(null); hud.setWave(1, 0); hud.setBoard(null);
}
function beginCommon() { audio.init(); audio.resume(); if (!input.usingGamepad) input.requestLock(); if (musicWanted && !audio.musicPlaying) audio.musicOn(true); hud.hideScreen(); hud.setGameplayVisible(true); game.menu = false; }
function begin() { game.mode = 'solo'; setArena(false); beginCommon(); if (game.state === 'start' || game.state === 'dead') { resetGame(); startWave(1); } game.state = 'play'; }
function beginAtWave(n) { game.mode = 'solo'; setArena(false); beginCommon(); resetGame(); startWave(n); game.state = 'play'; }
function jumpToWave(n) { enemies.clear(); effects.clear(); enemies.mods.speed = 1; enemies.mods.damage = 1; endFocus(); game.intermission = 0; game.queue = []; startWave(n); hud.hideScreen(); hud.setGameplayVisible(true); game.state = 'play'; game.menu = false; audio.reelLoop(false); }
function hostStart() {
  if (!net.active || !net.isHost) return;
  if(lobby.matchMode==='teams'){hostStartTeams();return;}
  if(lobby.matchMode==='tdm'&&!TEAMS.every(t=>[...lobby.players.values()].some(p=>p.team===t))){lobby.status=ui('Both teams need at least one player');renderLobby();return;}
  scores.clear(); for (const [id, p] of lobby.players) scores.set(id, { name: p.name, kills: 0, deaths: 0 });
  // deal everyone a different spot, shuffled so the same people do not always start together
  setArena(true); const order = spawnSpots().map((_, i) => i); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const spawns = {}; [...lobby.players.keys()].forEach((id, i) => { spawns[id] = order[i % order.length]; });
  hostMines.clear();approvedGrenades.clear();startMatch(false, spawns[net.id]); combat.clear(lobby.katana);
  for (const id of lobby.players.keys()) applyVitals(combat.add(id, spawnSpots()[spawns[id]].toArray()));
  const start = { matchMode: game.matchMode, map: lobby.map || mapKey, katana: lobby.katana, killTarget: game.killTarget };
  for (const pid of net.conns.keys()) net.sendTo(pid, 'start', { ...start, spawns: { [pid]: spawns[pid] }, vitals: viewsFor(pid) });
  sendScores();
}
function startMatch(late, spawnIdx) {
  game.matchMode=lobby.matchMode==='tdm'?'tdm':'ffa'; game.teamScores={red:0,blue:0}; game.round=null; teamMatch=null;
  pendingHits.clear(); deathEvents.clear(); game.killTarget = normalizeKillTarget(lobby.killTarget); game.katanaAllowed = lobby.katana !== false;
  net.inMatch = true; game.mode = 'ffa'; syncTeamColors(); setArena(true); resetGame(); matchLeft = FFA_TIME; clockT = 0; game.clockStarted = false;
  // nobody sends snapshots in the lobby, so the silence clock restarts here or the sweep would drop everyone
  for (const r of remote.values()) r.lastSeen = performance.now();
  if (!scores.size) for (const [id, p] of lobby.players) scores.set(id, { name: p.name, kills: 0, deaths: 0 });
  const spots = spawnSpots(); player.reset(spawnIdx != null && spots[spawnIdx] ? spots[spawnIdx].clone() : arenaSpawn()); beginCommon(); game.state = 'play'; screen = 'lobby'; player.shieldT = 2;
  if (late) net.broadcast('mine-sync', { map: level.key });
  refreshScoreHud(); hud.message(teamMode()?ui("Team Deathmatch"):ui("Free for all"), late ? ui("Joined a match in progress") : ui("Target: ") + matchTarget() + ui(" kills · ") + Math.round(FFA_TIME / 60) + (teamMode()?ui(" minutes · Every kill counts for your team"):ui(" minutes · Everyone is a rival")), 3);
  hud.tip(ui`Scoreboard: <b>${hud.key('score')}</b> hold.`, 5);
  // a match started by someone else's click cannot grab the mouse: ask for a click
  setTimeout(() => { if (game.state === 'play' && !input.pointerLocked && !input.usingGamepad) { game.menu = true; showClickToPlay(); } }, 250);
}
function pause() { if ((game.state !== 'play' && !(game.state === 'dying' && online())) || game.menu) return; if (!online()) game.state = 'pause'; game.menu = true; showPause(); audio.reelLoop(false); }
function resume() { if (online()) { if (respawnLocal()) return; game.menu = false; hud.hideScreen(); hud.setGameplayVisible(true); if (!input.usingGamepad) input.requestLock(); return; } begin(); }
if (DEV_DEBUG) Object.assign(window.__game, { startWave, updateWaves, begin, beginAtWave, jumpToWave, resetGame, spawnPickup, focusCandidate, enterFocus, pickSpawn, startMatch, createLobby, joinLobby, quickPlay, leaveOnline, hostStart });
hud.onScreenClick = () => {
  const st = game.state;
  if (st === 'over') { if (net.isHost) { net.send('backtolobby', {}); toLobbyScreen(); } return; }
  if (st === 'lobby') return;
  if (st === 'start') { if (screen === 'main') begin(); return; }
  if ((st === 'play' || st === 'dying') && game.menu) { resume(); return; }
  if (st === 'pause' || st === 'dead') resume();
};
canvas.addEventListener('click', () => { if (!game.menu && respawnLocal()) return; if (game.state === 'play' && !game.menu && !input.pointerLocked && !input.usingGamepad) input.requestLock(); });
input.onLockChange = (locked) => { if (!locked && game.state === 'play' && !game.menu && !input.usingGamepad) pause(); };
input.onDeviceChange = (pad) => { hud.setDevice(pad); hud.setWeapon(player.weapon.name, player.weapon.hint); };
// Browser-reserved shortcuts such as Ctrl+W can bypass page key handlers.
// Protect an ongoing game from accidental close/reload with the native leave prompt.
window.addEventListener('beforeunload', (event) => {
  if (!['play', 'dying', 'pause'].includes(game.state)) return;
  event.preventDefault(); event.returnValue = '';
});
window.addEventListener('pagehide', () => { if (net.active) net.leave(); });
// browsers only let audio start on a gesture; any press wakes the context if it went to sleep
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, () => { audio.init(); audio.resume(); }, { passive: true });
hud.setDevice(input.usingGamepad); applySettings(); hud.setWeapon(player.weapon.name, player.weapon.hint); showStart();

// ---------------- loop ----------------
let last = performance.now(), boardToggle = false, lockTipT = 0.5, musicHealT = 2;
function tick(now) { requestAnimationFrame(tick); step(now); }
// browsers starve animation frames in hidden tabs; a host that alt-tabs would freeze everyone's
// match, so a coarse timer runs extra steps (never extra frame chains) while that happens
setInterval(() => { if (net.active && performance.now() - last > 300) step(performance.now()); }, 250);
function step(now) {
  // never more than 50 ms a step: a bigger jump (a tab coming back) makes the springs in the view model fly apart
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  input.update(dt);
  let st = game.state;
  if (st === 'start' || st === 'pause' || st === 'dead' || st === 'over') { if (input.pressed('jump') || input.pressed('confirm') || (st === 'pause' && input.pressed('pause'))) hud.onScreenClick(); }
  else if ((st === 'play' || (st === 'dying' && online())) && input.pressed('pause')) { if (game.menu) resume(); else { pause(); input.exitLock(); } }
  else if ((st === 'play' || st === 'dying') && game.menu && (input.pressed('jump') || input.pressed('confirm'))) resume();
  st = game.state; const playing = st === 'play' || st === 'dying';
  if (input.pressed('music')) { musicWanted = !musicWanted; localStorage.setItem('doodle_music', musicWanted ? '1' : '0'); audio.musicOn(musicWanted); hud.tip(musicWanted ? ui("Music on") : ui("Music off"), 1.5); }
  if (online() && playing) {
    if (input.usingGamepad && input.pressed('score')) boardToggle = !boardToggle;
    const want = ((input.down('score') && !input.usingGamepad) || boardToggle) && !game.menu; if (want !== !hud.el.board.hidden) hud.setBoard(want ? boardHTML() : null);
  } else boardToggle = false;
  if (st === 'play' && !game.menu && !input.pointerLocked && !input.usingGamepad) { lockTipT -= dt; if (lockTipT <= 0) { lockTipT = 2.5; hud.tip(ui("Click the game to play"), 2); } }
  let scale = 1;
  if (game.hitstopT > 0) { game.hitstopT -= dt; scale = game.hitstopScale; }
  else if (game.focus.active) scale = FOCUS_SCALE;
  const sdt = dt * scale;
  // Update anchors before player physics. Online scenes share host time even after late joins or tab throttling.
  for (const a of level.animated) a.update(net.active ? sceneClock.time() : game.time);
  if (st === 'play' && !online()) updateFocus(dt); else endFocus();
  if (playing) {
    game.time += sdt; if (player.shieldT > 0) player.shieldT -= dt;
    musicHealT -= dt; if (musicHealT <= 0) { musicHealT = 2; if (musicWanted && st === 'play' && !audio.musicPlaying && audio.ctx) audio.musicOn(true); if (input.anyInput) audio.resume(); }
    { const B = level.bounds, bp = player.body.pos; if (bp.x < B.minX - 8 || bp.x > B.maxX + 8 || bp.z < B.minZ - 8 || bp.z > B.maxZ + 8 || bp.y > 150) bp.y = -100; }
    player.update(sdt); enemies.update(sdt); effects.update(sdt); updatePickups(sdt); netUpdate(dt);
    if (st === 'play' && !online()) updateWaves(sdt);
    if (online()) updateArenaPickups(dt);
    if (game.comboT > 0) { game.comboT -= sdt; if (game.comboT <= 0) { game.combo = 0; hud.setScore(game.score, 0); } }
    if (st === 'dying') {
      game.deathT += dt;
      if (online()) {
        game.respawnT = Math.max(0, (game.respawnAt - performance.now()) / 1000);
        if (!game.menu && game.respawnT === 0 && !input.down('pause') &&
            (input.pressed('fire') || input.pressed('jump') || input.pressed('confirm'))) respawnLocal();
      }
      else if (game.deathT > 1.7) { game.state = 'dead'; showDead(); input.exitLock(); }
    }
  } else {
    game.time += dt; if (st === 'start' || st === 'dead' || st === 'lobby' || st === 'over') player.idleCam(game.time); effects.update(dt); if (net.active) netUpdate(dt);
    if (st === 'over') { game.overT += dt; if (net.isHost && game.overT > 8) { net.send('backtolobby', {}); toLobbyScreen(); } else if (!net.isHost && game.overT > 15) { toLobbyScreen(); } }
  }
  spectateTeammate();
  audio.setListener(player.eye, player.right);
  const w = player.weapon; if (w.isGun) hud.setAmmo(w.mag, w.reserveText, w.magSize, w.reloading); else hud.setKatana();
  hud.setSupport(player.ordnance);
  hud.setSlots(player.weapons.map((wp, i) => ({ name: player.weaponAllowed(i)?wp.name:ui('Katana disabled'), active: i === player.weaponIndex, ammo: !player.weaponAllowed(i)?'—':wp.isGun ? wp.mag + '/' + wp.reserveText : '∞', empty: !player.weaponAllowed(i) || wp.isGun && !wp.infiniteReserve && wp.mag === 0 && wp.reserve === 0 })));
  hud.setGrenades(player.grenades); hud.setGrappleStamina(player.grapStam); hud.setHealth(player.hp, player.maxHp); hud.setSpread(w.spreadPx); hud.update(dt);
  if (online()) hud.setFocusMeter(playing, player.grapStam, false, 'Grapple');
  else hud.setFocusMeter(playing && (w.kind === 'katana' || game.katanaStreak > 0 || game.focus.active), game.focus.active ? 1 : clamp(game.katanaStreak / KATANA_CHARGE_KILLS, 0, 1), game.focus.active, 'Katana');
  if (game.boss) { if (game.boss.alive) hud.setBoss(game.boss.T.name, game.boss.hp / game.boss.maxHp); else { hud.setBoss(null, null); game.boss = null; } }
  audio.setIntensity(clamp((enemies.alive + game.queue.length + remote.size * 2) / 12, 0, 1) * (game.intermission > 0 ? 0.25 : 1));
  hud.setRespawn(online() && !roundMode() && game.state === 'dying' && !game.menu ? game.respawnT : null);
  nameplates.update(remote, R.camera, world, online() && game.state === 'play' && !game.menu && player.alive);
  R.render(game.time, { hurt: player.hurtFx, flash: player.flashFx, slow: scale < 1 ? 1 : 0, lowHp: player.alive && player.hp < 30 ? 1 - player.hp / 30 : 0 });
}
requestAnimationFrame(tick);
