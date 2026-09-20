import * as THREE from 'three';
import { Block, isSolid } from './blocks';
import { SEA_LEVEL, VoxelWorld, WORLD_HEIGHT } from './world';

const PLAYER_RADIUS = 0.3;
const PLAYER_HEIGHT = 1.8;
const SNEAK_HEIGHT = 1.5;
const EYE_HEIGHT = 1.62;
const SNEAK_EYE = 1.27;
const COLLISION_EPSILON = 0.0001;
const MAX_MOVE_STEP = 0.4;
const TERMINAL_VELOCITY = 32;

export class Player {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  onGround = false;
  inWater = false;
  inLava = false;
  touchingCactus = false;
  headSubmerged = false;
  sneaking = false;
  flying = false;
  allowFlight = false;
  fallImpact = 0;
  bobTime = 0;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly world: VoxelWorld;
  private readonly canvas: HTMLCanvasElement;
  private readonly keys = new Set<string>();
  private yaw = 0;
  private pitch = 0;
  private jumpQueued = false;
  private spawnPoint = new THREE.Vector3(0.5, SEA_LEVEL + 8, 0.5);
  private fallStartY = 0;
  private wasInWater = false;

  constructor(camera: THREE.PerspectiveCamera, world: VoxelWorld, canvas: HTMLCanvasElement) {
    this.camera = camera;
    this.world = world;
    this.canvas = canvas;
    this.camera.rotation.order = 'YXZ';
    this.bindInput();
  }

  get pointerLocked(): boolean {
    return document.pointerLockElement === this.canvas;
  }

  get eyePosition(): THREE.Vector3 {
    return this.camera.position.clone();
  }

  get enteredWater(): boolean {
    return this.inWater && !this.wasInWater;
  }

  get lookYaw(): number {
    return this.yaw;
  }

  get lookPitch(): number {
    return this.pitch;
  }

  get colliderHeight(): number {
    return this.sneaking && !this.flying ? SNEAK_HEIGHT : PLAYER_HEIGHT;
  }

  setSpawn(position: THREE.Vector3): void {
    this.spawnPoint.copy(position);
    this.teleport(position);
  }

  getSpawn(): THREE.Vector3 {
    return this.spawnPoint.clone();
  }

  lookAt(yaw: number, pitch: number): void {
    this.yaw = yaw;
    this.pitch = THREE.MathUtils.clamp(pitch, -Math.PI * 0.495, Math.PI * 0.495);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  teleport(position: THREE.Vector3): void {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.fallStartY = position.y;
    this.fallImpact = 0;
    this.updateCamera(0);
  }

  requestPointerLock(): void {
    void this.canvas.requestPointerLock();
  }

  getViewDirection(target = new THREE.Vector3()): THREE.Vector3 {
    return this.camera.getWorldDirection(target);
  }

  update(deltaTime: number): void {
    const dt = Math.min(deltaTime, 0.05);
    this.wasInWater = this.inWater;
    this.sampleHazards();
    this.fallImpact = 0;

    const shift = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    if (!this.allowFlight) this.flying = false;

    const ceilingBlocked = this.wouldCollideAtHeight(PLAYER_HEIGHT);
    this.sneaking = !this.flying && (shift || ceilingBlocked);

    const forwardInput = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp')) - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    const sideInput = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight')) - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));
    const inputLength = Math.hypot(forwardInput, sideInput) || 1;
    const forward = forwardInput / inputLength;
    const side = sideInput / inputLength;
    const sprinting = this.keys.has('KeyR') && !this.sneaking && !this.inWater && !this.flying;
    const moveSpeed = this.flying
      ? 11
      : this.inLava
        ? 1.6
        : this.inWater
          ? 2.8
          : this.sneaking
            ? 1.35
            : sprinting
              ? 7.2
              : 4.6;
    const acceleration = this.flying ? 18 : this.onGround ? 38 : this.inWater || this.inLava ? 13 : 11;

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const targetX = (-sin * forward + cos * side) * moveSpeed;
    const targetZ = (-cos * forward - sin * side) * moveSpeed;
    const blend = Math.min(1, acceleration * dt);
    this.velocity.x += (targetX - this.velocity.x) * blend;
    this.velocity.z += (targetZ - this.velocity.z) * blend;

    if (this.flying) {
      const ascend = Number(this.keys.has('Space')) - Number(shift);
      this.velocity.y += (ascend * 8.5 - this.velocity.y) * Math.min(1, dt * 8);
    } else if (this.inWater || this.inLava) {
      this.fallStartY = this.position.y;
      this.velocity.y -= (this.inLava ? 3.2 : 4.5) * dt;
      if (this.keys.has('Space')) this.velocity.y += 11 * dt;
      this.velocity.y *= Math.max(0, 1 - 1.6 * dt);
    } else {
      this.velocity.y -= 27 * dt;
      this.velocity.y = Math.max(this.velocity.y, -TERMINAL_VELOCITY);
      if (this.jumpQueued && this.onGround) {
        this.velocity.y = this.sneaking ? 6.4 : 8.7;
        this.onGround = false;
      }
    }
    this.jumpQueued = false;

    const grounded = this.onGround;
    const previousX = this.position.x;
    this.moveAxis('x', this.velocity.x * dt);
    if (this.sneaking && grounded && !this.hasGroundBelow()) {
      this.position.x = previousX;
      this.velocity.x = 0;
    }
    const previousZ = this.position.z;
    this.moveAxis('z', this.velocity.z * dt);
    if (this.sneaking && grounded && !this.hasGroundBelow()) {
      this.position.z = previousZ;
      this.velocity.z = 0;
    }

    const wasOnGround = this.onGround;
    const previousY = this.position.y;
    this.onGround = false;
    this.moveAxis('y', this.velocity.y * dt);
    if (!wasOnGround && this.onGround) {
      const fallen = this.fallStartY - this.position.y;
      if (!this.inWater && !this.inLava && !this.flying && fallen > 3.2) {
        this.fallImpact = fallen - 3;
      }
    }
    if (this.onGround || this.inWater || this.inLava || this.flying) this.fallStartY = this.position.y;
    else this.fallStartY = Math.max(this.fallStartY, previousY);

    if (this.position.y < -8 || this.position.y > WORLD_HEIGHT + 40) {
      this.fallImpact = Math.max(this.fallImpact, 40);
      this.teleport(this.spawnPoint);
    }

    const horizontalSpeed = Math.hypot(this.velocity.x, this.velocity.z);
    if (this.onGround && horizontalSpeed > 0.2) this.bobTime += dt * (sprinting ? 13 : 9);
    else this.bobTime += (0 - this.bobTime) * Math.min(1, dt * 5);
    this.updateCamera(horizontalSpeed);

    const targetFov = sprinting && forwardInput > 0 ? 78 : 74;
    this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, dt * 7);
    this.camera.updateProjectionMatrix();
  }

  intersectsBlock(x: number, y: number, z: number): boolean {
    const height = this.colliderHeight;
    return this.position.x + PLAYER_RADIUS > x
      && this.position.x - PLAYER_RADIUS < x + 1
      && this.position.y + height > y
      && this.position.y < y + 1
      && this.position.z + PLAYER_RADIUS > z
      && this.position.z - PLAYER_RADIUS < z + 1;
  }

  private bindInput(): void {
    const releaseKeys = (): void => {
      this.keys.clear();
      this.jumpQueued = false;
    };
    window.addEventListener('keydown', (event) => {
      if (!this.pointerLocked) return;
      if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown'].includes(event.code)) {
        event.preventDefault();
      }
      if (event.code === 'Space' && !event.repeat) this.jumpQueued = true;
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', releaseKeys);
    document.addEventListener('pointerlockchange', () => {
      if (!this.pointerLocked) releaseKeys();
    });
    document.addEventListener('mousemove', (event) => {
      if (!this.pointerLocked) return;
      this.yaw -= event.movementX * 0.0021;
      this.pitch -= event.movementY * 0.0021;
      this.pitch = THREE.MathUtils.clamp(this.pitch, -Math.PI * 0.495, Math.PI * 0.495);
      this.camera.rotation.set(this.pitch, this.yaw, 0);
    });
  }

  private sampleHazards(): void {
    this.inWater = false;
    this.inLava = false;
    this.touchingCactus = false;
    const height = this.colliderHeight;
    const minimumX = Math.floor(this.position.x - PLAYER_RADIUS + COLLISION_EPSILON);
    const maximumX = Math.floor(this.position.x + PLAYER_RADIUS - COLLISION_EPSILON);
    const minimumY = Math.floor(this.position.y + COLLISION_EPSILON);
    const maximumY = Math.floor(this.position.y + height - COLLISION_EPSILON);
    const minimumZ = Math.floor(this.position.z - PLAYER_RADIUS + COLLISION_EPSILON);
    const maximumZ = Math.floor(this.position.z + PLAYER_RADIUS - COLLISION_EPSILON);
    for (let y = minimumY; y <= maximumY; y += 1) {
      for (let z = minimumZ; z <= maximumZ; z += 1) {
        for (let x = minimumX; x <= maximumX; x += 1) {
          const block = this.world.getBlock(x, y, z);
          if (block === Block.Water) this.inWater = true;
          if (block === Block.Lava) this.inLava = true;
          if (block === Block.Cactus) this.touchingCactus = true;
        }
      }
    }
    const eye = this.position.y + (this.sneaking && !this.flying ? SNEAK_EYE : EYE_HEIGHT);
    this.headSubmerged = this.world.getBlock(Math.floor(this.position.x), Math.floor(eye), Math.floor(this.position.z)) === Block.Water;
  }

  private updateCamera(horizontalSpeed: number): void {
    const bobStrength = this.onGround && horizontalSpeed > 0.2 ? Math.min(horizontalSpeed / 7, 1) : 0;
    const bobY = Math.abs(Math.sin(this.bobTime)) * 0.045 * bobStrength;
    const bobX = Math.cos(this.bobTime * 0.5) * 0.024 * bobStrength;
    const eye = this.sneaking && !this.flying ? SNEAK_EYE : EYE_HEIGHT;
    this.camera.position.set(this.position.x + bobX, this.position.y + eye + bobY, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  private hasGroundBelow(): boolean {
    const y = Math.floor(this.position.y - 0.08);
    const minimumX = Math.floor(this.position.x - PLAYER_RADIUS + COLLISION_EPSILON);
    const maximumX = Math.floor(this.position.x + PLAYER_RADIUS - COLLISION_EPSILON);
    const minimumZ = Math.floor(this.position.z - PLAYER_RADIUS + COLLISION_EPSILON);
    const maximumZ = Math.floor(this.position.z + PLAYER_RADIUS - COLLISION_EPSILON);
    for (let z = minimumZ; z <= maximumZ; z += 1) {
      for (let x = minimumX; x <= maximumX; x += 1) {
        if (isSolid(this.world.getBlock(x, y, z))) return true;
      }
    }
    return false;
  }

  private wouldCollideAtHeight(height: number): boolean {
    const minimumX = Math.floor(this.position.x - PLAYER_RADIUS + COLLISION_EPSILON);
    const maximumX = Math.floor(this.position.x + PLAYER_RADIUS - COLLISION_EPSILON);
    const minimumY = Math.floor(this.position.y + COLLISION_EPSILON);
    const maximumY = Math.floor(this.position.y + height - COLLISION_EPSILON);
    const minimumZ = Math.floor(this.position.z - PLAYER_RADIUS + COLLISION_EPSILON);
    const maximumZ = Math.floor(this.position.z + PLAYER_RADIUS - COLLISION_EPSILON);
    for (let y = minimumY; y <= maximumY; y += 1) {
      for (let z = minimumZ; z <= maximumZ; z += 1) {
        for (let x = minimumX; x <= maximumX; x += 1) {
          if (isSolid(this.world.getBlock(x, y, z))) return true;
        }
      }
    }
    return false;
  }

  private moveAxis(axis: 'x' | 'y' | 'z', amount: number): void {
    if (Math.abs(amount) < Number.EPSILON) return;
    const steps = Math.max(1, Math.ceil(Math.abs(amount) / MAX_MOVE_STEP));
    const step = amount / steps;
    for (let index = 0; index < steps; index += 1) {
      if (this.resolveAxis(axis, step)) return;
    }
  }

  private resolveAxis(axis: 'x' | 'y' | 'z', amount: number): boolean {
    this.position[axis] += amount;
    const height = this.colliderHeight;
    const minimumX = Math.floor(this.position.x - PLAYER_RADIUS + COLLISION_EPSILON);
    const maximumX = Math.floor(this.position.x + PLAYER_RADIUS - COLLISION_EPSILON);
    const minimumY = Math.floor(this.position.y + COLLISION_EPSILON);
    const maximumY = Math.floor(this.position.y + height - COLLISION_EPSILON);
    const minimumZ = Math.floor(this.position.z - PLAYER_RADIUS + COLLISION_EPSILON);
    const maximumZ = Math.floor(this.position.z + PLAYER_RADIUS - COLLISION_EPSILON);

    for (let y = minimumY; y <= maximumY; y += 1) {
      for (let z = minimumZ; z <= maximumZ; z += 1) {
        for (let x = minimumX; x <= maximumX; x += 1) {
          if (!isSolid(this.world.getBlock(x, y, z))) continue;
          if (axis === 'x') {
            this.position.x = amount > 0
              ? x - PLAYER_RADIUS - COLLISION_EPSILON
              : x + 1 + PLAYER_RADIUS + COLLISION_EPSILON;
            this.velocity.x = 0;
          } else if (axis === 'y') {
            if (amount > 0) {
              this.position.y = y - height - COLLISION_EPSILON;
            } else {
              this.position.y = y + 1 + COLLISION_EPSILON;
              this.onGround = true;
            }
            this.velocity.y = 0;
          } else {
            this.position.z = amount > 0
              ? z - PLAYER_RADIUS - COLLISION_EPSILON
              : z + 1 + PLAYER_RADIUS + COLLISION_EPSILON;
            this.velocity.z = 0;
          }
          return true;
        }
      }
    }
    return false;
  }
}
