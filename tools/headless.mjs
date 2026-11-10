// Прогон симуляции без графики: проверка баланса экосистемы.
import { Simulation } from '../src/Simulation.js';
import { YEAR } from '../src/world/ClimateSystem.js';

const years = +(process.argv[2] || 6);
const sim = new Simulation({ seed: +(process.argv[3] || 7), size: 96 });
sim.climate.randomDisasters = process.argv[4] === 'd';
sim.seedVegetation(0.6); sim.warmup(); sim.seedAnimals(); sim.warmup();
const bi = new Array(10).fill(0); for (const b of sim.world.biome) bi[b]++;
console.log('biomes', bi.join(' '), 'plants', sim.organisms.plants.length, 'animals', sim.organisms.creatures.length);
const t0 = Date.now();
let steps = 0;
for (let y = 0; y < years; y++) {
  for (let q = 0; q < 2; q++) {
    const end = sim.climate.time + YEAR / 2;
    while (sim.climate.time < end) { sim.step(0.3, 0, 0, true); steps++; }
    const o = sim.organisms;
    const line = o.aliveSpecies('c').map((s) => `${s.name.split(' ')[0].slice(0, 7)}:${s.pop}`).join(' ');
    const pl = o.aliveSpecies('p').sort((a, b) => b.pop - a.pop).slice(0, 14).map((s) => `${s.name.split(' ')[0].slice(0, 5)}:${s.pop}`).join(' ');
    console.log(`Y${y + 1}.${q} A=${o.creatures.length} P=${o.plants.length} spC=${o.aliveSpecies('c').length} spP=${o.aliveSpecies('p').length} | ${line}\n      ${pl}`);
  }
}
console.log('ms/step', ((Date.now() - t0) / steps).toFixed(3), 'counters', JSON.stringify(sim.stats.counters), JSON.stringify(sim.stats.deathsBy));
for (const s of sim.organisms.species.values()) if (s.kind === 'c' && s.depth === 0) console.log(s.name, JSON.stringify(s.deaths), 'born', s.totalBorn);
const d = JSON.stringify(sim.serialize());
console.log('save size KB', (d.length / 1024) | 0);
const sim2 = Simulation.deserialize(JSON.parse(d));
console.log('reload', sim2.organisms.creatures.length, sim2.organisms.plants.length, sim2.climate.dateString());
