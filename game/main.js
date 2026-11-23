// BLACKWATER CIENAGA 3D — game loop, input, AI, HUD, audio, minimap, shot presets.
import {
  WORLD, genWorld, isLand, clamp, dist2, fmtCash, fogDensity, skyColor,
  createState, startMission, nextMissionId, updateMission, currentMission, currentObjective,
  addWanted, decayWanted, refreshPatrol, gatorHit, damagePlayer, spotlightRepel,
  gatorAggression, gatorHuntRange,
  buyUpgrade, topSpeed, useCrew, tickCooldowns,
  respectRank, saveGame, loadGame, MISSIONS, ACT_NAMES, UPGRADES,
} from './logic.js';
import { Renderer, buildWorldMeshes, buildEntityMeshes, fogBankPositions, mIdentity, mPerspective, mLookAt, mModel, mTranslate } from './game.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot') ? parseInt(params.get('shot'), 10) : 0;
const SEED = params.get('seed') ? parseInt(params.get('seed'), 10) : 1337;

let state = createState(SEED);
let world = genWorld(SEED);

// error trap for headless verification (registered before the renderer is built)
window.__errors = [];
window.addEventListener('error', (e) => { window.__errors.push(String(e.message)); const el = $('errlog'); if (el) el.textContent = window.__errors.join(' | '); });

const canvas = $('game');
const renderer = new Renderer(canvas);
const meshes = buildWorldMeshes(renderer.gl, world);
const ent = buildEntityMeshes(renderer.gl);
function resize() { renderer.resize(window.innerWidth, window.innerHeight); }
window.addEventListener('resize', resize); resize();

// ---- input
const keys = {};
window.addEventListener('keydown', (e) => {
  keys[e.key.toLowerCase()] = true;
  if (e.key === 'Escape') togglePause();
  if (e.key.toLowerCase() === 'e') interact();
  if (e.key.toLowerCase() === 'f') { state.spotlight = !state.spotlight; }
  if (e.key.toLowerCase() === 'm') toggleMissions();
  if (e.key.toLowerCase() === 'g') toggleWorkshop();
  if (e.key.toLowerCase() === 'q') { state.radio = (state.radio + 1) % 3; note('Radio: ' + STATIONS[state.radio].name); }
  if (e.key === '1') useCrew(state, 'delia');
  if (e.key === '2') useCrew(state, 'sable');
  if (e.key.toLowerCase() === 'r') { state.pos = { x: 0, z: 0 }; state.vehicle = 'foot'; state.speed = 0; note('Back on the levee road.'); }
});
window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });

let paused = false, showMissions = false, showWorkshop = false;
function togglePause() { paused = !paused; $('pause').style.display = paused ? 'block' : 'none'; }
function toggleMissions() { showMissions = !showMissions; renderMissionList(); $('missions').style.display = showMissions ? 'block' : 'none'; }
function toggleWorkshop() {
  if (!nearDock()) { note('Workshop is at Mudskipper Dock.'); return; }
  showWorkshop = !showWorkshop; renderWorkshop(); $('workshop').style.display = showWorkshop ? 'block' : 'none';
}
function nearDock() { return dist2(state.pos.x, state.pos.z, WORLD.dock.x, WORLD.dock.z) < 60 * 60; }
function note(t) { state.msg = t; state.msgT = 3; }

function interact() {
  if (state.dialogue.length && state.dialogueIdx < state.dialogue.length) {
    state.dialogueIdx++; showDialogue(); return;
  }
  if (state.vehicle === 'foot') {
    const dBoat = dist2(state.pos.x, state.pos.z, WORLD.dock.x + 18, WORLD.dock.z + 26);
    if (dBoat < 14 * 14) { state.vehicle = 'airboat'; note('Aboard the Mudskipper. WASD to drive.'); return; }
    const dTruck = dist2(state.pos.x, state.pos.z, 700, 8);
    if (dTruck < 12 * 12) { state.vehicle = 'truck'; note('Aboard the Levee Runner.'); return; }
    const dBar = dist2(state.pos.x, state.pos.z, WORLD.bar.x, WORLD.bar.z);
    if (dBar < 18 * 18) {
      const id = nextMissionId(state);
      if (id) { startMission(state, id); showDialogue(); }
      else note('All 12 runs done. You are a Marsh Legend.');
      return;
    }
  } else {
    state.vehicle = 'foot'; state.speed = 0;
    note('On foot. E near a boat or truck to board.');
  }
}

function showDialogue() {
  const box = $('dialogue');
  if (state.dialogue.length && state.dialogueIdx < state.dialogue.length) {
    const line = state.dialogue[state.dialogueIdx];
    const [who, ...rest] = line.split(':');
    $('dlg-name').textContent = who.trim();
    $('dlg-text').textContent = rest.join(':').trim();
    $('dlg-face').textContent = (who.trim()[0] || 'R');
    $('dlg-face').style.background = who.includes('ODETTE') ? '#8a4b6e' : who.includes('DELIA') ? '#4b6e8a' : who.includes('SABLE') ? '#4b8a5e' : who.includes('COLE') ? '#7a2e2e' : '#6e5a2e';
    box.style.display = 'block';
  } else box.style.display = 'none';
}

// ---- audio: WebAudio synth engine + 3 procedural radio stations
const STATIONS = [
  { name: 'WBRZ · Swamp Blues', wave: 'triangle', scale: [0, 3, 5, 7, 10], bpm: 92 },
  { name: 'KREW · Zydeco Stomp', wave: 'square', scale: [0, 2, 4, 7, 9], bpm: 132 },
  { name: 'WLDN · Night Drone', wave: 'sine', scale: [0, 5, 7, 12], bpm: 60 },
];
let AC = null, engineOsc = null, engineGain = null, step = 0;
function audioInit() {
  if (AC) return;
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    engineOsc = AC.createOscillator(); engineOsc.type = 'sawtooth'; engineOsc.frequency.value = 55;
    engineGain = AC.createGain(); engineGain.gain.value = 0.0;
    const filt = AC.createBiquadFilter(); filt.type = 'lowpass'; filt.frequency.value = 320;
    engineOsc.connect(filt); filt.connect(engineGain); engineGain.connect(AC.destination);
    engineOsc.start();
    setInterval(radioStep, 120);
  } catch (e) { window.__errors.push('audio: ' + e.message); }
}
function radioStep() {
  if (!AC || !state.radioOn || paused) return;
  const st = STATIONS[state.radio];
  const beat = 60 / st.bpm / 2;
  const deg = st.scale[step % st.scale.length];
  const base = 110 * Math.pow(2, deg / 12);
  const o = AC.createOscillator(); o.type = st.wave; o.frequency.value = base;
  const g = AC.createGain();
  const t = AC.currentTime;
  g.gain.setValueAtTime(0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + beat * 0.9);
  o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + beat);
  if (step % 4 === 0) {
    const b = AC.createOscillator(); b.type = 'sine'; b.frequency.value = 55;
    const bg = AC.createGain(); bg.gain.setValueAtTime(0.09, t); bg.gain.exponentialRampToValueAtTime(0.001, t + beat * 1.8);
    b.connect(bg); bg.connect(AC.destination); b.start(t); b.stop(t + beat * 2);
  }
  step++;
}
function sfx(freq, dur, type = 'sine', vol = 0.12) {
  if (!AC) return;
  const o = AC.createOscillator(); o.type = type; o.frequency.value = freq;
  const g = AC.createGain(); const t = AC.currentTime;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(AC.destination); o.start(t); o.stop(t + dur);
}
window.addEventListener('pointerdown', audioInit, { once: true });
window.addEventListener('keydown', audioInit, { once: true });

// ---- colliders (houses + trees + town buildings)
const colliders = [];
for (const h of world.houses) colliders.push({ x: h.x, z: h.z, r: Math.max(h.w, h.d) * 0.62 });
for (const t of world.trees) colliders.push({ x: t.x, z: t.z, r: 1.1 });
colliders.push({ x: WORLD.bar.x, z: WORLD.bar.z, r: 12 }, { x: WORLD.workshop.x, z: WORLD.workshop.z, r: 11 });

// reed slowdown grid
const reedCells = new Set();
for (const r of world.reeds) reedCells.add(Math.floor(r.x / 20) + ',' + Math.floor(r.z / 20));
function inReeds(x, z) { return reedCells.has(Math.floor(x / 20) + ',' + Math.floor(z / 20)); }

// ---- parked vehicles (boardable)
const airboatParked = { x: WORLD.dock.x + 18, z: WORLD.dock.z + 26 };
const truckParked = { x: 700, z: 8 };

// ---- shot presets (wanted set AFTER startMission so wantedOnStart cannot push it higher)
function applyShot(n) {
  if (n === 1) { // cover: 4-star airboat chase in fog
    state.timeOfDay = 0.5; state.vehicle = 'airboat';
    state.pos = { x: -100, z: 100 }; state.angle = Math.PI * 0.75; state.speed = 20;
    startMission(state, 8); state.objectiveIdx = 1; state.dialogueIdx = 99;
    state.wanted = 4; refreshPatrol(state);
    // stage the chase for the cover: two patrols ahead in frame, one trailing
    {
      const fx = Math.sin(state.angle), fz = Math.cos(state.angle);
      const rx = Math.cos(state.angle), rz = -Math.sin(state.angle);
      const put = (p, f, r) => {
        p.x = state.pos.x + fx * f + rx * r; p.z = state.pos.z + fz * f + rz * r;
        p.a = Math.atan2(state.pos.x - p.x, state.pos.z - p.z);
        p.f = f; p.r = r; // formation offsets, held while the boat circles
      };
      if (state.patrol[0]) put(state.patrol[0], 32, 20);
      if (state.patrol[1]) put(state.patrol[1], 24, -28);
      if (state.patrol[2]) put(state.patrol[2], -30, -18);
      if (state.heli) { state.heli.x = state.pos.x + fx * 70; state.heli.z = state.pos.z + fz * 70; state.heli.h = 34; }
    }
    state.spotlight = true; state.cash = 1840; state.respect = 96; state.heat = 62;
    // gators staged close to the boat, flanking it, so their backs and eyes are
    // in frame instead of lost in the fog 20m+ out
    state.gators[0].x = state.pos.x + 8; state.gators[0].z = state.pos.z + 14;
    state.gators[1].x = state.pos.x - 10; state.gators[1].z = state.pos.z + 16;
    state.gators[2].x = state.pos.x + 15; state.gators[2].z = state.pos.z + 6;
  } else if (n === 2) { // town at night — truck parked facing the neon bar
    state.timeOfDay = 0.35; state.vehicle = 'truck';
    state.pos = { x: 826, z: -18 }; state.angle = 2.63; state.speed = 0;
    startMission(state, 6); state.objectiveIdx = 1; state.dialogueIdx = 99;
    state.wanted = 2; refreshPatrol(state);
    // keep the patrol boats far off on the water so the town frame stays clean
    let bi = 0;
    for (const p of state.patrol) {
      if (p.kind === 'airboat') { p.f = 80; p.r = bi % 2 === 0 ? 60 : -60; bi++; }
    }
    state.cash = 920; state.respect = 44; state.heat = 30;
  } else if (n === 3) { // gator water close-up (dusk, so the act label matches the sky)
    state.timeOfDay = 0.30; state.vehicle = 'airboat';
    state.pos = { x: 240, z: 520 }; state.angle = Math.PI * 1.1; state.speed = 12;
    startMission(state, 3); state.objectiveIdx = 0; state.dialogueIdx = 99;
    state.wanted = 1; refreshPatrol(state);
    state.spotlight = true; state.cash = 610; state.respect = 26;
    // gators ring the boat so the eyes are in frame whichever way it turns
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      state.gators[i].x = state.pos.x + Math.cos(a) * 24;
      state.gators[i].z = state.pos.z + Math.sin(a) * 24;
      state.gators[i].a = Math.atan2(state.pos.x - state.gators[i].x, state.pos.z - state.gators[i].z);
    }
  } else if (n === 4) { // dawn finale at hideout — Rook faces the stilt house, dawn behind it
    state.timeOfDay = 0.95; state.vehicle = 'foot';
    state.pos = { x: WORLD.hideout.x + 26, z: WORLD.hideout.z + 36 }; state.angle = -2.57;
    state.missionDone = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]; state.missionId = 12; state.objectiveIdx = 2;
    state.cash = 7450; state.respect = 178; state.heat = 12;
    state.runs = 11; state.stats.deliveries = 11; state.stats.escapes = 3; state.stats.gatorHits = 2;
    state.finished = true; state.dialogue = [];
  }
  showDialogue();
  $('shot-label').textContent = 'SHOT ' + n;
}

// ---- save / load
function saveNow() { try { localStorage.setItem('blackwater-save-v1', saveGame(state)); note('Game saved.'); } catch (e) { note('Save failed.'); } }
function loadNow() {
  const raw = localStorage.getItem('blackwater-save-v1');
  if (!raw) { note('No save found.'); return; }
  const s = loadGame(raw);
  if (s) { state = s; note('Save loaded.'); } else note('Save corrupt.');
}
$('btn-save').addEventListener('click', saveNow);
$('btn-load').addEventListener('click', loadNow);
$('btn-resume').addEventListener('click', togglePause);
$('btn-restart').addEventListener('click', () => { state = createState(SEED); if (paused) togglePause(); });
$('btn-missions').addEventListener('click', () => { togglePause(); toggleMissions(); });

// ---- mission list / workshop render
function renderMissionList() {
  const el = $('mission-list'); el.innerHTML = '';
  for (const m of MISSIONS) {
    const done = state.missionDone.includes(m.id);
    const div = document.createElement('div');
    div.className = 'mi' + (done ? ' done' : '') + (state.missionId === m.id ? ' active' : '');
    div.innerHTML = '<b>#' + m.id + ' ' + m.title + '</b> <span>' + ACT_NAMES[m.act] + ' · ' + m.giver + ' · ' + fmtCash(m.payout) + '</span><br>' + m.brief;
    if (!done && state.missionId !== m.id) {
      div.style.cursor = 'pointer';
      div.addEventListener('click', () => { startMission(state, m.id); showDialogue(); toggleMissions(); });
    }
    el.appendChild(div);
  }
}
function renderWorkshop() {
  const el = $('shop-list'); el.innerHTML = '';
  for (const u of UPGRADES) {
    const owned = !!state.upgrades[u.id];
    const div = document.createElement('div');
    div.className = 'mi';
    div.innerHTML = '<b>' + u.name + '</b> — ' + fmtCash(u.cost) + (owned ? ' · INSTALLED' : '') + '<br>' + u.desc;
    div.style.cursor = 'pointer';
    div.addEventListener('click', () => {
      if (buyUpgrade(state, u.id)) { sfx(660, 0.15); renderWorkshop(); }
      else { sfx(140, 0.25, 'square'); note('Not enough cash or already installed.'); }
    });
    el.appendChild(div);
  }
}

// ---- minimap
const mm = $('minimap').getContext('2d');
function drawMinimap() {
  const S = 168, C = S / 2, R = 78;
  mm.clearRect(0, 0, S, S);
  mm.save();
  mm.beginPath(); mm.arc(C, C, R, 0, Math.PI * 2); mm.clip();
  mm.fillStyle = '#0a2530'; mm.fillRect(0, 0, S, S);
  const scale = S / (WORLD.size * 1.05);
  const X = (x) => C + x * scale, Z = (z) => C + z * scale;
  mm.fillStyle = '#5a4a33'; mm.fillRect(X(WORLD.roadX0), Z(-16), (WORLD.roadX1 - WORLD.roadX0) * scale, 32 * scale);
  mm.fillStyle = '#3a3428'; mm.beginPath(); mm.arc(X(WORLD.town.x), Z(WORLD.town.z), WORLD.town.r * scale, 0, Math.PI * 2); mm.fill();
  mm.fillStyle = 'rgba(40,110,50,0.5)';
  for (const r of world.reeds) mm.fillRect(X(r.x) - 1, Z(r.z) - 1, 2, 2);
  mm.fillStyle = '#ffc21a';
  for (const d of world.drops) { mm.beginPath(); mm.arc(X(d.x), Z(d.z), 3, 0, Math.PI * 2); mm.fill(); }
  mm.fillStyle = '#2eff8a';
  for (const b of world.buyers) { mm.beginPath(); mm.arc(X(b.x), Z(b.z), 3, 0, Math.PI * 2); mm.fill(); }
  if (state.crew.sableActive > 0) {
    mm.fillStyle = '#ff4040';
    for (const g of state.gators) { mm.beginPath(); mm.arc(X(g.x), Z(g.z), 2.5, 0, Math.PI * 2); mm.fill(); }
    mm.fillStyle = '#4aa8ff';
    for (const p of state.patrol) { mm.beginPath(); mm.arc(X(p.x), Z(p.z), 3, 0, Math.PI * 2); mm.fill(); }
    if (state.heli) { mm.beginPath(); mm.arc(X(state.heli.x), Z(state.heli.z), 4, 0, Math.PI * 2); mm.fill(); }
  }
  const o = currentObjective(state);
  if (o) {
    mm.strokeStyle = '#ffd94a'; mm.lineWidth = 2;
    mm.beginPath(); mm.arc(X(o.x), Z(o.z), 7 + Math.sin(performance.now() / 300) * 2, 0, Math.PI * 2); mm.stroke();
    mm.fillStyle = '#ffd94a'; mm.beginPath(); mm.arc(X(o.x), Z(o.z), 2.5, 0, Math.PI * 2); mm.fill();
  }
  mm.fillStyle = '#ff8a3d'; mm.fillRect(X(WORLD.hideout.x) - 3, Z(WORLD.hideout.z) - 3, 6, 6);
  mm.save(); mm.translate(X(state.pos.x), Z(state.pos.z)); mm.rotate(-state.angle);
  mm.fillStyle = '#fff'; mm.beginPath(); mm.moveTo(0, -6); mm.lineTo(4, 5); mm.lineTo(-4, 5); mm.closePath(); mm.fill();
  mm.restore();
  mm.restore();
  mm.strokeStyle = 'rgba(255,255,255,0.5)'; mm.lineWidth = 2;
  mm.beginPath(); mm.arc(C, C, R, 0, Math.PI * 2); mm.stroke();
}

// ---- HUD
const STARS = '★★★★★';
function updateHUD() {
  const m = currentMission(state), o = currentObjective(state);
  $('hud-mission').textContent = m ? ('#' + m.id + ' ' + m.title + ' — ' + ACT_NAMES[m.act]) : (state.finished ? 'ALL RUNS COMPLETE — MARSH LEGEND' : (state.missionDone.length > 0 ? 'Run complete — ' + state.missionDone.length + ' of 12 done. Press M for the next run.' : 'No active run — press M for missions, E at the bar to start'));
  $('hud-objective').textContent = o ? o.label : (state.finished ? 'Dawn over Blackwater. The stash is safe.' : '—');
  const total = m ? m.objectives.length : 0;
  $('stage-fill').style.width = m ? Math.round((state.objectiveIdx / total) * 100) + '%' : '0%';
  $('stage-text').textContent = m ? ('Stage ' + Math.min(state.objectiveIdx + 1, total) + '/' + total) : '';
  $('hud-cash').textContent = fmtCash(state.cash);
  $('hud-respect').textContent = respectRank(state.respect) + ' · ' + state.respect + ' respect';
  $('hud-heat').textContent = 'HEAT ' + Math.round(state.heat) + '%';
  $('hud-wanted').textContent = state.wanted > 0 ? STARS.slice(0, state.wanted) : '— clear —';
  $('hud-wanted').style.color = state.wanted >= 4 ? '#ff4040' : state.wanted >= 2 ? '#ffb020' : '#ffd94a';
  $('health-fill').style.width = state.health + '%';
  $('armor-fill').style.width = (state.armor / state.maxArmor * 100) + '%';
  $('speed-num').textContent = Math.round(Math.abs(state.speed) * 2.2) + ' mph';
  $('vehicle-name').textContent = state.vehicle === 'airboat' ? 'MUDSKIPPER · airboat' : state.vehicle === 'truck' ? 'LEVEE RUNNER · truck' : 'ON FOOT · Rook Calloway';
  $('cargo-num').textContent = state.cargo > 0 ? ('CARGO ×' + state.cargo + ' · ' + fmtCash(state.cargoValue)) : 'CARGO — empty';
  $('time-label').textContent = state.timeOfDay < 0.33 ? 'DUSK' : state.timeOfDay < 0.66 ? 'MIDNIGHT' : state.timeOfDay < 0.9 ? 'PRE-DAWN' : 'DAWN';
  $('radio-label').textContent = (state.radioOn ? '♪ ' : '○ ') + STATIONS[state.radio].name;
  $('crew-delia').textContent = '1 · DELIA — field repair ' + (state.crew.deliaReady ? 'READY' : Math.ceil(state.crew.deliaCd) + 's');
  $('crew-sable').textContent = '2 · SABLE — reveal patrols ' + (state.crew.sableReady ? 'READY' : Math.ceil(state.crew.sableCd) + 's');
  $('crew-delia').classList.toggle('ready', state.crew.deliaReady);
  $('crew-sable').classList.toggle('ready', state.crew.sableReady);
  const dp = $('dispatch');
  if (state.wanted > 0 || state.heli || state.roadblock) {
    let html = '<b>LWMP DISPATCH</b><br>';
    for (const p of state.patrol) html += p.name + ' · ' + p.kind.toUpperCase() + ' · ' + p.role + ' · ' + Math.round(Math.sqrt(dist2(p.x, p.z, state.pos.x, state.pos.z))) + 'm<br>';
    if (state.heli) html += 'FOGHORN-1 · HELI · spotlight sweeping<br>';
    if (state.roadblock) html += '<span style="color:#ff6060">ROADBLOCK on the levee — 4★+</span><br>';
    dp.innerHTML = html; dp.style.display = 'block';
  } else dp.style.display = 'none';
  if (SHOT === 4 || state.finished) {
    $('payout').style.display = 'block';
    $('payout-title').textContent = state.finished ? 'DAWN FINALE — THE STASH IS SAFE' : 'PAYOUT';
    $('payout-body').innerHTML = 'Runs completed: <b>' + state.runs + '</b> · Deliveries: <b>' + state.stats.deliveries + '</b><br>Cash: <b>' + fmtCash(state.cash) + '</b> · Respect: <b>' + state.respect + ' — ' + respectRank(state.respect) + '</b><br>Gator hits survived: <b>' + state.stats.gatorHits + '</b> · Escapes: <b>' + state.stats.escapes + '</b>';
  } else $('payout').style.display = 'none';
  if (state.msgT > 0) { $('toast').textContent = state.msg; $('toast').style.display = 'block'; }
  else $('toast').style.display = 'none';
}

// ---- per-frame update
let lastT = performance.now();
let hudT = 0;
function stepAI(dt) {
  for (const b of world.boats) {
    b.x += Math.cos(b.a) * b.speed * dt; b.z += Math.sin(b.a) * b.speed * dt;
    if (Math.abs(b.x) > 1100 || Math.abs(b.z) > 1100) b.a += Math.PI * 0.8;
  }
  for (const t of world.trucks) {
    t.x += t.dir * t.speed * dt;
    if (t.x > 1080) t.dir = -1; if (t.x < -1080) t.dir = 1;
  }
  for (const p of world.peds) {
    p.x += Math.cos(p.a) * p.speed * dt; p.z += Math.sin(p.a) * p.speed * dt;
    if (dist2(p.x, p.z, WORLD.town.x, WORLD.town.z) > 130 * 130) p.a += Math.PI;
  }
  for (const g of state.gators) {
    if (SHOT) continue; // photo mode: gators hold their staged positions, eyes on the boat
    const dPlayer = Math.sqrt(dist2(g.x, g.z, state.pos.x, state.pos.z));
    const inWater = !isLand(state.pos.x, state.pos.z);
    if (state.spotlight && dPlayer < (state.upgrades.light ? 26 : 16)) g.state = 'flee';
    else if (inWater && dPlayer < gatorHuntRange(state.timeOfDay) && state.vehicle !== 'truck') g.state = 'hunt';
    else if (g.state !== 'patrol' && dPlayer > 40) g.state = 'patrol';
    if (g.state === 'hunt') {
      const a = Math.atan2(state.pos.x - g.x, state.pos.z - g.z);
      // night-aggressive gators: faster closing speed toward midnight
      g.a = a; g.x += Math.sin(a) * g.speed * 2.2 * gatorAggression(state.timeOfDay) * dt; g.z += Math.cos(a) * g.speed * 2.2 * gatorAggression(state.timeOfDay) * dt;
    } else if (g.state === 'flee') {
      const a = Math.atan2(g.x - state.pos.x, g.z - state.pos.z);
      g.x += Math.sin(a) * g.speed * 2.5 * dt; g.z += Math.cos(a) * g.speed * 2.5 * dt;
      if (Math.sqrt(dist2(g.x, g.z, g.zone.x, g.zone.z)) < g.zone.r * 0.4) g.state = 'patrol';
    } else {
      g.phase += dt * 0.3;
      g.a += Math.sin(g.phase) * 0.4 * dt;
      g.x += Math.sin(g.a) * g.speed * dt; g.z += Math.cos(g.a) * g.speed * dt;
      if (Math.sqrt(dist2(g.x, g.z, g.zone.x, g.zone.z)) > g.zone.r) g.a = Math.atan2(g.zone.x - g.x, g.zone.z - g.z);
    }
    if (!SHOT) gatorHit(state, g); // photo mode never kills the subject
  }
  for (let pi = 0; pi < state.patrol.length; pi++) {
    const p = state.patrol[pi];
    if (SHOT) {
      // photo mode: patrols fly formation on the player, holding their staged offsets
      const fx = Math.sin(state.angle), fz = Math.cos(state.angle);
      const rx = Math.cos(state.angle), rz = -Math.sin(state.angle);
      if (p.kind === 'truck') {
        // trucks stay on the levee road, ahead of the player
        p.x = state.pos.x + 130 + pi * 55; p.z = (pi % 2 === 0 ? -8 : 8); p.a = Math.PI / 2;
      } else {
        const f = p.f !== undefined ? p.f : 30;
        const r = p.r !== undefined ? p.r : (pi % 2 === 0 ? 22 : -22);
        p.x = state.pos.x + fx * f + rx * r;
        p.z = state.pos.z + fz * f + rz * r;
        p.a = Math.atan2(state.pos.x - p.x, state.pos.z - p.z);
      }
      continue;
    }
    const d = Math.sqrt(dist2(p.x, p.z, state.pos.x, state.pos.z)) || 1;
    const a = Math.atan2(state.pos.x - p.x, state.pos.z - p.z);
    if (d < 16) {
      // standoff: orbit the player at 16m instead of driving through the hull
      p.x += Math.cos(a) * p.speed * 0.7 * dt; p.z -= Math.sin(a) * p.speed * 0.7 * dt;
    } else {
      p.x += Math.sin(a) * p.speed * dt; p.z += Math.cos(a) * p.speed * dt;
    }
    p.a = a;
    if (p.cool > 0) p.cool -= dt;
    // ramming: one hit per cooldown, then the patrol peels off — never a per-frame shredder
    if (!SHOT && d < 6 && state.vehicle !== 'foot' && p.cool <= 0) {
      damagePlayer(state, 4); state.speed *= 0.6; sfx(90, 0.2, 'square', 0.15);
      p.cool = 1.5;
      p.x -= Math.sin(a) * 12; p.z -= Math.cos(a) * 12;
    }
  }
  if (state.heli) {
    const h = state.heli;
    h.sweep += dt * 0.5;
    // photo mode: the heli hovers ahead of the player so its cone is in frame
    const tx = SHOT ? state.pos.x + Math.sin(state.angle) * 70 : state.pos.x + Math.sin(h.sweep) * 30;
    const tz = SHOT ? state.pos.z + Math.cos(state.angle) * 70 : state.pos.z + Math.cos(h.sweep * 0.7) * 30;
    h.x += (tx - h.x) * dt * 0.5;
    h.z += (tz - h.z) * dt * 0.5;
    h.a = Math.atan2(state.pos.x - h.x, state.pos.z - h.z);
  }
  spotlightRepel(state, dt);
}

function stepPlayer(dt) {
  // photo mode: the airboat cruises in a tight circle near the staged spot;
  // the truck in shot 2 stays parked at the bar (it is a town portrait, not a chase)
  const autoFwd = SHOT && state.vehicle === 'airboat' ? 1 : 0;
  if (SHOT && state.vehicle === 'airboat') state.angle += 0.5 * dt; // tight circle, stays inside the reed bed
  const fwd = autoFwd || ((keys['w'] || keys['arrowup']) ? 1 : 0);
  const back = (keys['s'] || keys['arrowdown']) ? 1 : 0;
  const left = keys['a'] || keys['arrowleft'];
  const right = keys['d'] || keys['arrowright'];
  const sprint = keys['shift'] ? 1.35 : 1;
  const brake = keys[' '] ? 0.86 : 1;
  const top = topSpeed(state) * sprint;
  // photo mode cruise: airboat at a run, the truck slower so it stops on the road before the bar
  const cruise = SHOT && state.vehicle !== 'foot' ? Math.min(top, state.vehicle === 'truck' ? 8 : 14) : top;
  const accel = state.vehicle === 'foot' ? 26 : state.vehicle === 'airboat' ? 13 : 16;
  if (fwd) state.speed = Math.min(state.speed + accel * dt, cruise);
  else if (back) state.speed = Math.max(state.speed - accel * 0.8 * dt, -top * 0.4);
  else state.speed *= Math.pow(0.4, dt);
  state.speed *= brake;
  if (state.vehicle === 'airboat' && !isLand(state.pos.x, state.pos.z) && inReeds(state.pos.x, state.pos.z)) state.speed *= Math.pow(0.55, dt);
  if (state.vehicle === 'airboat' && isLand(state.pos.x, state.pos.z)) state.speed *= Math.pow(0.3, dt);
  if (state.vehicle === 'truck' && !isLand(state.pos.x, state.pos.z)) state.speed *= Math.pow(0.3, dt);
  const steer = (left ? 1 : 0) - (right ? 1 : 0);
  const steerRate = state.vehicle === 'foot' ? 3.4 : state.vehicle === 'airboat' ? 1.5 : 2.0;
  state.angle += steer * steerRate * dt * clamp(Math.abs(state.speed) / 8, 0.25, 1) * (state.speed < 0 ? -1 : 1);
  const nx = state.pos.x + Math.sin(state.angle) * state.speed * dt;
  const nz = state.pos.z + Math.cos(state.angle) * state.speed * dt;
  let px = nx, pz = nz;
  for (const c of colliders) {
    const d2 = dist2(px, pz, c.x, c.z);
    if (d2 < c.r * c.r) {
      const d = Math.sqrt(d2) || 1;
      px = c.x + (px - c.x) / d * c.r; pz = c.z + (pz - c.z) / d * c.r;
      state.speed *= 0.7;
    }
  }
  state.stats.distance += Math.abs(state.speed) * dt;
  state.pos.x = clamp(px, -WORLD.half, WORLD.half);
  state.pos.z = clamp(pz, -WORLD.half, WORLD.half);
  if (engineGain && AC) {
    engineGain.gain.value = state.vehicle === 'foot' ? 0 : 0.02 + Math.abs(state.speed) / 60;
    engineOsc.frequency.value = 45 + Math.abs(state.speed) * 3;
  }
  if (!SHOT) state.timeOfDay = clamp(state.timeOfDay + dt / 420, 0, 1);
  decayWanted(state, dt);
  tickCooldowns(state, dt);
  updateMission(state, dt);
}

// ---- render
function render(now) {
  const t = now / 1000;
  renderer.time = t;
  const sky = skyColor(state.timeOfDay);
  const fogAmt = 0.22 + fogDensity(state.timeOfDay) * 0.40;
  const fogColor = [sky[0] * 0.9 + 0.08, sky[1] * 0.9 + 0.08, sky[2] * 0.9 + 0.12];
  // chase camera: pulled back and offset to the side so the vehicle reads in 3/4
  const back = state.vehicle === 'foot' ? 9 : 12.5;
  const up = state.vehicle === 'foot' ? 4.5 : 3.6;
  const fx = Math.sin(state.angle), fz = Math.cos(state.angle);
  const rx = Math.cos(state.angle), rz = -Math.sin(state.angle);
  const cx = state.pos.x - fx * back + rx * 3.0;
  const cz = state.pos.z - fz * back + rz * 3.0;
  const eye = [cx, up + Math.abs(state.speed) * 0.03, cz];
  const center = [state.pos.x + fx * 10, 1.2, state.pos.z + fz * 10];
  const proj = mPerspective(1.05, renderer.aspect || 16 / 9, 0.5, 3200);
  const view = mLookAt(eye, center, [0, 1, 0]);
  renderer.begin(sky, fogColor, fogAmt, eye);
  renderer.setView(proj, view);
  renderer.draw(meshes.water, mIdentity(), { water: true });
  renderer.draw(meshes.land, mIdentity());
  renderer.draw(meshes.glow, mIdentity(), { emissive: true });
  // dawn water detail: at pre-dawn/dawn the open water was one flat dark sheet.
  // Lay a warm glitter field + a sun-path of light pools ahead of the player so
  // the fajar frame has reflection and ripple to look at, not empty black water.
  if (state.timeOfDay > 0.66) {
    const gx = state.pos.x + fx * 42, gz = state.pos.z + fz * 42;
    renderer.draw(ent.glitter, mModel(gx, 0.15, gz, state.angle), { blend: true, emissive: true });
    for (let i = 1; i <= 3; i++) {
      renderer.draw(ent.pool, mModel(state.pos.x + fx * (18 + i * 14), 0.18, state.pos.z + fz * (18 + i * 14), 0, 1.4 - i * 0.25, 1, 1.4 - i * 0.25), { blend: true });
    }
  }
  for (const fb of fogBankPositions(t)) {
    renderer.draw(meshes.fogBank, mModel(fb.x, fb.y, fb.z, fb.yaw, fb.sx, 0.4, 1), { blend: true });
  }
  if (state.vehicle !== 'airboat') renderer.draw(ent.airboat, mModel(airboatParked.x, 0.2, airboatParked.z, 0.6));
  if (state.vehicle !== 'truck') renderer.draw(ent.truck, mModel(truckParked.x, 0.6, truckParked.z, Math.PI / 2));
  for (const b of world.boats) renderer.draw(ent.trafficBoat, mModel(b.x, 0.15, b.z, b.a));
  for (const tr of world.trucks) renderer.draw(ent.truck, mModel(tr.x, 0.6, tr.z, tr.dir > 0 ? Math.PI / 2 : -Math.PI / 2));
  for (const p of world.peds) renderer.draw(ent.person, mModel(p.x, 0.5, p.z, p.a));
  for (const g of state.gators) {
    renderer.draw(ent.gator, mModel(g.x, 0.15, g.z, g.a));
    // faint wake ring under each gator so the body reads against dark water
    renderer.draw(ent.pool, mModel(g.x, 0.12, g.z, 0, 0.55, 1, 0.55), { blend: true });
    // glowing eyes above the water — the gator's tell at night
    const fx = Math.sin(g.a), fz = Math.cos(g.a);
    const ex = g.x + fx * 2.7, ez = g.z + fz * 2.7;
    const px2 = Math.cos(g.a), pz2 = -Math.sin(g.a);
    renderer.draw(ent.eye, mModel(ex + px2 * 0.28, 0.8, ez + pz2 * 0.28, 0), { emissive: true });
    renderer.draw(ent.eye, mModel(ex - px2 * 0.28, 0.8, ez - pz2 * 0.28, 0), { emissive: true });
  }
  for (const p of state.patrol) {
    if (p.kind === 'airboat') renderer.draw(ent.patrolBoat, mModel(p.x, 0.2, p.z, p.a || 0));
    else renderer.draw(ent.truck, mModel(p.x, 0.6, p.z, p.a || 0));
  }
  if (state.roadblock) {
    for (const bx of [-140, 120]) {
      renderer.draw(ent.truck, mModel(bx, 0.6, -6, 0));
      renderer.draw(ent.truck, mModel(bx + 30, 0.6, 8, 0));
    }
  }
  if (state.heli) {
    const h = state.heli;
    renderer.draw(ent.heli, mModel(h.x, h.h, h.z, h.a || 0));
    renderer.draw(ent.rotor, mModel(h.x, h.h + 1.6, h.z, t * 18));
    const tx = state.pos.x + Math.sin(h.sweep) * 12, tz = state.pos.z + Math.cos(h.sweep * 0.7) * 12;
    // layered beam: wide faint halo outside, mid cone, bright narrow core —
    // a directed shaft of light sweeping the fog, not one pale triangle
    renderer.draw(ent.coneHalo, mModel(h.x, h.h - 1, h.z, 0), { blend: true });
    renderer.draw(ent.cone, mModel(h.x, h.h - 1, h.z, 0), { blend: true });
    renderer.draw(ent.coneCore, mModel(h.x, h.h - 1, h.z, 0), { blend: true });
    renderer.draw(ent.pool, mModel(h.x, 0.25, h.z, 0), { blend: true });
  }
  if (state.spotlight) {
    const px = state.pos.x + Math.sin(state.angle) * 2, pz = state.pos.z + Math.cos(state.angle) * 2;
    const py = state.vehicle === 'foot' ? 1.6 : 2.0;
    renderer.draw(ent.spotCone, mModel(px, py, pz, state.angle, 1, 1, 1), { blend: true });
    renderer.draw(ent.pool, mModel(state.pos.x + Math.sin(state.angle) * 18, 0.25, state.pos.z + Math.cos(state.angle) * 18, 0), { blend: true });
  }
  if (state.vehicle === 'airboat') renderer.draw(ent.airboat, mModel(state.pos.x, 0.2, state.pos.z, state.angle));
  else if (state.vehicle === 'truck') renderer.draw(ent.truck, mModel(state.pos.x, 0.6, state.pos.z, state.angle));
  else renderer.draw(ent.person, mModel(state.pos.x, 0.5, state.pos.z, state.angle));
  const o = currentObjective(state);
  // objective beacon: a light pillar rising from the water (cone flipped upward)
  if (o) renderer.draw(ent.cone, mModel(o.x, 0.5, o.z, 0, 0.3, -1.2, 0.3), { blend: true });
}

// ---- main loop
let frames = 0;
function frame(now) {
  const dt = Math.min((now - lastT) / 1000, 0.05);
  lastT = now;
  if (!paused) { stepPlayer(dt); stepAI(dt); }
  render(now);
  hudT += dt;
  if (hudT > 0.12) { hudT = 0; updateHUD(); drawMinimap(); }
  frames++;
  if (frames === 5) { window.__shotReady = true; document.title = 'BLACKWATER CIENAGA 3D — ready'; }
  requestAnimationFrame(frame);
}

// ---- boot
if (SHOT >= 1 && SHOT <= 4) applyShot(SHOT);
else {
  const saved = localStorage.getItem('blackwater-save-v1');
  if (saved) { const s = loadGame(saved); if (s) state = s; }
  if (!state.missionId && state.missionDone.length === 0) {
    state.msg = 'Dusk on Blackwater. Go to The Gator\u2019s Grin (E) — Mama Odette has work.';
    state.msgT = 6;
  }
}
showDialogue();
updateHUD();
requestAnimationFrame(frame);
