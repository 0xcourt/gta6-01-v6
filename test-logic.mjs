// Logic tests for BLACKWATER CIENAGA 3D — run with: node test-logic.mjs
// Exercises the pure logic in game/logic.js: missions, wanted, gators, economy,
// upgrades, save/load. Exits non-zero on any failure.
import {
  createState, startMission, updateMission, currentMission, currentObjective,
  addWanted, patrolForWanted, refreshPatrol, gatorHit, damagePlayer,
  gatorAggression, gatorHuntRange,
  pickupCargo, deliverCargo, buyUpgrade, topSpeed, useCrew,
  respectRank, saveGame, loadGame, MISSIONS, WORLD,
} from './game/logic.js';

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? ' — ' + extra : '')); }
}
function goto(state, x, z) { state.pos = { x, z }; }

// --- 1. All 12 missions completable -----------------------------------------
{
  const s = createState(1337);
  for (const m of MISSIONS) {
    const ok = startMission(s, m.id);
    check(`mission ${m.id} starts (${m.title})`, ok === true);
    let guard = 0;
    while (currentMission(s) && guard++ < 50) {
      const o = currentObjective(s);
      if (!o) break;
      if (o.kind === 'survive') {
        goto(s, o.x, o.z);
        for (let i = 0; i < (o.secs || 10) + 2; i++) updateMission(s, 1);
      } else if (o.needVehicle) {
        s.vehicle = o.needVehicle;
        goto(s, o.x, o.z);
        updateMission(s, 0.1);
      } else {
        goto(s, o.x, o.z);
        updateMission(s, 0.1);
      }
    }
    check(`mission ${m.id} completes`, s.missionDone.includes(m.id), 'done=' + JSON.stringify(s.missionDone));
  }
  check('all 12 missions done', s.missionDone.length === 12, 'count=' + s.missionDone.length);
  check('mission 12 sets finished', s.finished === true);
  check('cash grew from payouts', s.cash > 10000, 'cash=' + s.cash);
  check('respect rank is Marsh Legend', respectRank(s.respect) === 'Marsh Legend', 'respect=' + s.respect);
}

// --- 2. Wanted 1..5 and patrol response --------------------------------------
{
  const s = createState(1337);
  for (let w = 1; w <= 5; w++) {
    s.wanted = 0; addWanted(s, w);
    const p = patrolForWanted(s.wanted);
    check(`wanted ${w}: airboats=${p.airboats}`, p.airboats === Math.min(w, 3));
    check(`wanted ${w}: heli=${p.heli} (expect ${w >= 3})`, p.heli === (w >= 3));
    check(`wanted ${w}: roadblock=${p.roadblock} (expect ${w >= 4})`, p.roadblock === (w >= 4));
    check(`wanted ${w}: state.heli set`, (s.heli !== null) === (w >= 3));
    check(`wanted ${w}: state.roadblock set`, s.roadblock === (w >= 4));
  }
  const s2 = createState(1337);
  addWanted(s2, 9);
  check('wanted caps at 5', s2.wanted === 5, 'wanted=' + s2.wanted);
}

// --- 3. Gator collision = damage ----------------------------------------------
{
  const s = createState(1337);
  s.vehicle = 'airboat'; s.pos = { x: 0, z: 0 };
  const g = { x: 2, z: 0, cool: 0, state: 'patrol' };
  const hp0 = s.health, ar0 = s.armor;
  const hit = gatorHit(s, g);
  check('gator collision registers', hit === true);
  check('gator collision damages health/armor', s.health + s.armor < hp0 + ar0, `hp ${hp0}->${s.health} ar ${ar0}->${s.armor}`);
  check('gator gets cooldown after hit', g.cool > 0);
  const hp1 = s.health + s.armor;
  const hit2 = gatorHit(s, g);
  check('gator cannot hit twice during cooldown', hit2 === false && s.health + s.armor === hp1);
  // armor upgrade reduces gator damage
  const sA = createState(1337); sA.cash = 2000; buyUpgrade(sA, 'armor');
  const sB = createState(1337);
  const gA = { x: 0, z: 0, cool: 0, state: 'patrol' }, gB = { x: 0, z: 0, cool: 0, state: 'patrol' };
  sA.pos = { x: 0, z: 0 }; sB.pos = { x: 0, z: 0 };
  sA.vehicle = 'airboat'; sB.vehicle = 'airboat';
  const totA0 = sA.health + sA.armor, totB0 = sB.health + sB.armor;
  gatorHit(sA, gA); gatorHit(sB, gB);
  check('armor upgrade reduces gator damage', (totA0 - (sA.health + sA.armor)) < (totB0 - (sB.health + sB.armor)),
    `armored lost ${totA0 - (sA.health + sA.armor)}, plain lost ${totB0 - (sB.health + sB.armor)}`);
}

// --- 4. Economy: pickup -> delivery -> payout ----------------------------------
{
  const s = createState(1337);
  const cash0 = s.cash;
  check('pickup works', pickupCargo(s) === true && s.cargo === 1);
  check('pickup caps at 3', pickupCargo(s) && pickupCargo(s) && pickupCargo(s) === false && s.cargo === 3);
  const paid = deliverCargo(s);
  check('delivery pays out', paid > 0 && s.cash === cash0 + paid, `paid=${paid} cash=${s.cash}`);
  check('delivery clears cargo', s.cargo === 0);
  check('delivery raises heat', s.heat > 0, 'heat=' + s.heat);
  check('delivery raises respect', s.respect >= 5);
  check('delivery counts runs', s.runs === 1);
  check('delivery with no cargo pays 0', deliverCargo(s) === 0);
}

// --- 5. Workshop upgrades -------------------------------------------------------
{
  const s = createState(1337);
  s.cash = 5000;
  s.vehicle = 'airboat';
  const top0 = topSpeed(s);
  check('fan upgrade buys + raises airboat top speed', buyUpgrade(s, 'fan') === true && topSpeed(s) > top0);
  check('fan cannot be bought twice', buyUpgrade(s, 'fan') === false);
  const s2 = createState(1337); s2.cash = 100;
  check('upgrade fails without cash', buyUpgrade(s2, 'fan') === false && s2.cash === 100);
  check('unknown upgrade fails', buyUpgrade(s2, 'nope') === false);
  const s3 = createState(1337); s3.cash = 1000; s3.health = 40; s3.armor = 0;
  check('repair kit restores health/armor', buyUpgrade(s3, 'repair') === true && s3.health === 90 && s3.armor === 50);
  check('quiet exhaust halves wanted gain', (() => {
    const a = createState(1337); a.cash = 2000; buyUpgrade(a, 'quiet'); addWanted(a, 2); return a.wanted === 1;
  })());
}

// --- 6. Save / load ---------------------------------------------------------------
{
  const s = createState(1337);
  s.cash = 4321; s.respect = 88; s.missionDone = [1, 2, 3]; s.cargo = 2;
  s.upgrades = { fan: true }; s.pos = { x: -123, z: 456 }; s.vehicle = 'airboat';
  const json = saveGame(s);
  const back = loadGame(json);
  check('save/load round-trips cash', back && back.cash === 4321);
  check('save/load round-trips respect', back && back.respect === 88);
  check('save/load round-trips missions', back && back.missionDone.length === 3);
  check('save/load round-trips upgrades', back && back.upgrades.fan === true);
  check('save/load round-trips position+vehicle', back && back.pos.x === -123 && back.vehicle === 'airboat');
  check('corrupt save returns null', loadGame('not json') === null && loadGame('{"v":2}') === null);
}

// --- 7. Crew abilities --------------------------------------------------------------
{
  const s = createState(1337);
  s.health = 50; s.armor = 0;
  check('Delia repairs in the field', useCrew(s, 'delia') === true && s.health === 85);
  check('Delia has a cooldown', useCrew(s, 'delia') === false);
  check('Sable reveals patrols', useCrew(s, 'sable') === true && s.crew.sableActive > 0);
  check('Sable has a cooldown', useCrew(s, 'sable') === false);
}

// --- 8. Night-aggressive gators ----------------------------------------------------
{
  check('gator aggression is 1.0 at the dusk edge', gatorAggression(0) === 1, 'agg=' + gatorAggression(0));
  check('gator aggression is already rising at dusk', gatorAggression(0.12) > 1 && gatorAggression(0.12) < gatorAggression(0.5), 'agg=' + gatorAggression(0.12).toFixed(3));
  check('gator aggression peaks at midnight', Math.abs(gatorAggression(0.5) - 1.6) < 1e-9, 'agg=' + gatorAggression(0.5));
  check('gator aggression back to 1.0 at dawn', gatorAggression(1) === 1, 'agg=' + gatorAggression(1));
  check('gator hunt range grows toward midnight', gatorHuntRange(0.5) > gatorHuntRange(0.12) && gatorHuntRange(0.5) > gatorHuntRange(0.95),
    `range dusk=${gatorHuntRange(0.12).toFixed(1)} midnight=${gatorHuntRange(0.5).toFixed(1)} dawn=${gatorHuntRange(0.95).toFixed(1)}`);
  const hitAt = (t) => {
    const s = createState(1337);
    s.vehicle = 'airboat'; s.pos = { x: 0, z: 0 }; s.timeOfDay = t;
    const before = s.health + s.armor;
    gatorHit(s, { x: 2, z: 0, cool: 0, state: 'patrol' });
    return before - (s.health + s.armor);
  };
  check('midnight gator bite hurts more than a dusk bite', hitAt(0.5) > hitAt(0.12), `dusk lost ${hitAt(0.12)}, midnight lost ${hitAt(0.5)}`);
  check('armor still reduces the midnight bite', (() => {
    const s = createState(1337); s.cash = 2000; buyUpgrade(s, 'armor');
    s.vehicle = 'airboat'; s.pos = { x: 0, z: 0 }; s.timeOfDay = 0.5;
    const before = s.health + s.armor;
    gatorHit(s, { x: 2, z: 0, cool: 0, state: 'patrol' });
    return before - (s.health + s.armor) === 11; // 7 base + 4 night
  })());
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
