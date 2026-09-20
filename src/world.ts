import * as THREE from 'three';
import {
  Block,
  type BlockFace,
  atlasUV,
  isCrossShape,
  isFluid,
  isSolid,
  isTransparent,
  isKnownBlock,
  isWorldBlock,
  textureForFace,
} from './blocks';
import { fbm2D, fbm3D, hash2D, hash3D } from './noise';

export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 64;
export const SEA_LEVEL = 21;
export const RENDER_DISTANCE = 3;
const STORAGE_PREFIX = 'blockscape:world:';

type Chunk = {
  cx: number;
  cz: number;
  data: Uint8Array;
  dirty: boolean;
  opaqueMesh?: THREE.Mesh;
  waterMesh?: THREE.Mesh;
  lavaMesh?: THREE.Mesh;
};

type Face = {
  direction: readonly [number, number, number];
  textureFace: BlockFace;
  shade: number;
  vertices: readonly (readonly [number, number, number])[];
};

export type VoxelHit = {
  x: number;
  y: number;
  z: number;
  previousX: number;
  previousY: number;
  previousZ: number;
  normal: THREE.Vector3;
  block: Block;
  distance: number;
};

type MeshPass = 'opaque' | 'water' | 'lava';

const FACES: readonly Face[] = [
  {
    direction: [1, 0, 0], textureFace: 'side', shade: 0.86,
    vertices: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  },
  {
    direction: [-1, 0, 0], textureFace: 'side', shade: 0.72,
    vertices: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]],
  },
  {
    direction: [0, 1, 0], textureFace: 'top', shade: 1,
    vertices: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  },
  {
    direction: [0, -1, 0], textureFace: 'bottom', shade: 0.58,
    vertices: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  },
  {
    direction: [0, 0, 1], textureFace: 'side', shade: 0.91,
    vertices: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  },
  {
    direction: [0, 0, -1], textureFace: 'side', shade: 0.77,
    vertices: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
  },
];

const CROSS_QUADS: readonly (readonly (readonly [number, number, number])[])[] = [
  [[0.15, 0, 0.15], [0.15, 1, 0.15], [0.85, 1, 0.85], [0.85, 0, 0.85]],
  [[0.85, 0, 0.15], [0.85, 1, 0.15], [0.15, 1, 0.85], [0.15, 0, 0.85]],
  [[0.85, 0, 0.85], [0.85, 1, 0.85], [0.15, 1, 0.15], [0.15, 0, 0.15]],
  [[0.15, 0, 0.85], [0.15, 1, 0.85], [0.85, 1, 0.15], [0.85, 0, 0.15]],
];

const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;
const editKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;
const localCoordinate = (value: number): number => ((value % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
const dataIndex = (x: number, y: number, z: number): number => (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
const clamp = (value: number, minimum: number, maximum: number): number => Math.max(minimum, Math.min(maximum, value));

function disposeMesh(group: THREE.Group, mesh?: THREE.Mesh): void {
  if (!mesh) return;
  group.remove(mesh);
  mesh.geometry.dispose();
}

export class VoxelWorld {
  readonly seed: number;
  readonly group = new THREE.Group();
  private readonly chunks = new Map<string, Chunk>();
  private readonly edits = new Map<string, Block>();
  private readonly editsByChunk = new Map<string, Map<string, Block>>();
  private readonly torches = new Set<string>();
  private readonly opaqueMaterial: THREE.MeshLambertMaterial;
  private readonly waterMaterial: THREE.MeshLambertMaterial;
  private readonly lavaMaterial: THREE.MeshLambertMaterial;
  private saveTimer?: number;
  private lastStreamChunkX = Number.NaN;
  private lastStreamChunkZ = Number.NaN;
  private readonly onSaved?: () => void;

  constructor(scene: THREE.Scene, atlas: THREE.Texture, seed: number, onSaved?: () => void) {
    this.seed = seed | 0;
    this.onSaved = onSaved;
    this.group.name = 'Voxel world';
    scene.add(this.group);

    this.opaqueMaterial = new THREE.MeshLambertMaterial({
      map: atlas,
      vertexColors: true,
      alphaTest: 0.45,
    });
    this.waterMaterial = new THREE.MeshLambertMaterial({
      map: atlas,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.lavaMaterial = new THREE.MeshLambertMaterial({
      map: atlas,
      vertexColors: true,
      emissive: 0xc43a08,
      emissiveIntensity: 0.72,
    });
    this.loadEdits();
  }

  get loadedChunkCount(): number {
    return this.chunks.size;
  }

  initializeAround(worldX: number, worldZ: number, radius = 2): void {
    const centerX = Math.floor(worldX / CHUNK_SIZE);
    const centerZ = Math.floor(worldZ / CHUNK_SIZE);
    for (let distance = 0; distance <= radius; distance += 1) {
      for (let cz = centerZ - distance; cz <= centerZ + distance; cz += 1) {
        for (let cx = centerX - distance; cx <= centerX + distance; cx += 1) {
          if (Math.max(Math.abs(cx - centerX), Math.abs(cz - centerZ)) !== distance) continue;
          this.ensureChunk(cx, cz);
        }
      }
    }
    for (const chunk of this.chunks.values()) this.rebuildChunk(chunk);
    this.lastStreamChunkX = centerX;
    this.lastStreamChunkZ = centerZ;
  }

  updateStreaming(worldX: number, worldZ: number): void {
    const centerX = Math.floor(worldX / CHUNK_SIZE);
    const centerZ = Math.floor(worldZ / CHUNK_SIZE);

    let nearestMissing: { cx: number; cz: number; distance: number } | undefined;
    for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz += 1) {
      for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dz));
        if (distance > RENDER_DISTANCE) continue;
        const cx = centerX + dx;
        const cz = centerZ + dz;
        if (!this.chunks.has(chunkKey(cx, cz)) && (!nearestMissing || distance < nearestMissing.distance)) {
          nearestMissing = { cx, cz, distance };
        }
      }
    }

    if (nearestMissing) this.ensureChunk(nearestMissing.cx, nearestMissing.cz);

    const dirtyChunk = [...this.chunks.values()]
      .filter((chunk) => chunk.dirty && Math.max(Math.abs(chunk.cx - centerX), Math.abs(chunk.cz - centerZ)) <= RENDER_DISTANCE)
      .sort((a, b) => {
        const distanceA = Math.abs(a.cx - centerX) + Math.abs(a.cz - centerZ);
        const distanceB = Math.abs(b.cx - centerX) + Math.abs(b.cz - centerZ);
        return distanceA - distanceB;
      })[0];
    if (dirtyChunk) this.rebuildChunk(dirtyChunk);

    if (centerX !== this.lastStreamChunkX || centerZ !== this.lastStreamChunkZ) {
      this.lastStreamChunkX = centerX;
      this.lastStreamChunkZ = centerZ;
      const unloadDistance = RENDER_DISTANCE + 2;
      for (const [key, chunk] of this.chunks) {
        if (Math.max(Math.abs(chunk.cx - centerX), Math.abs(chunk.cz - centerZ)) <= unloadDistance) continue;
        disposeMesh(this.group, chunk.opaqueMesh);
        disposeMesh(this.group, chunk.waterMesh);
        disposeMesh(this.group, chunk.lavaMesh);
        this.chunks.delete(key);
      }
    }
  }

  getBlock(x: number, y: number, z: number): Block {
    if (y < 0) return Block.Bedrock;
    if (y >= WORLD_HEIGHT) return Block.Air;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (!chunk) return Block.Air;
    return chunk.data[dataIndex(localCoordinate(x), y, localCoordinate(z))] as Block;
  }

  setBlock(x: number, y: number, z: number, block: Block): boolean {
    if (y <= 0 || y >= WORLD_HEIGHT) return false;
    if (block !== Block.Air && !isWorldBlock(block)) return false;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const chunk = this.ensureChunk(cx, cz);
    const index = dataIndex(localCoordinate(x), y, localCoordinate(z));
    if (chunk.data[index] === block) return false;
    chunk.data[index] = block;

    const coordinateKey = editKey(x, y, z);
    this.edits.set(coordinateKey, block);
    const key = chunkKey(cx, cz);
    let chunkEdits = this.editsByChunk.get(key);
    if (!chunkEdits) {
      chunkEdits = new Map();
      this.editsByChunk.set(key, chunkEdits);
    }
    chunkEdits.set(coordinateKey, block);
    this.syncTorch(x, y, z, block);
    this.markChunkAndNeighborsDirty(cx, cz, localCoordinate(x), localCoordinate(z));
    this.scheduleSave();
    return true;
  }

  nearestTorches(origin: THREE.Vector3, limit = 6): THREE.Vector3[] {
    const ranked: { position: THREE.Vector3; distance: number }[] = [];
    for (const key of this.torches) {
      const [x, y, z] = key.split(',').map(Number);
      const position = new THREE.Vector3(x + 0.5, y + 0.55, z + 0.5);
      const distance = position.distanceToSquared(origin);
      if (distance > 22 * 22) continue;
      ranked.push({ position, distance });
    }
    ranked.sort((a, b) => a.distance - b.distance);
    return ranked.slice(0, limit).map((entry) => entry.position);
  }

  biomeAt(x: number, z: number): string {
    const height = this.terrainHeight(x, z);
    const temperature = fbm2D(x * 0.006, z * 0.006, this.seed + 4096, 4);
    const moisture = fbm2D(x * 0.008, z * 0.008, this.seed - 921, 4);
    if (height <= SEA_LEVEL + 1) return 'COAST';
    if (temperature < -0.28) return 'SNOWY TAIGA';
    if (temperature > 0.27 && moisture < -0.08) return 'DESERT';
    if (height > 36) return 'HIGHLANDS';
    if (moisture > 0.15) return 'FOREST';
    return 'PLAINS';
  }

  findSurface(x: number, z: number): number {
    this.ensureChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
    for (let y = WORLD_HEIGHT - 2; y > 0; y -= 1) {
      if (isSolid(this.getBlock(x, y, z)) && !isSolid(this.getBlock(x, y + 1, z))) return y;
    }
    return this.terrainHeight(x, z);
  }

  findSpawn(searchRadius = 36): THREE.Vector3 {
    for (let radius = 0; radius <= searchRadius; radius += 1) {
      for (let z = -radius; z <= radius; z += 1) {
        for (let x = -radius; x <= radius; x += 1) {
          if (radius > 0 && Math.abs(x) !== radius && Math.abs(z) !== radius) continue;
          this.ensureChunk(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
          const surface = this.terrainHeight(x, z);
          const feetBlock = this.getBlock(x, surface + 1, z);
          const headBlock = this.getBlock(x, surface + 2, z);
          if (surface > SEA_LEVEL && feetBlock === Block.Air && headBlock === Block.Air) {
            return new THREE.Vector3(x + 0.5, surface + 1.02, z + 0.5);
          }
        }
      }
    }
    return new THREE.Vector3(0.5, SEA_LEVEL + 8, 0.5);
  }

  raycast(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance = 6): VoxelHit | null {
    const ray = direction.clone().normalize();
    let x = Math.floor(origin.x);
    let y = Math.floor(origin.y);
    let z = Math.floor(origin.z);
    let previousX = x;
    let previousY = y;
    let previousZ = z;
    let normal = new THREE.Vector3();
    let traveled = 0;

    const stepX = Math.sign(ray.x) || 1;
    const stepY = Math.sign(ray.y) || 1;
    const stepZ = Math.sign(ray.z) || 1;
    const deltaX = ray.x === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / ray.x);
    const deltaY = ray.y === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / ray.y);
    const deltaZ = ray.z === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / ray.z);
    let nextX = stepX > 0 ? (x + 1 - origin.x) * deltaX : (origin.x - x) * deltaX;
    let nextY = stepY > 0 ? (y + 1 - origin.y) * deltaY : (origin.y - y) * deltaY;
    let nextZ = stepZ > 0 ? (z + 1 - origin.z) * deltaZ : (origin.z - z) * deltaZ;

    for (let step = 0; step < 128 && traveled <= maxDistance; step += 1) {
      const block = this.getBlock(x, y, z);
      if (block !== Block.Air && !isFluid(block)) {
        return {
          x, y, z, previousX, previousY, previousZ, normal, block, distance: traveled,
        };
      }
      previousX = x;
      previousY = y;
      previousZ = z;
      if (nextX <= nextY && nextX <= nextZ) {
        x += stepX;
        traveled = nextX;
        nextX += deltaX;
        normal = new THREE.Vector3(-stepX, 0, 0);
      } else if (nextY <= nextZ) {
        y += stepY;
        traveled = nextY;
        nextY += deltaY;
        normal = new THREE.Vector3(0, -stepY, 0);
      } else {
        z += stepZ;
        traveled = nextZ;
        nextZ += deltaZ;
        normal = new THREE.Vector3(0, 0, -stepZ);
      }
    }
    return null;
  }

  saveNow(): void {
    if (this.saveTimer !== undefined) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = undefined;
    }
    try {
      localStorage.setItem(`${STORAGE_PREFIX}${this.seed | 0}`, JSON.stringify([...this.edits.entries()]));
      this.onSaved?.();
    } catch (error) {
      console.warn('Could not save world', error);
    }
  }

  private terrainHeight(x: number, z: number): number {
    const continent = fbm2D(x * 0.012, z * 0.012, this.seed, 5, 2.05, 0.52);
    const hills = fbm2D(x * 0.042, z * 0.042, this.seed + 1701, 3) * 2.8;
    const ridge = fbm2D(x * 0.018, z * 0.018, this.seed - 733, 4);
    const peak = Math.max(0, 1 - Math.abs(ridge * 1.75)) ** 3 * 5;
    return clamp(Math.floor(25 + continent * 11 + hills + peak), 7, 52);
  }

  private ensureChunk(cx: number, cz: number): Chunk {
    const key = chunkKey(cx, cz);
    const existing = this.chunks.get(key);
    if (existing) return existing;
    const chunk: Chunk = {
      cx,
      cz,
      data: new Uint8Array(CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE),
      dirty: true,
    };
    this.generateChunk(chunk);
    this.chunks.set(key, chunk);
    this.markNeighborChunksDirty(cx, cz);
    return chunk;
  }

  private generateChunk(chunk: Chunk): void {
    for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
      for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
        const x = chunk.cx * CHUNK_SIZE + lx;
        const z = chunk.cz * CHUNK_SIZE + lz;
        const height = this.terrainHeight(x, z);
        const biome = this.biomeAt(x, z);
        const ground = biome === 'DESERT' || biome === 'COAST'
          ? Block.Sand
          : biome === 'SNOWY TAIGA'
            ? Block.Snow
            : Block.Grass;
        for (let y = 0; y <= height; y += 1) {
          let block: Block;
          if (y === 0 || (y === 1 && hash3D(x, y, z, this.seed) > 0.58)) {
            block = Block.Bedrock;
          } else if (y === height) {
            block = ground;
          } else if (y >= height - 3) {
            block = ground === Block.Sand ? Block.Sand : Block.Dirt;
          } else {
            block = Block.Stone;
          }
          if (block === Block.Stone && y > 3 && y < height - 3) {
            const caves = fbm3D(x * 0.058, y * 0.071, z * 0.058, this.seed + 8101, 3);
            const cavesB = Math.abs(fbm3D(x * 0.035, y * 0.052, z * 0.035, this.seed - 3301, 2));
            if (caves > 0.32 && cavesB < 0.3) {
              block = y < 12 && hash3D(x, y, z, this.seed + 2204) > 0.62 ? Block.Lava : Block.Air;
            } else {
              const ore = hash3D(x, y, z, this.seed + 5150);
              if (y < 30 && ore > 0.985) block = Block.IronOre;
              else if (ore > 0.968) block = Block.CoalOre;
              else if (hash3D(x, y, z, this.seed + 909) > 0.992) block = Block.Gravel;
            }
          }
          chunk.data[dataIndex(lx, y, lz)] = block;
        }
        for (let y = height + 1; y <= SEA_LEVEL; y += 1) {
          chunk.data[dataIndex(lx, y, lz)] = Block.Water;
        }
      }
    }
    this.generateDecorations(chunk);
    this.applyChunkEdits(chunk);
  }

  private generateDecorations(chunk: Chunk): void {
    for (let lz = 3; lz < CHUNK_SIZE - 3; lz += 1) {
      for (let lx = 3; lx < CHUNK_SIZE - 3; lx += 1) {
        const x = chunk.cx * CHUNK_SIZE + lx;
        const z = chunk.cz * CHUNK_SIZE + lz;
        const biome = this.biomeAt(x, z);
        const height = this.terrainHeight(x, z);
        const ground = chunk.data[dataIndex(lx, height, lz)] as Block;
        const roll = hash2D(x, z, this.seed + 7717);
        if ((ground === Block.Grass || ground === Block.Snow) && (biome === 'FOREST' || biome === 'PLAINS' || biome === 'SNOWY TAIGA')) {
          const chance = biome === 'FOREST' ? 0.045 : biome === 'SNOWY TAIGA' ? 0.022 : 0.01;
          const peak = [hash2D(x - 1, z, this.seed + 7717), hash2D(x + 1, z, this.seed + 7717), hash2D(x, z - 1, this.seed + 7717), hash2D(x, z + 1, this.seed + 7717)]
            .every((neighbor) => neighbor >= roll);
          if (roll < chance && peak) this.placeTree(chunk, lx, height + 1, lz);
        }
        if (ground === Block.Sand && biome === 'DESERT' && roll > 0.72 && roll < 0.78) {
          const cactusHeight = 2 + Math.floor(hash2D(x, z, this.seed + 4401) * 2);
          for (let y = 1; y <= cactusHeight; y += 1) {
            const worldY = height + y;
            if (worldY >= WORLD_HEIGHT - 1) break;
            if (chunk.data[dataIndex(lx, worldY, lz)] === Block.Air) {
              chunk.data[dataIndex(lx, worldY, lz)] = Block.Cactus;
            }
          }
        }
        if (ground === Block.Grass && chunk.data[dataIndex(lx, height + 1, lz)] === Block.Air) {
          if (roll > 0.72 && roll < 0.86) chunk.data[dataIndex(lx, height + 1, lz)] = Block.TallGrass;
          else if (roll > 0.93) chunk.data[dataIndex(lx, height + 1, lz)] = Block.Flower;
        }
      }
    }
  }

  private placeTree(chunk: Chunk, lx: number, baseY: number, lz: number): void {
    const trunk = 4 + Math.floor(hash2D(chunk.cx * 17 + lx, chunk.cz * 13 + lz, this.seed) * 3);
    for (let y = 0; y < trunk; y += 1) {
      const worldY = baseY + y;
      if (worldY >= WORLD_HEIGHT) return;
      chunk.data[dataIndex(lx, worldY, lz)] = Block.Wood;
    }
    const leafY = baseY + trunk - 1;
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dz = -2; dz <= 2; dz += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const x = lx + dx;
          const y = leafY + dy;
          const z = lz + dz;
          if (x < 0 || z < 0 || x >= CHUNK_SIZE || z >= CHUNK_SIZE) continue;
          if (y < 1 || y >= WORLD_HEIGHT) continue;
          const distance = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
          if (distance > 4 || (Math.abs(dx) === 2 && Math.abs(dz) === 2 && dy !== 0)) continue;
          const index = dataIndex(x, y, z);
          if (chunk.data[index] === Block.Air) chunk.data[index] = Block.Leaves;
        }
      }
    }
  }

  private applyChunkEdits(chunk: Chunk): void {
    const edits = this.editsByChunk.get(chunkKey(chunk.cx, chunk.cz));
    if (!edits) return;
    for (const [key, block] of edits) {
      const [x, y, z] = key.split(',').map(Number);
      if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) continue;
      if (y <= 0 || y >= WORLD_HEIGHT) continue;
      if (Math.floor(x / CHUNK_SIZE) !== chunk.cx || Math.floor(z / CHUNK_SIZE) !== chunk.cz) continue;
      chunk.data[dataIndex(localCoordinate(x), y, localCoordinate(z))] = block;
      if (block === Block.Torch) this.torches.add(key);
    }
  }

  private rebuildChunk(chunk: Chunk): void {
    disposeMesh(this.group, chunk.opaqueMesh);
    disposeMesh(this.group, chunk.waterMesh);
    disposeMesh(this.group, chunk.lavaMesh);
    chunk.opaqueMesh = this.createChunkMesh(chunk, 'opaque');
    chunk.waterMesh = this.createChunkMesh(chunk, 'water');
    chunk.lavaMesh = this.createChunkMesh(chunk, 'lava');
    if (chunk.opaqueMesh) this.group.add(chunk.opaqueMesh);
    if (chunk.waterMesh) this.group.add(chunk.waterMesh);
    if (chunk.lavaMesh) this.group.add(chunk.lavaMesh);
    chunk.dirty = false;
  }

  private createChunkMesh(chunk: Chunk, pass: MeshPass): THREE.Mesh | undefined {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];

    for (let y = 0; y < WORLD_HEIGHT; y += 1) {
      for (let lz = 0; lz < CHUNK_SIZE; lz += 1) {
        for (let lx = 0; lx < CHUNK_SIZE; lx += 1) {
          const block = chunk.data[dataIndex(lx, y, lz)] as Block;
          if (block === Block.Air) continue;
          const isWater = block === Block.Water;
          const isLava = block === Block.Lava;
          if (pass === 'water' && !isWater) continue;
          if (pass === 'lava' && !isLava) continue;
          if (pass === 'opaque' && (isWater || isLava)) continue;

          const worldX = chunk.cx * CHUNK_SIZE + lx;
          const worldZ = chunk.cz * CHUNK_SIZE + lz;

          if (isCrossShape(block)) {
            const uv = atlasUV(textureForFace(block, 'side'));
            for (const quad of CROSS_QUADS) {
              const vertex = positions.length / 3;
              for (const [px, py, pz] of quad) {
                positions.push(lx + px, y + py, lz + pz);
                normals.push(0, 1, 0);
                colors.push(1, 1, 1);
              }
              uvs.push(uv.u0, uv.v0, uv.u0, uv.v1, uv.u1, uv.v1, uv.u1, uv.v0);
              indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
            }
            continue;
          }

          for (const face of FACES) {
            const neighbor = this.getBlock(
              worldX + face.direction[0],
              y + face.direction[1],
              worldZ + face.direction[2],
            );
            if (!this.shouldRenderFace(block, neighbor)) continue;
            const vertex = positions.length / 3;
            const heightScale = isWater ? 0.86 : 1;
            for (const [px, py, pz] of face.vertices) {
              positions.push(lx + px, y + py * heightScale, lz + pz);
              normals.push(face.direction[0], face.direction[1], face.direction[2]);
              colors.push(face.shade, face.shade, face.shade);
            }
            const uv = atlasUV(textureForFace(block, face.textureFace));
            uvs.push(uv.u0, uv.v0, uv.u0, uv.v1, uv.u1, uv.v1, uv.u1, uv.v0);
            indices.push(vertex, vertex + 1, vertex + 2, vertex, vertex + 2, vertex + 3);
          }
        }
      }
    }

    if (positions.length === 0) return undefined;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeBoundingSphere();
    const material = pass === 'water'
      ? this.waterMaterial
      : pass === 'lava'
        ? this.lavaMaterial
        : this.opaqueMaterial;
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `${pass} chunk ${chunk.cx},${chunk.cz}`;
    mesh.position.set(chunk.cx * CHUNK_SIZE, 0, chunk.cz * CHUNK_SIZE);
    mesh.castShadow = pass === 'opaque';
    mesh.receiveShadow = pass === 'opaque';
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    return mesh;
  }

  private shouldRenderFace(block: Block, neighbor: Block): boolean {
    if (isFluid(block)) return neighbor !== block && !isSolid(neighbor);
    if (neighbor === Block.Air || isFluid(neighbor)) return true;
    if (isTransparent(neighbor)) return neighbor !== block;
    return false;
  }

  private syncTorch(x: number, y: number, z: number, block: Block): void {
    const key = editKey(x, y, z);
    if (block === Block.Torch) this.torches.add(key);
    else this.torches.delete(key);
  }

  private markChunkAndNeighborsDirty(cx: number, cz: number, lx: number, lz: number): void {
    this.markDirty(cx, cz);
    if (lx === 0) this.markDirty(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this.markDirty(cx + 1, cz);
    if (lz === 0) this.markDirty(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this.markDirty(cx, cz + 1);
  }

  private markNeighborChunksDirty(cx: number, cz: number): void {
    this.markDirty(cx - 1, cz);
    this.markDirty(cx + 1, cz);
    this.markDirty(cx, cz - 1);
    this.markDirty(cx, cz + 1);
  }

  private markDirty(cx: number, cz: number): void {
    const chunk = this.chunks.get(chunkKey(cx, cz));
    if (chunk) chunk.dirty = true;
  }

  private scheduleSave(): void {
    if (this.saveTimer !== undefined) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 700);
  }

  private loadEdits(): void {
    try {
      const serialized = localStorage.getItem(`${STORAGE_PREFIX}${this.seed | 0}`);
      if (!serialized) return;
      const payload = JSON.parse(serialized) as unknown;
      if (!Array.isArray(payload)) return;
      for (const entry of payload) {
        if (!Array.isArray(entry) || entry.length < 2) continue;
        const [key, block] = entry as [unknown, unknown];
        if (typeof key !== 'string' || !/^-?\d+,-?\d+,-?\d+$/.test(key)) continue;
        if (typeof block !== 'number' || !isKnownBlock(block)) continue;
        if (block !== Block.Air && !isWorldBlock(block)) continue;
        this.edits.set(key, block);
        const [x, , z] = key.split(',').map(Number);
        const chunk = chunkKey(Math.floor(x / CHUNK_SIZE), Math.floor(z / CHUNK_SIZE));
        let group = this.editsByChunk.get(chunk);
        if (!group) {
          group = new Map();
          this.editsByChunk.set(chunk, group);
        }
        group.set(key, block);
        if (block === Block.Torch) this.torches.add(key);
      }
    } catch (error) {
      console.warn('Could not load world', error);
    }
  }
}
