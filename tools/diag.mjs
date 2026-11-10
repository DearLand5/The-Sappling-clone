import { Simulation } from '../src/Simulation.js';
import { YEAR } from '../src/world/ClimateSystem.js';
import { STATE_NAMES } from '../src/life/BehaviorSystem.js';
const seed = +(process.argv[2] || 7), name = process.argv[3] || 'Прыгун';
const sim = new Simulation({ seed, size: 96 }, { maxCreatures: 340, maxPlants: 2700 });
sim.climate.randomDisasters = false;
sim.seedVegetation(0.6); sim.warmup(); sim.seedAnimals(); sim.warmup();
for (let q = 0; q < 20; q++) {
  const end = sim.climate.time + YEAR / 4;
  while (sim.climate.time < end) sim.step(0.3, 0, 0, true);
  const o = sim.organisms, ter = sim.terrain;
  const byType = [0, 1, 2, 3, 4].map((t) => { const l = o.plants.filter((p) => p.ph.type === t); const n = l.length || 1; return `${l.length}/b${(l.reduce((s, p) => s + p.bio / (p.ph.maxBio * p.grow * p.grow + 0.01), 0) / n).toFixed(2)}/g${(l.reduce((s, p) => s + (p.gf || 0), 0) / n).toFixed(2)}`; });
  const cs = o.creatures.filter((c) => c.sp.name.startsWith(name) || (c.sp.parent && o.species.get(c.sp.parent).name.startsWith(name)));
  const n = cs.length || 1, st = {};
  for (const c of cs) st[STATE_NAMES[c.state]] = (st[STATE_NAMES[c.state]] || 0) + 1;
  let sw = 0, nl = 0; for (let i = 0; i < ter.soilWater.length; i++) if (!ter.isWaterCell(i)) { sw += ter.soilWater[i]; nl++; }
  console.log(`t${(sim.climate.time / YEAR).toFixed(2)} T${sim.climate.tempDelta.toFixed(0)} sw${(sw / nl).toFixed(2)} plants[tree,shrub,grass,aq,fungi] ${byType.join(' ')} | ${name} n=${cs.length} e=${(cs.reduce((s, c) => s + c.energy / c.maxE, 0) / n).toFixed(2)} juv=${cs.filter((c) => c.stage === 1).length} ${JSON.stringify(st)}`);
}
