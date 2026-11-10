import { Simulation } from '../src/Simulation.js';
import { YEAR } from '../src/world/ClimateSystem.js';
const years = +(process.argv[2] || 10);
for (const seed of [7, 21, 333, 4505]) {
  const sim = new Simulation({ seed, size: 96 }, { maxCreatures: 340, maxPlants: 2700 });
  sim.climate.randomDisasters = false;
  sim.seedVegetation(0.6); sim.warmup(); sim.seedAnimals(); sim.warmup();
  const t0 = Date.now(); let out = `seed ${seed}: start A=${sim.organisms.creatures.length}`;
  for (let y = 1; y <= years; y++) {
    const end = sim.climate.time + YEAR;
    while (sim.climate.time < end) sim.step(0.3, 0, 0, true);
    if (y === 2 || y === 5 || y === years) {
      const o = sim.organisms, roots = [...o.species.values()].filter((s) => s.kind === 'c' && s.depth === 0);
      const lin = (r) => { let n = 0; const walk = (s) => { n += s.pop; for (const id of s.children) walk(o.species.get(id)); }; walk(r); return n; };
      out += `\n  Y${y} A=${o.creatures.length} P=${o.plants.length} | ` + roots.map((r) => `${r.name.slice(0, 5)}:${lin(r)}`).join(' ');
    }
  }
  console.log(out + `\n  ${((Date.now() - t0) / 1000).toFixed(0)}s deaths ${JSON.stringify(sim.stats.deathsBy)}`);
}
