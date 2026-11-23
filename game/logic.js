// BLACKWATER CIENAGA 3D — pure game logic (no DOM, no WebGL).
// Shared by the browser game (game.js) and the Node logic tests.
// Deterministic: every world fact derives from the seed.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
export function dist2(ax, az, bx, bz) { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; }
export function fmtCash(n) { return '$' + Math.round(n).toLocaleString('en-US'); }

// ---------------------------------------------------------------- world

export const WORLD = {
  size: 2400, half: 1200,
  roadZ: 0, roadHalf: 16, roadX0: -1100, roadX1: 1100,
  town: { x: 820, z: 0, r: 150 },
  dock: { x: 760, z: 64 },
  bar: { x: 848, z: -52 },
  workshop: { x: 724, z: -44 },
  hideout: { x: -620, z: 420 },
  moonDir: { x: -0.35, y: 0.55, z: -0.75 },
};

export function isLand(x, z) {
  if (x >= WORLD.roadX0 && x <= WORLD.roadX1 && Math.abs(z - WORLD.roadZ) <= WORLD.roadHalf) return true;
  const dx = x - WORLD.town.x, dz = z - WORLD.town.z;
  if (dx * dx + dz * dz <= WORLD.town.r * WORLD.town.r) return true;
  return false;
}

export function genWorld(seed) {
  const rnd = mulberry32(seed);
  const reeds = [];
  for (let i = 0; i < 46; i++) {
    const cx = (rnd() * 2 - 1) * 1080, cz = (rnd() * 2 - 1) * 1080;
    if (isLand(cx, cz)) continue;
    if (dist2(cx, cz, WORLD.hideout.x, WORLD.hideout.z) < 120 * 120) continue;
    const n = 5 + Math.floor(rnd() * 9);
    for (let j = 0; j < n; j++) reeds.push({ x: cx + (rnd() * 2 - 1) * 26, z: cz + (rnd() * 2 - 1) * 26, h: 2.2 + rnd() * 2.4, lean: (rnd() * 2 - 1) * 0.25 });
  }
  // guaranteed dense reed beds at the signature spots (gator-water close-up + chase)
  for (const [bcx, bcz] of [[240, 520], [-100, 100], [300, 300]]) {
    for (let j = 0; j < 24; j++) {
      const a = rnd() * Math.PI * 2, r = 8 + rnd() * 52;
      reeds.push({ x: bcx + Math.cos(a) * r, z: bcz + Math.sin(a) * r, h: 2.4 + rnd() * 2.6, lean: (rnd() * 2 - 1) * 0.25 });
    }
  }
  const trees = [];
  for (let i = 0; i < 64; i++) {
    const x = (rnd() * 2 - 1) * 1120, z = (rnd() * 2 - 1) * 1120;
    if (isLand(x, z)) continue;
    if (dist2(x, z, WORLD.hideout.x, WORLD.hideout.z) < 90 * 90) continue;
    trees.push({ x, z, h: 9 + rnd() * 9, r: 2.2 + rnd() * 2.2, knees: 3 + Math.floor(rnd() * 5) });
  }
  const houses = [];
  const houseSpots = [
    [-420, -300], [-180, 520], [120, -480], [380, 380], [-760, -140], [60, 700],
    [-940, 520], [520, -620], [-300, -720], [880, 260], [-40, -180], [300, 120],
  ];
  for (const [hx, hz] of houseSpots) {
    houses.push({ x: hx + (rnd() * 2 - 1) * 20, z: hz + (rnd() * 2 - 1) * 20, w: 9 + rnd() * 5, d: 8 + rnd() * 4, rot: rnd() * Math.PI, lit: rnd() < 0.6, hue: rnd() });
  }
  const drops = [
    { id: 'A', x: -380, z: -180, label: 'Dead-drop A — hollow cypress' },
    { id: 'B', x: 240, z: 560, label: 'Dead-drop B — reed bed' },
    { id: 'C', x: -860, z: 120, label: 'Dead-drop C — sunken skiff' },
    { id: 'D', x: 120, z: -760, label: 'Dead-drop D — gator nest edge' },
    { id: 'E', x: 640, z: -520, label: 'Dead-drop E — old trapper cabin' },
    { id: 'F', x: -140, z: 880, label: 'Dead-drop F — heron rookery' },
  ];
  const buyers = [
    { id: 1, x: -520, z: 300, label: 'Buyer — Stilt house west' },
    { id: 2, x: 180, z: -420, label: 'Buyer — Stilt house north' },
    { id: 3, x: 560, z: 480, label: 'Buyer — Stilt house east' },
  ];
  const gatorZones = [
    { x: -300, z: -60, r: 130 }, { x: 300, z: 300, r: 110 }, { x: -700, z: -420, r: 120 },
    { x: 80, z: 700, r: 120 }, { x: -80, z: -520, r: 100 }, { x: 700, z: 240, r: 100 },
    { x: -520, z: 640, r: 110 }, { x: 420, z: -300, r: 90 },
  ];
  const boats = [];
  for (let i = 0; i < 9; i++) {
    boats.push({ x: (rnd() * 2 - 1) * 900, z: (rnd() * 2 - 1) * 900, kind: i % 3 === 0 ? 'tour' : 'fisher', a: rnd() * Math.PI * 2, speed: 2 + rnd() * 3 });
  }
  const trucks = [];
  for (let i = 0; i < 6; i++) {
    trucks.push({ x: -1000 + i * 340 + rnd() * 60, z: (rnd() * 2 - 1) * 10, dir: i % 2 === 0 ? 1 : -1, speed: 9 + rnd() * 5 });
  }
  const peds = [];
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, r = 20 + rnd() * 120;
    peds.push({ x: WORLD.town.x + Math.cos(a) * r, z: WORLD.town.z + Math.sin(a) * r * 0.8, a: rnd() * Math.PI * 2, speed: 0.8 + rnd() * 1.2, hue: rnd() });
  }
  return { reeds, trees, houses, drops, buyers, gatorZones, boats, trucks, peds };
}

// ---------------------------------------------------------------- missions

// Objective kinds: reach | pickup | deliver | talk | survive | collect
export const MISSIONS = [
  { id: 1, act: 1, title: 'First Light on Blackwater', giver: 'Mama Odette', payout: 150, respect: 10,
    brief: 'Dusk on the Cienaga. Mama Odette is waiting at The Gator\u2019s Grin. Take the Mudskipper and learn the water.',
    dialogue: ['ROOK: One night, one boat, no trouble. That\u2019s the deal.', 'ODETTE: Trouble finds the water, boy. You just outrun it.'],
    objectives: [
      { kind: 'talk', label: 'Meet Mama Odette at The Gator\u2019s Grin', x: WORLD.bar.x, z: WORLD.bar.z, r: 14 },
      { kind: 'reach', label: 'Reach Mudskipper Dock', x: WORLD.dock.x, z: WORLD.dock.z, r: 16 },
      { kind: 'reach', label: 'Board the airboat Mudskipper (press E)', x: WORLD.dock.x + 18, z: WORLD.dock.z + 26, r: 12, needVehicle: 'airboat' },
    ] },
  { id: 2, act: 1, title: 'The Dead-Drop Run', giver: 'Mama Odette', payout: 400, respect: 12,
    brief: 'A package waits in the hollow cypress. Pick it up, run it to the west stilt house. Quiet water, quiet engine.',
    dialogue: ['ODETTE: The drop is marked. Don\u2019t stop for the eyes in the water.'],
    objectives: [
      { kind: 'pickup', label: 'Pick up the package at dead-drop A', x: -380, z: -180, r: 14, drop: 'A' },
      { kind: 'deliver', label: 'Deliver to the west stilt house', x: -520, z: 300, r: 16, buyer: 1 },
    ] },
  { id: 3, act: 1, title: 'Reeds and Rumors', giver: 'Mama Odette', payout: 550, respect: 14,
    brief: 'Second run, deeper water. LWMP is sniffing around the reed beds tonight — keep your light low.',
    dialogue: ['SABLE: Patrol boat on the north channel. I\u2019ll keep eyes on it.'],
    objectives: [
      { kind: 'pickup', label: 'Pick up at dead-drop B (reed bed)', x: 240, z: 560, r: 14, drop: 'B' },
      { kind: 'reach', label: 'Slip past the reed beds', x: 420, z: 240, r: 20 },
      { kind: 'deliver', label: 'Deliver to the north stilt house', x: 180, z: -420, r: 16, buyer: 2 },
    ],
    wantedOnStart: 1 },
  { id: 4, act: 1, title: 'Wrench in the Works', giver: 'Wrench Delia Voss', payout: 500, respect: 14,
    brief: 'Delia wants the Mudskipper at her dock for a tune-up, then a crate goes to the hideout. A mechanic who owes you is worth gold.',
    dialogue: ['DELIA: She\u2019s running rough. Bring her in and I\u2019ll make her sing.'],
    objectives: [
      { kind: 'talk', label: 'Meet Delia at Mudskipper Dock workshop', x: WORLD.workshop.x, z: WORLD.workshop.z, r: 14 },
      { kind: 'pickup', label: 'Load the tuned crate at the dock', x: WORLD.dock.x, z: WORLD.dock.z, r: 14, drop: 'A' },
      { kind: 'deliver', label: 'Deliver the crate to the hideout', x: WORLD.hideout.x, z: WORLD.hideout.z, r: 18 },
    ] },
  { id: 5, act: 2, title: 'Cottonmouth Crossing', giver: 'Mama Odette', payout: 800, respect: 18,
    brief: 'Midnight. The Cottonmouths are running the same water tonight. Grab the drop at the sunken skiff and don\u2019t let them box you in.',
    dialogue: ['COLE (radio): That water\u2019s ours, Calloway. Turn back or swim.', 'ROOK: Funny. I don\u2019t swim. I drive.'],
    objectives: [
      { kind: 'pickup', label: 'Pick up at dead-drop C (sunken skiff)', x: -860, z: 120, r: 14, drop: 'C' },
      { kind: 'survive', label: 'Hold off the Cottonmouth boats', x: -860, z: 120, r: 60, secs: 20 },
      { kind: 'deliver', label: 'Deliver to the east stilt house', x: 560, z: 480, r: 16, buyer: 3 },
    ],
    wantedOnStart: 2 },
  { id: 6, act: 2, title: 'The Levee Run', giver: 'Sable June Park', payout: 900, respect: 18,
    brief: 'Wheels tonight. Take the Levee Runner up the levee road to town — LWMP is setting roadblocks past 4 stars, so keep it clean.',
    dialogue: ['SABLE: Road\u2019s clear for now. If the stars climb, they\u2019ll block the levee.'],
    objectives: [
      { kind: 'reach', label: 'Take the Levee Runner (press E at the truck)', x: 700, z: 8, r: 12, needVehicle: 'truck' },
      { kind: 'reach', label: 'Drive the levee road to Cienaga Landing', x: 820, z: 0, r: 26 },
      { kind: 'deliver', label: 'Hand off at the bar back door', x: WORLD.bar.x, z: WORLD.bar.z, r: 14 },
    ],
    wantedOnStart: 1 },
  { id: 7, act: 2, title: 'Sable\u2019s Eyes', giver: 'Sable June Park', payout: 750, respect: 16,
    brief: 'June maps the patrols from three lookout points. Hit all three, then vanish before the foghorn finds you.',
    dialogue: ['SABLE: Three lookouts, then gone. I\u2019ll light up every patrol on your map.'],
    objectives: [
      { kind: 'reach', label: 'Lookout 1 — cypress knees', x: -180, z: 520, r: 16 },
      { kind: 'reach', label: 'Lookout 2 — heron rookery', x: -140, z: 880, r: 16 },
      { kind: 'reach', label: 'Lookout 3 — old trapper cabin', x: 640, z: -520, r: 16 },
    ],
    wantedOnStart: 2 },
  { id: 8, act: 2, title: 'Foghorn in the Dark', giver: 'Mama Odette', payout: 1100, respect: 20,
    brief: 'FOGHORN-1 is up with its spotlight sweeping the fog. Stay in the reeds, stay dark, and make the hideout alive.',
    dialogue: ['ODETTE: That heli sees everything the fog doesn\u2019t hide. Use the fog, Rook.'],
    objectives: [
      { kind: 'pickup', label: 'Grab the stash at dead-drop D', x: 120, z: -760, r: 14, drop: 'D' },
      { kind: 'survive', label: 'Evade FOGHORN-1\u2019s spotlight', x: 120, z: -760, r: 80, secs: 30 },
      { kind: 'reach', label: 'Reach the hideout in the dark', x: WORLD.hideout.x, z: WORLD.hideout.z, r: 18 },
    ],
    wantedOnStart: 3 },
  { id: 9, act: 3, title: 'The Big Stash', giver: 'Mama Odette', payout: 1400, respect: 22,
    brief: 'Pre-dawn. Three crates, three drops, one boat. The whole season\u2019s stash moves tonight.',
    dialogue: ['ODETTE: Everything we have. Three crates. Don\u2019t lose one, don\u2019t lose yourself.'],
    objectives: [
      { kind: 'collect', label: 'Collect crate 1 at dead-drop E', x: 640, z: -520, r: 14, drop: 'E', count: 1 },
      { kind: 'collect', label: 'Collect crate 2 at dead-drop F', x: -140, z: 880, r: 14, drop: 'F', count: 1 },
      { kind: 'collect', label: 'Collect crate 3 at dead-drop A', x: -380, z: -180, r: 14, drop: 'A', count: 1 },
    ],
    wantedOnStart: 2 },
  { id: 10, act: 3, title: 'Dawn Convoy', giver: 'Wrench Delia Voss', payout: 1600, respect: 22,
    brief: 'Crates on the truck, levee road at first light. Delia rides shotgun with a wrench and a warning.',
    dialogue: ['DELIA: If she stalls on the levee, you push. I fix. That\u2019s the deal.'],
    objectives: [
      { kind: 'reach', label: 'Load the crates onto the Levee Runner', x: 700, z: 8, r: 12, needVehicle: 'truck' },
      { kind: 'reach', label: 'Drive the levee to town before dawn', x: 820, z: 0, r: 26 },
      { kind: 'deliver', label: 'Deliver the stash to the east buyer', x: 560, z: 480, r: 16, buyer: 3 },
    ],
    wantedOnStart: 3 },
  { id: 11, act: 3, title: 'Last of the Cottonmouths', giver: 'Sable June Park', payout: 1800, respect: 24,
    brief: 'Cole Braddock is waiting at his camp with his boats. Run his blockade, take the last drop, and end it.',
    dialogue: ['COLE: Last run, Calloway. My water, my rules.', 'ROOK: Your rules sank with your last boat, Cole.'],
    objectives: [
      { kind: 'reach', label: 'Push through the Cottonmouth camp', x: -760, z: -140, r: 26 },
      { kind: 'pickup', label: 'Take the last drop at the sunken skiff', x: -860, z: 120, r: 14, drop: 'C' },
      { kind: 'survive', label: 'Break the blockade', x: -860, z: 120, r: 70, secs: 20 },
    ],
    wantedOnStart: 4 },
  { id: 12, act: 3, title: 'Before the Raid', giver: 'Mama Odette', payout: 2500, respect: 30,
    brief: 'Fajar. The levee raid comes at dawn. Move the whole stash to the hideout, lose the tail, and become a Marsh Legend.',
    dialogue: ['ODETTE: Dawn raid on the levee. After tonight, you\u2019re either a legend or a cautionary tale.', 'ROOK: Then let\u2019s be a legend.'],
    objectives: [
      { kind: 'deliver', label: 'Deliver the final stash to the hideout', x: WORLD.hideout.x, z: WORLD.hideout.z, r: 18 },
      { kind: 'survive', label: 'Lose the LWMP tail', x: WORLD.hideout.x, z: WORLD.hideout.z, r: 60, secs: 15 },
      { kind: 'reach', label: 'Watch the dawn break over Blackwater', x: WORLD.hideout.x, z: WORLD.hideout.z, r: 18 },
    ],
    wantedOnStart: 4 },
];

export const ACT_NAMES = { 1: 'ACT I — DUSK', 2: 'ACT II — MIDNIGHT', 3: 'ACT III — PRE-DAWN' };

export const RANKS = [
  { min: 0, name: 'Greenhorn' },
  { min: 30, name: 'Swamp Runner' },
  { min: 70, name: 'Night Hauler' },
  { min: 120, name: 'Fog Rider' },
  { min: 180, name: 'Marsh Legend' },
];
export function respectRank(respect) {
  let name = RANKS[0].name;
  for (const r of RANKS) if (respect >= r.min) name = r.name;
  return name;
}

export const UPGRADES = [
  { id: 'fan', name: 'Big Fan — Mudskipper', cost: 600, desc: '+25% airboat top speed', stat: 'fan' },
  { id: 'armor', name: 'Hull Armor', cost: 500, desc: '+50 max armor, gator hits hurt less', stat: 'armor' },
  { id: 'light', name: 'Wide Spotlight', cost: 350, desc: 'Bigger light cone, scares gators farther', stat: 'light' },
  { id: 'quiet', name: 'Quiet Exhaust', cost: 800, desc: 'Wanted rises half as fast', stat: 'quiet' },
  { id: 'engine', name: 'Levee Runner V8', cost: 700, desc: '+25% truck top speed', stat: 'engine' },
  { id: 'repair', name: 'Field Repair Kit', cost: 250, desc: 'Restore 50 health + 50 armor now', stat: 'repair' },
];

// ---------------------------------------------------------------- state

export function createState(seed = 1337) {
  return {
    seed, cash: 250, respect: 0, heat: 0,
    health: 100, maxHealth: 100, armor: 50, maxArmor: 50,
    wanted: 0, wantedTimer: 0,
    timeOfDay: 0.12, // 0 dusk -> 1 dawn
    vehicle: 'foot', // foot | airboat | truck
    pos: { x: WORLD.bar.x, z: WORLD.bar.z + 8 },
    angle: Math.PI / 2, speed: 0,
    missionId: 0, objectiveIdx: 0, missionDone: [],
    cargo: 0, cargoValue: 0, runs: 0,
    upgrades: {},
    crew: { deliaReady: true, sableReady: true, deliaCd: 0, sableCd: 0, sableActive: 0 },
    radio: 0, radioOn: true, spotlight: false,
    gators: spawnGators(seed),
    patrol: [], heli: null, roadblock: false,
    surviveT: 0, msg: '', msgT: 0,
    dialogue: [], dialogueIdx: 0,
    stats: { deliveries: 0, gatorHits: 0, escapes: 0, distance: 0 },
    finished: false,
  };
}

export function spawnGators(seed) {
  const rnd = mulberry32(seed + 77);
  const zones = genWorld(seed).gatorZones;
  const out = [];
  for (const zn of zones) {
    const n = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < n; i++) {
      out.push({
        x: zn.x + (rnd() * 2 - 1) * zn.r * 0.7, z: zn.z + (rnd() * 2 - 1) * zn.r * 0.7,
        a: rnd() * Math.PI * 2, speed: 1.2 + rnd() * 1.6, state: 'patrol', cool: 0,
        zone: zn, phase: rnd() * Math.PI * 2,
      });
    }
  }
  return out;
}

export function currentMission(state) {
  return MISSIONS.find((m) => m.id === state.missionId) || null;
}
export function currentObjective(state) {
  const m = currentMission(state);
  return m ? m.objectives[state.objectiveIdx] || null : null;
}

export function startMission(state, id) {
  const m = MISSIONS.find((x) => x.id === id);
  if (!m) return false;
  if (state.missionDone.includes(id)) return false;
  state.missionId = id;
  state.objectiveIdx = 0;
  state.surviveT = 0;
  state.cargo = 0;
  state.cargoValue = 0;
  state.dialogue = m.dialogue.slice();
  state.dialogueIdx = 0;
  if (m.wantedOnStart) addWanted(state, m.wantedOnStart);
  state.msg = 'MISSION ' + id + ' — ' + m.title;
  state.msgT = 4;
  return true;
}

export function nextMissionId(state) {
  for (const m of MISSIONS) if (!state.missionDone.includes(m.id)) return m.id;
  return 0;
}

export function completeObjective(state) {
  const m = currentMission(state);
  if (!m) return;
  state.objectiveIdx++;
  state.surviveT = 0;
  if (state.objectiveIdx >= m.objectives.length) {
    state.cash += m.payout;
    state.respect += m.respect;
    state.missionDone.push(m.id);
    state.missionId = 0;
    state.objectiveIdx = 0;
    state.msg = 'MISSION COMPLETE — ' + m.title + ' +' + fmtCash(m.payout) + ' +' + m.respect + ' respect';
    state.msgT = 5;
    if (m.id === 12) { state.finished = true; }
  }
}

// Called every tick with dt seconds; player proximity drives objectives.
export function updateMission(state, dt) {
  const m = currentMission(state);
  if (!m) return;
  const o = currentObjective(state);
  if (!o) return;
  const d2 = dist2(state.pos.x, state.pos.z, o.x, o.z);
  if (o.kind === 'survive') {
    if (d2 <= o.r * o.r) {
      state.surviveT += dt;
      if (state.surviveT >= (o.secs || 10)) completeObjective(state);
    } else {
      state.surviveT = Math.max(0, state.surviveT - dt * 0.5);
    }
    return;
  }
  if (o.kind === 'collect') {
    if (d2 <= o.r * o.r && state.cargo < 3) {
      state.cargo += o.count || 1;
      completeObjective(state);
    }
    return;
  }
  if (o.kind === 'pickup' || o.kind === 'deliver') {
    if (d2 <= o.r * o.r) {
      if (o.kind === 'pickup') { state.cargo++; state.cargoValue = 300 + state.runs * 25; }
      else { deliverCargo(state); }
      completeObjective(state);
    }
    return;
  }
  // reach / talk
  if (d2 <= o.r * o.r) {
    if (o.needVehicle && state.vehicle !== o.needVehicle) return;
    completeObjective(state);
  }
}

// ---------------------------------------------------------------- wanted & patrol

export function addWanted(state, n) {
  const gain = state.upgrades.quiet ? Math.ceil(n / 2) : n;
  state.wanted = clamp(state.wanted + gain, 0, 5);
  state.wantedTimer = 0;
  refreshPatrol(state);
}

export function decayWanted(state, dt) {
  if (state.wanted === 0) return;
  state.wantedTimer += dt;
  const need = 45 + state.wanted * 15;
  if (state.wantedTimer >= need) {
    state.wanted--;
    state.wantedTimer = 0;
    if (state.wanted === 0) state.stats.escapes++;
    refreshPatrol(state);
  }
}

// What the LWMP fields at a given wanted level.
export function patrolForWanted(w) {
  return {
    airboats: w >= 1 ? Math.min(w, 3) : 0,
    trucks: w >= 2 ? Math.min(w - 1, 2) : 0,
    heli: w >= 3,
    roadblock: w >= 4,
  };
}

export function refreshPatrol(state) {
  const p = patrolForWanted(state.wanted);
  state.patrol = [];
  for (let i = 0; i < p.airboats; i++) {
    state.patrol.push({ kind: 'airboat', name: 'LWMP-' + (11 + i), x: state.pos.x + 110 + i * 50, z: state.pos.z - 120 - i * 30, speed: 13 + state.wanted, role: 'RAMMING', cool: 0 });
  }
  for (let i = 0; i < p.trucks; i++) {
    state.patrol.push({ kind: 'truck', name: 'LWMP-' + (21 + i), x: state.pos.x + 160 + i * 60, z: 0, speed: 13, role: 'PURSUIT', cool: 0 });
  }
  state.heli = p.heli ? { name: 'FOGHORN-1', x: state.pos.x - 40, z: state.pos.z + 60, h: 55, sweep: 0 } : null;
  state.roadblock = p.roadblock;
}

// ---------------------------------------------------------------- gators & damage

// Gators hunt harder at night: aggression peaks at midnight, lowest at dusk/dawn.
// 1.0 at the edges of the night, 1.6 at midnight (t = 0.5). Drives both the
// hunt range and the hunt speed, so the marsh genuinely gets more dangerous
// as the night deepens instead of treating every hour the same.
export function gatorAggression(t) {
  const k = clamp(t, 0, 1);
  return 1 + 0.6 * Math.sin(k * Math.PI);
}
export function gatorHuntRange(t) {
  return 26 * gatorAggression(t);
}

export function gatorHit(state, gator) {
  if (gator.cool > 0) return false;
  const d2 = dist2(state.pos.x, state.pos.z, gator.x, gator.z);
  if (d2 > 7 * 7) return false;
  if (state.vehicle === 'truck' && isLand(state.pos.x, state.pos.z)) return false;
  // Midnight bites hurt more: the night-aggression bonus stacks on the base hit.
  const night = state.timeOfDay >= 0.33 && state.timeOfDay < 0.66;
  const dmg = (state.upgrades.armor ? 7 : 12) + (night ? 4 : 0);
  damagePlayer(state, dmg);
  state.speed *= 0.45;
  gator.cool = 6;
  gator.state = 'flee';
  state.stats.gatorHits++;
  state.msg = 'GATOR HIT! Hull damage — spotlight scares them off';
  state.msgT = 3;
  return true;
}

export function damagePlayer(state, dmg) {
  let left = dmg;
  if (state.armor > 0) { const absorbed = Math.min(state.armor, left); state.armor -= absorbed; left -= absorbed; }
  state.health = Math.max(0, state.health - left);
  if (state.health <= 0) {
    state.health = 40; state.armor = 0; state.wanted = 0;
    state.pos = { x: WORLD.hideout.x, z: WORLD.hideout.z };
    state.vehicle = 'foot'; state.speed = 0;
    state.msg = 'You blacked out — Delia dragged you to the hideout. Half your cash is gone.';
    state.msgT = 5;
    state.cash = Math.floor(state.cash / 2);
    refreshPatrol(state);
  }
}

// Spotlight pushes gators away (radius depends on upgrade).
export function spotlightRepel(state, dt) {
  if (!state.spotlight) return;
  const r = state.upgrades.light ? 26 : 16;
  for (const g of state.gators) {
    const d2 = dist2(state.pos.x, state.pos.z, g.x, g.z);
    if (d2 < r * r && d2 > 0.01) {
      const d = Math.sqrt(d2);
      const push = (1 - d / r) * 14 * dt;
      g.x += (g.x - state.pos.x) / d * push;
      g.z += (g.z - state.pos.z) / d * push;
      g.state = 'flee';
    }
  }
}

// ---------------------------------------------------------------- economy & upgrades

export function pickupCargo(state) {
  if (state.cargo >= 3) return false;
  state.cargo++;
  state.cargoValue = 300 + state.runs * 25;
  return true;
}

export function deliverCargo(state) {
  if (state.cargo <= 0) return 0;
  const payout = state.cargo * state.cargoValue + 100;
  state.cash += payout;
  state.heat = clamp(state.heat + 8, 0, 100);
  state.respect += 5;
  state.runs++;
  state.stats.deliveries++;
  state.cargo = 0;
  state.cargoValue = 0;
  if (state.runs % 2 === 0) addWanted(state, 1);
  return payout;
}

export function buyUpgrade(state, id) {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u) return false;
  if (state.cash < u.cost) return false;
  if (state.upgrades[id] && id !== 'repair') return false;
  state.cash -= u.cost;
  if (id === 'repair') {
    state.health = Math.min(state.maxHealth, state.health + 50);
    state.armor = Math.min(state.maxArmor, state.armor + 50);
    state.msg = 'Field repair — hull patched';
  } else if (id === 'armor') {
    state.upgrades.armor = true;
    state.maxArmor = 100; state.armor = Math.min(100, state.armor + 50);
    state.msg = 'Hull armor fitted';
  } else {
    state.upgrades[id] = true;
    state.msg = u.name + ' installed';
  }
  state.msgT = 3;
  return true;
}

export function topSpeed(state) {
  if (state.vehicle === 'airboat') return (state.upgrades.fan ? 30 : 24) * (state.armor > 0 ? 1 : 0.9);
  if (state.vehicle === 'truck') return state.upgrades.engine ? 34 : 27;
  return 6;
}

// Crew abilities. Delia repairs in the field; Sable reveals patrols + gator zones.
export function useCrew(state, who) {
  if (who === 'delia') {
    if (!state.crew.deliaReady) return false;
    state.health = Math.min(state.maxHealth, state.health + 35);
    state.armor = Math.min(state.maxArmor, state.armor + 25);
    state.crew.deliaReady = false; state.crew.deliaCd = 45;
    state.msg = 'DELIA: Field patch done. Don\u2019t make me do it twice.';
    state.msgT = 3;
    return true;
  }
  if (who === 'sable') {
    if (!state.crew.sableReady) return false;
    state.crew.sableActive = 20;
    state.crew.sableReady = false; state.crew.sableCd = 60;
    state.msg = 'SABLE: Patrols and gator zones lit up on your map.';
    state.msgT = 3;
    return true;
  }
  return false;
}

export function tickCooldowns(state, dt) {
  if (state.crew.deliaCd > 0) { state.crew.deliaCd -= dt; if (state.crew.deliaCd <= 0) state.crew.deliaReady = true; }
  if (state.crew.sableCd > 0) { state.crew.sableCd -= dt; if (state.crew.sableCd <= 0) state.crew.sableReady = true; }
  if (state.crew.sableActive > 0) state.crew.sableActive -= dt;
  if (state.msgT > 0) state.msgT -= dt;
  for (const g of state.gators) if (g.cool > 0) g.cool -= dt;
}

// Day cycle: 0 dusk, 0.5 midnight, 1 dawn. Fog thickest at midnight.
export function fogDensity(t) {
  return 0.45 + 0.5 * Math.sin(Math.min(t, 1) * Math.PI);
}
export function skyColor(t) {
  // returns [r,g,b] top-of-sky
  if (t < 0.33) { const k = t / 0.33; return [0.24 + 0.06 * k, 0.15 + 0.02 * k, 0.28 - 0.04 * k]; }
  if (t < 0.66) { const k = (t - 0.33) / 0.33; return [0.30 - 0.18 * k, 0.17 - 0.05 * k, 0.24 - 0.02 * k]; }
  const k = (t - 0.66) / 0.34; return [0.12 + 0.55 * k, 0.12 + 0.30 * k, 0.22 + 0.25 * k];
}

// ---------------------------------------------------------------- save / load

export function saveGame(state) {
  const s = {
    v: 1, seed: state.seed, cash: state.cash, respect: state.respect, heat: state.heat,
    health: state.health, armor: state.armor, wanted: state.wanted, timeOfDay: state.timeOfDay,
    vehicle: state.vehicle, pos: state.pos, angle: state.angle, missionId: state.missionId,
    objectiveIdx: state.objectiveIdx, missionDone: state.missionDone, cargo: state.cargo,
    upgrades: state.upgrades, runs: state.runs, stats: state.stats, finished: state.finished,
  };
  return JSON.stringify(s);
}

export function loadGame(json) {
  let s;
  try { s = JSON.parse(json); } catch { return null; }
  if (!s || s.v !== 1 || typeof s.cash !== 'number') return null;
  const state = createState(s.seed || 1337);
  Object.assign(state, {
    cash: s.cash, respect: s.respect, heat: s.heat, health: s.health, armor: s.armor,
    wanted: s.wanted, timeOfDay: s.timeOfDay, vehicle: s.vehicle, pos: s.pos, angle: s.angle,
    missionId: s.missionId, objectiveIdx: s.objectiveIdx, missionDone: s.missionDone || [],
    cargo: s.cargo, upgrades: s.upgrades || {}, runs: s.runs || 0,
    stats: s.stats || state.stats, finished: !!s.finished,
  });
  refreshPatrol(state);
  return state;
}
