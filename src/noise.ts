const fade = (value: number): number => value * value * value * (value * (value * 6 - 15) + 10);
const lerp = (a: number, b: number, amount: number): number => a + (b - a) * amount;

function mixHash(value: number): number {
  let hash = value | 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return (hash ^ (hash >>> 16)) >>> 0;
}

export function hash2D(x: number, z: number, seed: number): number {
  const value = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263) ^ Math.imul(seed | 0, 1442695041);
  return mixHash(value) / 4294967295;
}

export function hash3D(x: number, y: number, z: number, seed: number): number {
  const value = Math.imul(x | 0, 374761393)
    ^ Math.imul(y | 0, 1103515245)
    ^ Math.imul(z | 0, 668265263)
    ^ Math.imul(seed | 0, 1442695041);
  return mixHash(value) / 4294967295;
}

export function valueNoise2D(x: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const tz = fade(z - z0);

  const a = hash2D(x0, z0, seed) * 2 - 1;
  const b = hash2D(x0 + 1, z0, seed) * 2 - 1;
  const c = hash2D(x0, z0 + 1, seed) * 2 - 1;
  const d = hash2D(x0 + 1, z0 + 1, seed) * 2 - 1;
  return lerp(lerp(a, b, tx), lerp(c, d, tx), tz);
}

export function valueNoise3D(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const tz = fade(z - z0);

  const sample = (dx: number, dy: number, dz: number): number =>
    hash3D(x0 + dx, y0 + dy, z0 + dz, seed) * 2 - 1;

  const x00 = lerp(sample(0, 0, 0), sample(1, 0, 0), tx);
  const x10 = lerp(sample(0, 1, 0), sample(1, 1, 0), tx);
  const x01 = lerp(sample(0, 0, 1), sample(1, 0, 1), tx);
  const x11 = lerp(sample(0, 1, 1), sample(1, 1, 1), tx);
  return lerp(lerp(x00, x10, ty), lerp(x01, x11, ty), tz);
}

export function fbm2D(
  x: number,
  z: number,
  seed: number,
  octaves = 5,
  lacunarity = 2,
  persistence = 0.5,
): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let amplitudeTotal = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    value += valueNoise2D(x * frequency, z * frequency, seed + octave * 1013) * amplitude;
    amplitudeTotal += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return value / amplitudeTotal;
}

export function fbm3D(x: number, y: number, z: number, seed: number, octaves = 3): number {
  let value = 0;
  let amplitude = 1;
  let frequency = 1;
  let amplitudeTotal = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    value += valueNoise3D(x * frequency, y * frequency, z * frequency, seed + octave * 2017) * amplitude;
    amplitudeTotal += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return value / amplitudeTotal;
}
