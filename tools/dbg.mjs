import { Simulation } from '../src/Simulation.js';
import { STATE_NAMES } from '../src/life/BehaviorSystem.js';
const sim = new Simulation({ seed: 7, size: 96 });
sim.climate.randomDisasters = false;
sim.seedVegetation(0.6); sim.warmup(); sim.seedAnimals(); sim.warmup();
const name = process.argv[2] || 'Охотник';
const sp = [...sim.organisms.species.values()].find((s) => s.name.startsWith(name));
console.log(sp.name, 'mass', sp.ph.mass.toFixed(2), 'land', sp.ph.land.toFixed(2), 'swim', sp.ph.swim.toFixed(2), 'fly', sp.ph.fly.toFixed(2), 'vision', sp.ph.vision.toFixed(0), 'attack', sp.ph.attack.toFixed(1), 'tOpt', sp.ph.tempOpt.toFixed(0), 'tol', sp.ph.tempTol.toFixed(0), 'maxH', sp.ph.maxHealth.toFixed(0));
for (const s of sim.organisms.species.values()) if (s.kind === 'c') console.log('  ', s.name.padEnd(22), 'm', s.ph.mass.toFixed(2), 'land', s.ph.land.toFixed(1), 'swim', s.ph.swim.toFixed(1), 'fly', s.ph.fly.toFixed(1), 'tOpt', s.ph.tempOpt.toFixed(0), '±', s.ph.tempTol.toFixed(0), 'basal', (s.ph.basalK * s.ph.mass ** 0.75).toFixed(3), 'maxE', (s.ph.mass ** 0.9 * s.ph.energyK).toFixed(1), 'life', s.ph.lifespan.toFixed(0), 'mat', s.ph.matureTime.toFixed(0));
for (let t = 0; t < 40; t++) {
  for (let k = 0; k < 30; k++) sim.step(0.3, 0, 0, true);
  const cs = sim.organisms.creatures.filter((c) => c.sp === sp);
  console.log(sim.climate.time.toFixed(0), cs.map((c) => `${STATE_NAMES[c.state].slice(0, 6)} e${(c.energy / c.maxE).toFixed(2)} h${(c.health / c.maxH).toFixed(1)} w${c.hydration.toFixed(1)} T${c.tempStress?.toFixed(0)}`).join(' | '));
}
