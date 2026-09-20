import * as THREE from 'three';
import { Block, isSolid } from './blocks';
import { VoxelWorld, WORLD_HEIGHT } from './world';

export type MobKind = 'pig' | 'cow' | 'chicken' | 'zombie';

type MobDefinition = {
  kind: MobKind;
  name: string;
  health: number;
  speed: number;
  width: number;
  height: number;
  hostile: boolean;
};

const KINDS: Record<MobKind, MobDefinition> = {
  pig: { kind: 'pig', name: 'Pig', health: 6, speed: 2.1, width: 0.45, height: 0.85, hostile: false },
  cow: { kind: 'cow', name: 'Cow', health: 8, speed: 1.7, width: 0.55, height: 1.35, hostile: false },
  chicken: { kind: 'chicken', name: 'Chicken', health: 4, speed: 2.4, width: 0.28, height: 0.7, hostile: false },
  zombie: { kind: 'zombie', name: 'Zombie', health: 12, speed: 2.35, width: 0.3, height: 1.85, hostile: true },
};

export type MobHit = {
  mob: Mob;
  distance: number;
};

const box = (
  width: number,
  height: number,
  depth: number,
  material: THREE.Material,
  x = 0,
  y = 0,
  z = 0,
): THREE.Mesh => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

const pigment = (color: number): THREE.MeshLambertMaterial => new THREE.MeshLambertMaterial({ color });

export class Mob {
  readonly mesh: THREE.Group;
  readonly kind: MobKind;
  readonly definition: MobDefinition;
  readonly position: THREE.Vector3;
  readonly velocity = new THREE.Vector3();
  health: number;
  yaw = Math.random() * Math.PI * 2;
  onGround = false;
  age = 0;
  private wanderTimer = 0;
  private attackTimer = 0;
  private hop = 0;
  private walkCycle = 0;
  private dead = false;
  private readonly world: VoxelWorld;
  private readonly leftLimbs: THREE.Object3D[] = [];
  private readonly rightLimbs: THREE.Object3D[] = [];
  private readonly extraLimbs: THREE.Object3D[] = [];

  constructor(kind: MobKind, position: THREE.Vector3, world: VoxelWorld) {
    this.kind = kind;
    this.definition = KINDS[kind];
    this.health = this.definition.health;
    this.position = position.clone();
    this.world = world;
    this.mesh = this.createMesh();
    this.syncMesh();
  }

  get alive(): boolean {
    return !this.dead;
  }

  get name(): string {
    return this.definition.name;
  }

  get hostile(): boolean {
    return this.definition.hostile;
  }

  damage(amount: number): boolean {
    if (this.dead) return false;
    this.health -= amount;
    this.velocity.y = Math.max(this.velocity.y, 4.2);
    if (this.health > 0) return false;
    this.dead = true;
    return true;
  }

  knockback(from: THREE.Vector3, strength = 6): void {
    const dx = this.position.x - from.x;
    const dz = this.position.z - from.z;
    const length = Math.hypot(dx, dz) || 1;
    this.velocity.x += (dx / length) * strength;
    this.velocity.z += (dz / length) * strength;
  }

  update(deltaTime: number, playerPosition: THREE.Vector3, daylight: number): number {
    if (this.dead) return 0;
    this.age += deltaTime;
    this.attackTimer = Math.max(0, this.attackTimer - deltaTime);
    const dt = Math.min(deltaTime, 0.05);
    const definition = this.definition;

    if (this.kind === 'zombie' && daylight > 0.42) {
      this.health -= 7 * dt;
      if (this.health <= 0) {
        this.dead = true;
        return 0;
      }
    }

    const toPlayerX = playerPosition.x - this.position.x;
    const toPlayerZ = playerPosition.z - this.position.z;
    const playerDistance = Math.hypot(toPlayerX, toPlayerZ);

    if (definition.hostile && playerDistance < 18) {
      this.yaw = Math.atan2(-toPlayerX, -toPlayerZ);
    } else {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0) {
        this.wanderTimer = 1.4 + Math.random() * 3.2;
        this.yaw += (Math.random() - 0.5) * 2.4;
      }
    }

    const speed = definition.hostile && playerDistance < 18
      ? definition.speed * 1.25
      : this.wanderTimer > 0.45
        ? definition.speed
        : 0;
    this.velocity.x += (Math.sin(this.yaw) * -speed - this.velocity.x) * Math.min(1, dt * 6);
    this.velocity.z += (Math.cos(this.yaw) * -speed - this.velocity.z) * Math.min(1, dt * 6);
    this.velocity.y -= 24 * dt;
    this.velocity.y = Math.max(this.velocity.y, -32);

    if (this.kind === 'chicken') {
      this.hop += dt * 9;
      if (this.onGround && Math.sin(this.hop) > 0.92) this.velocity.y = 5.2;
    } else if (this.onGround && definition.hostile && playerDistance < 12 && Math.random() < dt * 1.4) {
      this.velocity.y = 6.4;
    }

    this.moveAxis('x', this.velocity.x * dt);
    this.moveAxis('z', this.velocity.z * dt);
    this.onGround = false;
    this.moveAxis('y', this.velocity.y * dt);
    this.animate(dt, Math.hypot(this.velocity.x, this.velocity.z) > 0.35);
    this.syncMesh();

    if (this.position.y < -6 || this.position.y > WORLD_HEIGHT + 20) {
      this.dead = true;
      return 0;
    }

    if (definition.hostile && playerDistance < 1.15 && Math.abs(playerPosition.y - this.position.y) < 1.7 && this.attackTimer === 0) {
      this.attackTimer = 1.05;
      return 2;
    }
    return 0;
  }

  containsPoint(point: THREE.Vector3): boolean {
    const width = this.definition.width;
    return Math.abs(point.x - this.position.x) < width
      && point.y >= this.position.y
      && point.y <= this.position.y + this.definition.height
      && Math.abs(point.z - this.position.z) < width;
  }

  dispose(scene: THREE.Scene): void {
    scene.remove(this.mesh);
    this.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose());
        else child.material.dispose();
      }
    });
  }

  private animate(deltaTime: number, moving: boolean): void {
    this.walkCycle += deltaTime * (moving ? 11 : 2);
    const swing = moving ? Math.sin(this.walkCycle) * (this.kind === 'chicken' ? 0.7 : 0.5) : 0;
    for (const limb of this.leftLimbs) limb.rotation.x = swing;
    for (const limb of this.rightLimbs) limb.rotation.x = -swing;
    if (this.kind === 'chicken' && this.extraLimbs.length >= 2) {
      const flap = Math.sin(this.hop) * 0.5;
      this.extraLimbs[0].rotation.z = 0.2 + flap;
      this.extraLimbs[1].rotation.z = -0.2 - flap;
    }
    if (this.kind === 'zombie') {
      for (const arm of this.extraLimbs) {
        arm.rotation.x = -1.2 + Math.sin(this.walkCycle) * 0.08;
      }
    }
  }

  private syncMesh(): void {
    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = this.yaw;
  }

  private createMesh(): THREE.Group {
    if (this.kind === 'pig') return this.createPig();
    if (this.kind === 'cow') return this.createCow();
    if (this.kind === 'chicken') return this.createChicken();
    return this.createZombie();
  }

  private limb(x: number, y: number, z: number, width: number, height: number, depth: number, material: THREE.Material, left: boolean): THREE.Group {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const mesh = box(width, height, depth, material, 0, -height / 2, 0);
    pivot.add(mesh);
    (left ? this.leftLimbs : this.rightLimbs).push(pivot);
    return pivot;
  }

  private createPig(): THREE.Group {
    const group = new THREE.Group();
    const pink = pigment(0xf2a7b4);
    const dark = pigment(0xd07f8c);
    const snout = pigment(0xe48b99);
    const hoof = pigment(0xc56d7a);
    group.add(box(0.58, 0.48, 0.92, pink, 0, 0.52, 0.04));
    group.add(box(0.44, 0.4, 0.42, pink, 0, 0.58, -0.52));
    group.add(box(0.26, 0.18, 0.18, snout, 0, 0.5, -0.76));
    group.add(box(0.04, 0.04, 0.03, dark, -0.06, 0.5, -0.86));
    group.add(box(0.04, 0.04, 0.03, dark, 0.06, 0.5, -0.86));
    group.add(box(0.16, 0.14, 0.08, dark, -0.18, 0.8, -0.48));
    group.add(box(0.16, 0.14, 0.08, dark, 0.18, 0.8, -0.48));
    group.add(box(0.08, 0.08, 0.03, pigment(0xf8f4f0), -0.12, 0.64, -0.74));
    group.add(box(0.08, 0.08, 0.03, pigment(0xf8f4f0), 0.12, 0.64, -0.74));
    group.add(box(0.04, 0.04, 0.02, pigment(0x2a1818), -0.12, 0.64, -0.76));
    group.add(box(0.04, 0.04, 0.02, pigment(0x2a1818), 0.12, 0.64, -0.76));
    group.add(box(0.08, 0.08, 0.14, dark, 0, 0.5, 0.54));
    group.add(this.limb(-0.18, 0.32, -0.28, 0.16, 0.32, 0.16, hoof, true));
    group.add(this.limb(0.18, 0.32, -0.28, 0.16, 0.32, 0.16, hoof, false));
    group.add(this.limb(-0.18, 0.32, 0.28, 0.16, 0.32, 0.16, hoof, false));
    group.add(this.limb(0.18, 0.32, 0.28, 0.16, 0.32, 0.16, hoof, true));
    return group;
  }

  private createCow(): THREE.Group {
    const group = new THREE.Group();
    const hide = pigment(0x6b4a32);
    const cream = pigment(0xf0e6d2);
    const muzzle = pigment(0xc9a07a);
    const hoof = pigment(0x2c2118);
    const horn = pigment(0xf4ead4);
    group.add(box(0.72, 0.62, 1.15, hide, 0, 0.92, 0.06));
    group.add(box(0.28, 0.22, 0.36, cream, -0.18, 1.08, 0.12));
    group.add(box(0.24, 0.18, 0.28, cream, 0.22, 0.82, -0.18));
    group.add(box(0.48, 0.42, 0.42, hide, 0, 1.18, -0.68));
    group.add(box(0.32, 0.18, 0.22, muzzle, 0, 1.04, -0.92));
    group.add(box(0.08, 0.08, 0.03, cream, -0.12, 1.26, -0.9));
    group.add(box(0.08, 0.08, 0.03, cream, 0.12, 1.26, -0.9));
    group.add(box(0.04, 0.04, 0.02, pigment(0x1a120c), -0.12, 1.26, -0.92));
    group.add(box(0.04, 0.04, 0.02, pigment(0x1a120c), 0.12, 1.26, -0.92));
    group.add(box(0.08, 0.16, 0.08, horn, -0.16, 1.46, -0.68));
    group.add(box(0.08, 0.16, 0.08, horn, 0.16, 1.46, -0.68));
    group.add(box(0.16, 0.12, 0.08, hide, -0.28, 1.32, -0.66));
    group.add(box(0.16, 0.12, 0.08, hide, 0.28, 1.32, -0.66));
    group.add(box(0.28, 0.14, 0.22, pigment(0xe0a7b4), 0, 0.58, 0.18));
    group.add(box(0.08, 0.36, 0.08, hide, 0, 0.92, 0.66));
    group.add(box(0.12, 0.12, 0.08, hoof, 0, 0.72, 0.74));
    group.add(this.limb(-0.22, 0.62, -0.32, 0.18, 0.62, 0.18, hoof, true));
    group.add(this.limb(0.22, 0.62, -0.32, 0.18, 0.62, 0.18, hoof, false));
    group.add(this.limb(-0.22, 0.62, 0.36, 0.18, 0.62, 0.18, hoof, false));
    group.add(this.limb(0.22, 0.62, 0.36, 0.18, 0.62, 0.18, hoof, true));
    return group;
  }

  private createChicken(): THREE.Group {
    const group = new THREE.Group();
    const white = pigment(0xf4f1e6);
    const beak = pigment(0xf0b43c);
    const comb = pigment(0xd23c3c);
    const leg = pigment(0xe09a32);
    group.add(box(0.34, 0.28, 0.38, white, 0, 0.42, 0));
    group.add(box(0.24, 0.22, 0.24, white, 0, 0.62, -0.22));
    group.add(box(0.12, 0.08, 0.16, beak, 0, 0.58, -0.38));
    group.add(box(0.06, 0.12, 0.08, comb, 0, 0.76, -0.22));
    group.add(box(0.04, 0.1, 0.06, comb, -0.05, 0.76, -0.2));
    group.add(box(0.04, 0.1, 0.06, comb, 0.05, 0.76, -0.2));
    group.add(box(0.06, 0.1, 0.06, comb, 0, 0.52, -0.32));
    group.add(box(0.06, 0.06, 0.02, pigment(0x2a1818), -0.06, 0.66, -0.34));
    group.add(box(0.06, 0.06, 0.02, pigment(0x2a1818), 0.06, 0.66, -0.34));
    group.add(box(0.22, 0.16, 0.08, white, 0, 0.48, 0.24));
    const leftWing = new THREE.Group();
    leftWing.position.set(-0.2, 0.46, 0);
    leftWing.add(box(0.08, 0.16, 0.24, white, 0, 0, 0));
    const rightWing = new THREE.Group();
    rightWing.position.set(0.2, 0.46, 0);
    rightWing.add(box(0.08, 0.16, 0.24, white, 0, 0, 0));
    this.extraLimbs.push(leftWing, rightWing);
    group.add(leftWing, rightWing);
    group.add(this.limb(-0.07, 0.28, 0.02, 0.05, 0.28, 0.05, leg, true));
    group.add(this.limb(0.07, 0.28, 0.02, 0.05, 0.28, 0.05, leg, false));
    return group;
  }

  private createZombie(): THREE.Group {
    const group = new THREE.Group();
    const skin = pigment(0x6a9a4e);
    const shirt = pigment(0x3f6b3a);
    const pants = pigment(0x2d3f6b);
    const brown = pigment(0x3d2a1c);
    group.add(box(0.34, 0.32, 0.32, skin, 0, 1.62, 0));
    group.add(box(0.12, 0.08, 0.04, pigment(0xf2efe4), -0.08, 1.66, -0.16));
    group.add(box(0.12, 0.08, 0.04, pigment(0xf2efe4), 0.08, 1.66, -0.16));
    group.add(box(0.05, 0.05, 0.02, pigment(0x1c140c), -0.08, 1.66, -0.18));
    group.add(box(0.05, 0.05, 0.02, pigment(0x1c140c), 0.08, 1.66, -0.18));
    group.add(box(0.16, 0.06, 0.08, pigment(0x4d6b3a), 0, 1.5, -0.14));
    group.add(box(0.38, 0.58, 0.22, shirt, 0, 1.16, 0));
    const leftArm = new THREE.Group();
    leftArm.position.set(-0.26, 1.32, 0);
    leftArm.add(box(0.14, 0.52, 0.14, skin, 0, -0.22, -0.16));
    const rightArm = new THREE.Group();
    rightArm.position.set(0.26, 1.32, 0);
    rightArm.add(box(0.14, 0.52, 0.14, skin, 0, -0.22, -0.16));
    leftArm.rotation.x = -1.2;
    rightArm.rotation.x = -1.2;
    this.extraLimbs.push(leftArm, rightArm);
    group.add(leftArm, rightArm);
    group.add(this.limb(-0.1, 0.86, 0, 0.16, 0.86, 0.16, pants, true));
    group.add(this.limb(0.1, 0.86, 0, 0.16, 0.86, 0.16, pants, false));
    group.add(box(0.18, 0.08, 0.28, brown, -0.1, 0.04, 0.02));
    group.add(box(0.18, 0.08, 0.28, brown, 0.1, 0.04, 0.02));
    return group;
  }

  private moveAxis(axis: 'x' | 'y' | 'z', amount: number): void {
    if (Math.abs(amount) < Number.EPSILON) return;
    const maxStep = 0.4;
    const steps = Math.max(1, Math.ceil(Math.abs(amount) / maxStep));
    const step = amount / steps;
    for (let index = 0; index < steps; index += 1) {
      if (this.resolveAxis(axis, step)) return;
    }
  }

  private resolveAxis(axis: 'x' | 'y' | 'z', amount: number): boolean {
    this.position[axis] += amount;
    const width = this.definition.width;
    const height = this.definition.height;
    const minimumX = Math.floor(this.position.x - width + 0.001);
    const maximumX = Math.floor(this.position.x + width - 0.001);
    const minimumY = Math.floor(this.position.y + 0.001);
    const maximumY = Math.floor(this.position.y + height - 0.001);
    const minimumZ = Math.floor(this.position.z - width + 0.001);
    const maximumZ = Math.floor(this.position.z + width - 0.001);

    for (let y = minimumY; y <= maximumY; y += 1) {
      for (let z = minimumZ; z <= maximumZ; z += 1) {
        for (let x = minimumX; x <= maximumX; x += 1) {
          if (!isSolid(this.world.getBlock(x, y, z))) continue;
          if (axis === 'x') {
            this.position.x = amount > 0 ? x - width - 0.001 : x + 1 + width + 0.001;
            this.velocity.x = 0;
            this.yaw += Math.PI * 0.35;
          } else if (axis === 'y') {
            if (amount > 0) this.position.y = y - height - 0.001;
            else {
              this.position.y = y + 1 + 0.001;
              this.onGround = true;
            }
            this.velocity.y = 0;
          } else {
            this.position.z = amount > 0 ? z - width - 0.001 : z + 1 + width + 0.001;
            this.velocity.z = 0;
            this.yaw += Math.PI * 0.35;
          }
          return true;
        }
      }
    }
    return false;
  }
}

export class MobManager {
  private readonly mobs: Mob[] = [];
  private spawnTimer = 4;
  private readonly scene: THREE.Scene;
  private readonly world: VoxelWorld;

  constructor(scene: THREE.Scene, world: VoxelWorld) {
    this.scene = scene;
    this.world = world;
  }

  get count(): number {
    return this.mobs.length;
  }

  spawnAround(origin: THREE.Vector3): void {
    const kinds: MobKind[] = ['pig', 'pig', 'cow', 'chicken', 'chicken'];
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2 + Math.random();
      const radius = 8 + Math.random() * 18;
      const x = Math.floor(origin.x + Math.cos(angle) * radius);
      const z = Math.floor(origin.z + Math.sin(angle) * radius);
      this.trySpawn(kinds[index % kinds.length], x, z);
    }
  }

  update(deltaTime: number, playerPosition: THREE.Vector3, daylight: number): number {
    let damage = 0;
    this.spawnTimer -= deltaTime;
    if (daylight < 0.18 && this.spawnTimer <= 0 && this.hostileCount() < 5) {
      this.spawnTimer = 5 + Math.random() * 6;
      const angle = Math.random() * Math.PI * 2;
      const radius = 14 + Math.random() * 10;
      this.trySpawn(
        'zombie',
        Math.floor(playerPosition.x + Math.cos(angle) * radius),
        Math.floor(playerPosition.z + Math.sin(angle) * radius),
      );
    }

    for (let index = this.mobs.length - 1; index >= 0; index -= 1) {
      const mob = this.mobs[index];
      const far = Math.hypot(mob.position.x - playerPosition.x, mob.position.z - playerPosition.z) > 56;
      damage += mob.update(deltaTime, playerPosition, daylight);
      if (!mob.alive || far) {
        mob.dispose(this.scene);
        this.mobs.splice(index, 1);
      }
    }
    return damage;
  }

  raycast(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): MobHit | null {
    const ray = direction.clone().normalize();
    let best: MobHit | null = null;
    for (const mob of this.mobs) {
      const center = new THREE.Vector3(mob.position.x, mob.position.y + mob.definition.height * 0.5, mob.position.z);
      const toMob = center.clone().sub(origin);
      const distance = toMob.dot(ray);
      if (distance < 0 || distance > maxDistance) continue;
      const closest = origin.clone().addScaledVector(ray, distance);
      const radius = Math.max(mob.definition.width, 0.45);
      if (closest.distanceTo(center) > radius + 0.35 && !mob.containsPoint(closest)) continue;
      if (!best || distance < best.distance) best = { mob, distance };
    }
    return best;
  }

  dispose(): void {
    for (const mob of this.mobs) mob.dispose(this.scene);
    this.mobs.length = 0;
  }

  private hostileCount(): number {
    return this.mobs.filter((mob) => mob.hostile).length;
  }

  private trySpawn(kind: MobKind, x: number, z: number): void {
    const surface = this.world.findSurface(x, z);
    const feet = this.world.getBlock(x, surface + 1, z);
    const ground = this.world.getBlock(x, surface, z);
    if (feet !== Block.Air && feet !== Block.TallGrass && feet !== Block.Flower) return;
    if (kind === 'zombie') {
      if (ground === Block.Water || ground === Block.Lava) return;
    } else if (ground !== Block.Grass && ground !== Block.Snow && ground !== Block.Sand) {
      return;
    }
    const mob = new Mob(kind, new THREE.Vector3(x + 0.5, surface + 1.02, z + 0.5), this.world);
    this.scene.add(mob.mesh);
    this.mobs.push(mob);
  }
}
