import * as THREE from 'three';
import {
  BLOCKS,
  Block,
  HOTBAR_SIZE,
  MAX_STACK,
  attackDamage,
  blockDrop,
  blockHardness,
  blockName,
  canHarvest,
  createBlockAtlas,
  isBreakable,
  isPlaceable,
  isReplaceable,
  isSolid,
  isTool,
  itemDurability,
  itemToolType,
  mineMultiplier,
} from './blocks';
import { RECIPES, clickStacks, hasRecipeMaterials, matchRecipe, recipeCost, type Recipe } from './crafting';
import { Inventory, type GameMode, type InventorySave, type ItemStack } from './inventory';
import { MobManager } from './mobs';
import { Player } from './player';
import { GameUI } from './ui';
import { VoxelWorld, type VoxelHit } from './world';

const SEED_STORAGE_KEY = 'blockscape:active-seed';
const playerSaveKey = (seed: number): string => `blockscape:player:${seed | 0}`;

type BlockParticle = {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number;
};

type WorldItem = {
  block: Block;
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  age: number;
  durability?: number;
};

type PlayerSave = {
  mode: GameMode;
  health: number;
  energy: number;
  air: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  flying: boolean;
  inventory: InventorySave;
};

const randomSeed = (): number => {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] | 0;
};

const readStoredSeed = (): number | undefined => {
  try {
    const stored = localStorage.getItem(SEED_STORAGE_KEY);
    if (stored !== null && Number.isFinite(Number(stored))) return Number(stored) | 0;
  } catch {
    // Web Storage can throw in private / blocked contexts.
  }
  return undefined;
};

const writeStoredSeed = (seed: number): void => {
  try {
    localStorage.setItem(SEED_STORAGE_KEY, String(seed));
  } catch {
    // Persistence is optional — the world can still run in memory.
  }
};

export function getOrCreateSeed(): number {
  const stored = readStoredSeed();
  if (stored !== undefined) return stored;
  const seed = randomSeed();
  writeStoredSeed(seed);
  return seed;
}

export class Game {
  private readonly seed: number;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 150);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly clock = new THREE.Clock();
  private readonly ui: GameUI;
  private readonly inventory = new Inventory();
  private readonly hemisphereLight = new THREE.HemisphereLight(0xaedcff, 0x4e3925, 1.5);
  private readonly sun = new THREE.DirectionalLight(0xfff3d1, 2.4);
  private readonly sunTarget = new THREE.Object3D();
  private readonly sunMesh: THREE.Mesh;
  private readonly moonMesh: THREE.Mesh;
  private readonly cloudGroup = new THREE.Group();
  private readonly particleGroup = new THREE.Group();
  private readonly itemGroup = new THREE.Group();
  private readonly particles: BlockParticle[] = [];
  private readonly items: WorldItem[] = [];
  private readonly particleGeometry = new THREE.BoxGeometry(0.12, 0.12, 0.12);
  private readonly itemGeometry = new THREE.BoxGeometry(0.28, 0.28, 0.28);
  private readonly particleMaterials = new Map<Block, THREE.MeshBasicMaterial>();
  private readonly itemMaterials = new Map<Block, THREE.MeshBasicMaterial>();
  private readonly selectionOutline: THREE.LineSegments;
  private readonly stars: THREE.Points;
  private readonly torchLights: THREE.PointLight[] = [];
  private readonly handLight: THREE.PointLight;
  private world!: VoxelWorld;
  private player!: Player;
  private mobs!: MobManager;
  private heldItem!: THREE.Group;
  private heldCube!: THREE.Mesh;
  private heldTool!: THREE.Group;
  private heldToolHead!: THREE.Mesh;
  private craftingOpen = false;
  private craftingAtTable = false;
  private craftSlots: Array<ItemStack | null> = [];
  private cursorStack: ItemStack | null = null;
  private mode: GameMode = 'survival';
  private health = 20;
  private energy = 20;
  private air = 20;
  private invulnerable = 0;
  private cactusTimer = 0;
  private lavaTimer = 0;
  private drownTimer = 0;
  private attackCooldown = 0;
  private playerSaveTimer = 0;
  private lastBobSin = 0;
  private daylight = 1;
  private deathCause = 'You died.';
  private dead = false;
  private started = false;
  private mining = false;
  private mineProgress = 0;
  private mineKey = '';
  private fps = 60;
  private statsTimer = 0;
  private dayTime = 0.19;
  private swing = 0;
  private actionTimer?: number;
  private audioContext?: AudioContext;

  constructor(seed: number) {
    this.seed = seed;
    this.ui = new GameUI(seed);
    const host = document.querySelector<HTMLElement>('#game');
    if (!host) throw new Error('Missing game container');

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.append(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x83c9f4);
    this.scene.fog = new THREE.Fog(0x83c9f4, 38, 105);
    this.scene.add(this.camera, this.hemisphereLight, this.sun, this.sunTarget, this.cloudGroup, this.particleGroup, this.itemGroup);

    this.sunMesh = new THREE.Mesh(
      new THREE.SphereGeometry(5.5, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff3c2, fog: false }),
    );
    this.moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(4, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xd5deee, fog: false }),
    );
    this.scene.add(this.sunMesh, this.moonMesh);

    const outlineGeometry = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.008, 1.008, 1.008));
    const outlineMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.88 });
    outlineMaterial.depthTest = false;
    this.selectionOutline = new THREE.LineSegments(outlineGeometry, outlineMaterial);
    this.selectionOutline.renderOrder = 100;
    this.selectionOutline.visible = false;
    this.scene.add(this.selectionOutline);

    this.stars = this.createStars();
    this.scene.add(this.stars);
    this.configureSunShadows();

    for (let index = 0; index < 6; index += 1) {
      const light = new THREE.PointLight(0xffc27a, 0, 9, 2);
      this.scene.add(light);
      this.torchLights.push(light);
    }
    this.handLight = new THREE.PointLight(0xffd89a, 0, 7, 2);
    this.camera.add(this.handLight);
  }

  async initialize(): Promise<void> {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const atlas = createBlockAtlas();
    this.world = new VoxelWorld(this.scene, atlas, this.seed, () => {
      this.ui.saved();
      this.savePlayer();
    });
    this.world.initializeAround(0, 0, 2);
    const spawn = this.world.findSpawn();
    this.player = new Player(this.camera, this.world, this.renderer.domElement);
    this.player.setSpawn(spawn);
    this.mobs = new MobManager(this.scene, this.world);
    this.createClouds();
    this.createHeldItem();
    this.loadPlayer();
    this.mobs.spawnAround(this.player.position);
    this.syncHotbar();
    this.ui.setMode(this.mode);
    this.bindEvents();
    this.ui.setReady();
    this.ui.toast(this.mode === 'survival'
      ? 'Survival — punch a tree, press E to open inventory and craft'
      : 'Creative mode — infinite blocks, press F to fly');
    this.clock.start();
    this.animate();
  }

  private bindEvents(): void {
    const start = (): void => {
      if (this.dead) return;
      this.started = true;
      this.resumeAudio();
      this.player.requestPointerLock();
    };
    this.ui.onPlay(start);
    this.ui.onResume(start);
    this.ui.onRespawn(() => this.respawn());
    this.ui.onToggleMode(() => this.toggleMode());
    this.ui.onCloseCraft(() => this.closeCrafting());
    this.ui.onCraftGrid((index, right) => this.clickCraftGrid(index, right));
    this.ui.onCraftResult(() => this.takeCraftResult());
    this.ui.onInventorySlot((index, right) => this.clickInventory(index, right));
    this.ui.onRecipeCraft((id) => this.craftRecipe(id));
    this.ui.onNewWorld(() => {
      if (!window.confirm('Leave this world and generate a new one?')) return;
      this.world.saveNow();
      this.savePlayer();
      writeStoredSeed(randomSeed());
      window.location.reload();
    });

    document.addEventListener('pointerlockchange', () => {
      this.stopRepeatingAction();
      this.mining = false;
      this.mineProgress = 0;
      this.ui.setMining(null);
      if (this.player.pointerLocked) {
        this.craftingOpen = false;
        this.ui.showPlaying();
        this.syncHeldItem();
      } else if (this.dead) this.ui.showDeath(this.deathCause);
      else if (this.craftingOpen) this.ui.showCrafting(this.craftingAtTable);
      else if (this.started) this.ui.showPaused();
    });

    this.renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());
    this.renderer.domElement.addEventListener('mousedown', (event) => {
      if (!this.player.pointerLocked || this.dead) return;
      event.preventDefault();
      if (event.button === 0) {
        this.mining = true;
        this.tryAttack();
      } else if (event.button === 2) {
        this.placeTarget();
        this.stopRepeatingAction();
        this.actionTimer = window.setInterval(() => this.placeTarget(), 165);
      } else if (event.button === 1) {
        this.pickTarget();
      }
    });
    window.addEventListener('mouseup', () => {
      this.stopRepeatingAction();
      this.mining = false;
      this.mineProgress = 0;
      this.mineKey = '';
      this.ui.setMining(null);
    });

    this.renderer.domElement.addEventListener('wheel', (event) => {
      if (!this.player.pointerLocked) return;
      event.preventDefault();
      this.inventory.cycle(event.deltaY > 0 ? 1 : -1);
      this.syncHotbar();
    }, { passive: false });

    window.addEventListener('keydown', (event) => {
      if (this.dead) return;
      if (event.code === 'KeyE' || event.code === 'KeyC') {
        event.preventDefault();
        if (this.craftingOpen) this.closeCrafting();
        else if (this.player.pointerLocked) this.openCrafting(false);
        return;
      }
      if (event.code === 'Escape' && this.craftingOpen) {
        event.preventDefault();
        this.closeCrafting();
        return;
      }
      if (!this.player.pointerLocked) return;
      if (event.code.startsWith('Digit')) {
        const index = Number(event.code.slice(5)) - 1;
        if (index >= 0 && index < HOTBAR_SIZE) {
          this.inventory.select(index);
          this.syncHotbar();
        }
      }
      if (event.code === 'KeyQ') this.dropSelected();
      if (event.code === 'KeyF' && this.mode === 'creative') {
        this.player.flying = !this.player.flying;
        this.ui.toast(this.player.flying ? 'Flying' : 'Walking');
      }
    });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('beforeunload', () => {
      this.world.saveNow();
      this.savePlayer();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.world.saveNow();
        this.savePlayer();
      }
    });
  }

  private animate = (): void => {
    requestAnimationFrame(this.animate);
    const deltaTime = Math.min(this.clock.getDelta(), 0.05);
    this.fps += ((1 / Math.max(deltaTime, 0.001)) - this.fps) * Math.min(1, deltaTime * 3);
    this.invulnerable = Math.max(0, this.invulnerable - deltaTime);
    this.attackCooldown = Math.max(0, this.attackCooldown - deltaTime);

    if (this.started && this.player.pointerLocked && !this.dead) {
      this.player.update(deltaTime);
      if (this.player.enteredWater) this.playTone(420, 0.12, 'sine', 0.08);
      this.updateSurvival(deltaTime);
      this.updateMining(deltaTime);
      this.updateFootsteps();
    }
    this.world.updateStreaming(this.player.position.x, this.player.position.z);
    if (!this.dead) {
      const mobDamage = this.mobs.update(deltaTime, this.player.position, this.daylight);
      if (mobDamage > 0) this.hurt(mobDamage, 'A zombie got you.');
    }
    this.updateTarget();
    this.updateDayNight(deltaTime);
    this.updateClouds(deltaTime);
    this.updateParticles(deltaTime);
    this.updateItems(deltaTime);
    this.updateViewModel(deltaTime);
    this.updateLights();

    this.statsTimer += deltaTime;
    if (this.statsTimer >= 0.2) {
      this.statsTimer = 0;
      const position = this.player.position;
      this.ui.updateStats(
        position.x,
        position.y,
        position.z,
        this.world.biomeAt(Math.floor(position.x), Math.floor(position.z)),
        this.fps,
        this.world.loadedChunkCount,
      );
      this.ui.setVitals(this.health, this.energy, this.air, this.player.headSubmerged);
    }

    this.playerSaveTimer += deltaTime;
    if (this.playerSaveTimer >= 2.5) {
      this.playerSaveTimer = 0;
      this.savePlayer();
    }
    this.renderer.render(this.scene, this.camera);
  };

  private currentHit(): VoxelHit | null {
    return this.world.raycast(this.player.eyePosition, this.player.getViewDirection(), 6);
  }

  private updateTarget(): void {
    if (!this.player.pointerLocked || this.dead) {
      this.selectionOutline.visible = false;
      this.ui.setTarget();
      return;
    }
    const eye = this.player.eyePosition;
    const direction = this.player.getViewDirection();
    const mobHit = this.mobs.raycast(eye, direction, 6);
    const blockHit = this.currentHit();
    if (mobHit && (!blockHit || mobHit.distance < blockHit.distance)) {
      this.selectionOutline.visible = false;
      this.ui.setTarget(mobHit.mob.name.toUpperCase());
      return;
    }
    if (!blockHit) {
      this.selectionOutline.visible = false;
      this.ui.setTarget();
      return;
    }
    this.selectionOutline.visible = true;
    this.selectionOutline.position.set(blockHit.x + 0.5, blockHit.y + 0.5, blockHit.z + 0.5);
    const crack = this.mining && this.mineKey === `${blockHit.x},${blockHit.y},${blockHit.z}` ? this.mineProgress : 0;
    (this.selectionOutline.material as THREE.LineBasicMaterial).color.set(crack > 0.55 ? 0xffb070 : 0xffffff);
    this.ui.setTarget(blockName(blockHit.block).toUpperCase());
  }

  private tryAttack(): void {
    if (this.attackCooldown > 0) return;
    const eye = this.player.eyePosition;
    const direction = this.player.getViewDirection();
    const mobHit = this.mobs.raycast(eye, direction, 4.5);
    const blockHit = this.currentHit();
    if (!mobHit || (blockHit && blockHit.distance < mobHit.distance)) return;
    const held = this.inventory.selectedBlock;
    this.attackCooldown = itemToolType(held ?? Block.Air) === 'sword' ? 0.28 : 0.32;
    this.swing = 1;
    this.playBlockSound(0.7);
    mobHit.mob.knockback(this.player.position, itemToolType(held ?? Block.Air) === 'sword' ? 8 : 6);
    const damage = this.mode === 'creative' ? 20 : attackDamage(held);
    if (this.mode === 'survival' && held !== undefined && isTool(held) && this.inventory.damageSelected()) {
      this.ui.toast(`Your ${blockName(held)} broke`);
    }
    if (mobHit.mob.damage(damage)) {
      this.spawnParticles(mobHit.mob.position.x, mobHit.mob.position.y + 0.6, mobHit.mob.position.z, Block.Dirt);
      this.ui.toast(`${mobHit.mob.name} defeated`);
      if (this.mode === 'survival' && !mobHit.mob.hostile) {
        this.energy = Math.min(20, this.energy + 4);
      }
    }
    this.syncHotbar();
  }

  private updateMining(deltaTime: number): void {
    if (!this.mining || this.dead) {
      this.ui.setMining(null);
      return;
    }
    const eye = this.player.eyePosition;
    const direction = this.player.getViewDirection();
    const mobHit = this.mobs.raycast(eye, direction, 4.5);
    const hit = this.currentHit();
    if (mobHit && (!hit || mobHit.distance < hit.distance)) {
      this.ui.setMining(null);
      return;
    }
    if (!hit || !isBreakable(hit.block)) {
      this.mineProgress = 0;
      this.ui.setMining(null);
      return;
    }
    const key = `${hit.x},${hit.y},${hit.z}`;
    if (key !== this.mineKey) {
      this.mineKey = key;
      this.mineProgress = 0;
    }
    const held = this.inventory.selectedBlock;
    const needed = this.mode === 'creative'
      ? 0.08
      : Math.max(0.08, blockHardness(hit.block) / mineMultiplier(held, hit.block));
    this.mineProgress += deltaTime;
    this.swing = Math.max(this.swing, 0.55);
    this.ui.setMining(Math.min(1, this.mineProgress / needed));
    if (this.mineProgress < needed) return;
    this.mineProgress = 0;
    this.mineKey = '';
    this.breakBlock(hit);
  }

  private breakBlock(hit: VoxelHit): void {
    if (!this.world.setBlock(hit.x, hit.y, hit.z, Block.Air)) return;
    this.spawnParticles(hit.x, hit.y, hit.z, hit.block);
    this.playBlockSound(0.82);
    this.swing = 1;
    const held = this.inventory.selectedBlock;
    if (this.mode === 'survival') {
      const drop = canHarvest(held, hit.block) ? blockDrop(hit.block) : null;
      if (drop !== null) this.spawnItem(hit.x + 0.5, hit.y + 0.4, hit.z + 0.5, drop);
      this.energy = Math.max(0, this.energy - 0.15);
      if (held !== undefined && isTool(held) && this.inventory.damageSelected()) {
        this.ui.toast(`Your ${blockName(held)} broke`);
      }
    }
    this.syncHotbar();
  }

  private placeTarget(): void {
    if (this.dead) return;
    const hit = this.currentHit();
    if (hit?.block === Block.CraftingTable) {
      this.openCrafting(true);
      return;
    }
    const block = this.inventory.selectedBlock;
    if (block === undefined) {
      this.ui.toast('Select a block to place');
      return;
    }
    if (!isPlaceable(block)) {
      this.ui.toast(isTool(block) ? 'That is a tool' : 'Cannot place that');
      return;
    }
    if (!hit) return;
    const x = hit.previousX;
    const y = hit.previousY;
    const z = hit.previousZ;
    const existing = this.world.getBlock(x, y, z);
    if (!isReplaceable(existing)) return;
    if (this.player.intersectsBlock(x, y, z)) {
      this.ui.toast('Not enough room to place that block');
      return;
    }
    const placed = this.inventory.consumeSelected(this.mode === 'creative');
    if (placed === undefined) return;
    if (this.world.setBlock(x, y, z, placed)) {
      this.playBlockSound(1.15);
      this.swing = 1;
      this.syncHotbar();
    } else if (this.mode === 'survival') {
      this.inventory.add(placed, 1);
    }
  }

  private pickTarget(): void {
    const hit = this.currentHit();
    if (!hit) return;
    if (this.mode === 'creative') {
      this.inventory.setSlot(this.inventory.selectedIndex, hit.block, MAX_STACK);
      this.syncHotbar();
      this.ui.toast(`Selected ${blockName(hit.block)}`);
      return;
    }
    const index = this.inventory.slots.findIndex((slot) => slot?.block === hit.block);
    if (index === -1) {
      this.ui.toast('You have not collected that yet');
      return;
    }
    this.inventory.select(index);
    this.syncHotbar();
    this.ui.toast(`Selected ${blockName(hit.block)}`);
  }

  private openCrafting(table: boolean): void {
    this.craftingOpen = true;
    this.craftingAtTable = table;
    this.craftSlots = Array.from({ length: table ? 9 : 4 }, () => null);
    this.mining = false;
    this.stopRepeatingAction();
    this.ui.showCrafting(table);
    this.refreshCraftUI();
    document.exitPointerLock();
  }

  private closeCrafting(): void {
    for (const slot of this.craftSlots) this.returnStack(slot);
    this.returnStack(this.cursorStack);
    this.craftSlots = [];
    this.cursorStack = null;
    this.craftingOpen = false;
    this.syncHotbar();
    if (!this.dead && this.started) this.player.requestPointerLock();
    else this.ui.showPaused();
  }

  private returnStack(stack: ItemStack | null): void {
    if (!stack) return;
    const leftover = this.inventory.add(stack.block, stack.count, stack.durability);
    if (leftover <= 0) return;
    const origin = this.player.eyePosition;
    this.spawnItem(origin.x, origin.y, origin.z, stack.block, undefined, leftover, stack.durability);
  }

  private refreshCraftUI(): void {
    const recipe = matchRecipe(this.craftSlots, this.craftingAtTable);
    const result = recipe
      ? { block: recipe.result, count: recipe.count, durability: itemDurability(recipe.result) }
      : null;
    this.ui.refreshCrafting(
      this.craftingAtTable,
      this.craftSlots,
      result,
      this.inventory.slots,
      this.cursorStack,
      (entry) => this.canCraftRecipe(entry),
      (entry) => this.hasMaterialsFor(entry),
    );
    this.ui.refreshHotbar(this.inventory.slots, this.inventory.selectedIndex, this.mode === 'survival');
  }

  private hasMaterialsFor(recipe: Recipe): boolean {
    return this.mode === 'creative' || hasRecipeMaterials(recipe, (block) => this.inventory.countOf(block));
  }

  private canCraftRecipe(recipe: Recipe): boolean {
    if (recipe.table && !this.craftingAtTable && this.mode !== 'creative') return false;
    return this.hasMaterialsFor(recipe);
  }

  private craftRecipe(id: string): void {
    const recipe = RECIPES.find((entry) => entry.id === id);
    if (!recipe || !this.canCraftRecipe(recipe)) return;
    if (this.mode !== 'creative') {
      for (const [block, count] of recipeCost(recipe)) this.inventory.consume(block, count);
    }
    const leftover = this.inventory.add(recipe.result, recipe.count);
    if (leftover > 0) {
      this.returnStack({ block: recipe.result, count: leftover, durability: itemDurability(recipe.result) });
    }
    this.playTone(660, 0.08, 'triangle', 0.07);
    this.ui.toast(`Crafted ${blockName(recipe.result)}`);
    this.refreshCraftUI();
  }

  private clickCraftGrid(index: number, right: boolean): void {
    const next = clickStacks(this.craftSlots[index] ?? null, this.cursorStack, right);
    this.craftSlots[index] = next.slot;
    this.cursorStack = next.cursor;
    this.refreshCraftUI();
  }

  private clickInventory(index: number, right: boolean): void {
    const next = clickStacks(this.inventory.slots[index], this.cursorStack, right);
    this.inventory.slots[index] = next.slot;
    this.cursorStack = next.cursor;
    this.refreshCraftUI();
  }

  private takeCraftResult(): void {
    const recipe = matchRecipe(this.craftSlots, this.craftingAtTable);
    if (!recipe) return;
    const result: ItemStack = {
      block: recipe.result,
      count: recipe.count,
      durability: itemDurability(recipe.result),
    };
    if (this.cursorStack) {
      if (this.cursorStack.block !== result.block || isTool(result.block)) return;
      this.cursorStack.count += result.count;
    } else {
      this.cursorStack = result;
    }
    for (let index = 0; index < this.craftSlots.length; index += 1) {
      const slot = this.craftSlots[index];
      if (!slot) continue;
      slot.count -= 1;
      if (slot.count <= 0) this.craftSlots[index] = null;
    }
    this.playTone(660, 0.08, 'triangle', 0.07);
    this.refreshCraftUI();
  }

  private dropSelected(): void {
    const taken = this.mode === 'creative'
      ? (this.inventory.selected
        ? { block: this.inventory.selected.block, count: 1, durability: this.inventory.selected.durability }
        : undefined)
      : this.inventory.takeSelected(1);
    if (!taken) return;
    const origin = this.player.eyePosition;
    const direction = this.player.getViewDirection();
    this.spawnItem(
      origin.x + direction.x,
      origin.y + direction.y,
      origin.z + direction.z,
      taken.block,
      direction.clone().multiplyScalar(5),
      taken.count,
      taken.durability,
    );
    this.syncHotbar();
  }

  private toggleMode(): void {
    this.mode = this.mode === 'survival' ? 'creative' : 'survival';
    this.player.allowFlight = this.mode === 'creative';
    if (this.mode === 'creative') {
      this.inventory.fillCreativePalette();
      this.health = 20;
      this.energy = 20;
      this.air = 20;
      this.ui.toast('Creative — infinite blocks, press F to fly');
    } else {
      this.player.flying = false;
      this.ui.toast('Survival — gather, craft, and stay alive');
    }
    this.ui.setMode(this.mode);
    this.syncHotbar();
    this.savePlayer();
  }

  private updateSurvival(deltaTime: number): void {
    if (this.mode === 'creative') {
      this.health = 20;
      this.energy = 20;
      this.air = 20;
      this.ui.setOverlays(false, false);
      if (this.scene.fog instanceof THREE.Fog) {
        this.scene.fog.near = 38;
        this.scene.fog.far = 105;
      }
      return;
    }

    const sprinting = Math.hypot(this.player.velocity.x, this.player.velocity.z) > 6.2 && this.player.onGround;
    if (sprinting || this.mining) this.energy = Math.max(0, this.energy - deltaTime * (sprinting ? 1.35 : 0.55));
    else this.energy = Math.min(20, this.energy + deltaTime * 0.85);
    if (this.energy > 16.5 && this.health < 20 && !this.player.inLava) {
      this.health = Math.min(20, this.health + deltaTime * 1.1);
    }

    if (this.player.headSubmerged) {
      this.air = Math.max(0, this.air - deltaTime * 2);
      if (this.air <= 0) {
        this.drownTimer += deltaTime;
        if (this.drownTimer >= 0.5) {
          this.drownTimer = 0;
          this.hurt(2, 'You drowned.');
        }
      }
    } else {
      this.air = Math.min(20, this.air + deltaTime * 9);
      this.drownTimer = 0;
    }

    if (this.player.inLava) {
      this.lavaTimer += deltaTime;
      if (this.lavaTimer >= 0.4) {
        this.lavaTimer = 0;
        this.hurt(4, 'You burned in lava.');
      }
    } else this.lavaTimer = 0;

    if (this.player.touchingCactus) {
      this.cactusTimer += deltaTime;
      if (this.cactusTimer >= 0.5) {
        this.cactusTimer = 0;
        this.hurt(2, 'A cactus got you.');
      }
    } else this.cactusTimer = 0;

    if (this.player.fallImpact > 0) {
      const cause = this.player.fallImpact >= 30 ? 'You fell out of the world.' : 'You fell from a high place.';
      this.hurt(Math.ceil(this.player.fallImpact), cause);
    }

    this.ui.setOverlays(this.player.headSubmerged, this.player.inLava);
    if (this.scene.fog instanceof THREE.Fog) {
      if (this.player.inLava) {
        this.scene.fog.color.set(0x7a1d08);
        this.scene.fog.near = 1;
        this.scene.fog.far = 9;
      } else if (this.player.headSubmerged) {
        this.scene.fog.color.set(0x163a58);
        this.scene.fog.near = 2;
        this.scene.fog.far = 16;
      } else {
        this.scene.fog.near = 38;
        this.scene.fog.far = 105;
      }
    }
  }

  private hurt(amount: number, cause: string): void {
    if (this.mode === 'creative' || this.dead || amount <= 0 || this.invulnerable > 0) return;
    this.health -= amount;
    this.invulnerable = 0.55;
    this.ui.flashDamage();
    this.playTone(180, 0.16, 'square', 0.09);
    if (this.health > 0) return;
    this.health = 0;
    this.die(cause);
  }

  private die(cause: string): void {
    this.dead = true;
    this.deathCause = cause;
    this.mining = false;
    this.craftingOpen = false;
    this.player.flying = false;
    document.exitPointerLock();
    this.ui.showDeath(cause);
    this.playTone(90, 0.4, 'sawtooth', 0.08);
  }

  private respawn(): void {
    this.dead = false;
    this.health = 20;
    this.energy = 16;
    this.air = 20;
    this.invulnerable = 1.2;
    this.player.teleport(this.player.getSpawn());
    this.started = true;
    this.resumeAudio();
    this.ui.showPlaying();
    this.player.requestPointerLock();
    this.savePlayer();
  }

  private syncHotbar(): void {
    this.ui.refreshHotbar(this.inventory.slots, this.inventory.selectedIndex, this.mode === 'survival');
    this.syncHeldItem();
    if (this.craftingOpen) this.refreshCraftUI();
  }

  private spawnItem(
    x: number,
    y: number,
    z: number,
    block: Block,
    velocity?: THREE.Vector3,
    count = 1,
    durability?: number,
  ): void {
    for (let index = 0; index < count; index += 1) {
      if (this.items.length > 48) {
        const oldest = this.items.shift();
        if (oldest) this.itemGroup.remove(oldest.mesh);
      }
      let material = this.itemMaterials.get(block);
      if (!material) {
        material = new THREE.MeshBasicMaterial({ color: BLOCKS[block].iconColor });
        this.itemMaterials.set(block, material);
      }
      const mesh = new THREE.Mesh(this.itemGeometry, material);
      mesh.position.set(x, y, z);
      this.itemGroup.add(mesh);
      this.items.push({
        block,
        mesh,
        velocity: velocity?.clone() ?? new THREE.Vector3((Math.random() - 0.5) * 2.4, 3.4 + Math.random(), (Math.random() - 0.5) * 2.4),
        age: 0,
        durability,
      });
    }
  }

  private updateItems(deltaTime: number): void {
    const magnet = this.player.position.clone();
    magnet.y += 0.9;
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      const item = this.items[index];
      item.age += deltaTime;
      item.velocity.y -= 16 * deltaTime;
      item.mesh.position.addScaledVector(item.velocity, deltaTime);
      item.mesh.rotation.y += deltaTime * 2.4;
      const blockX = Math.floor(item.mesh.position.x);
      const blockY = Math.floor(item.mesh.position.y);
      const blockZ = Math.floor(item.mesh.position.z);
      if (isSolid(this.world.getBlock(blockX, blockY, blockZ))) {
        item.mesh.position.y = blockY + 1.08;
        item.velocity.set(0, 0, 0);
      }
      const offset = magnet.clone().sub(item.mesh.position);
      const distance = offset.length();
      if (item.age > 0.45 && distance < 2.4) {
        item.mesh.position.addScaledVector(offset.normalize(), deltaTime * 11);
      }
      if (item.age > 0.4 && distance < 1.15 && !this.dead) {
        const leftover = this.mode === 'creative' ? 0 : this.inventory.add(item.block, 1, item.durability);
        if (leftover === 0) {
          this.itemGroup.remove(item.mesh);
          this.items.splice(index, 1);
          this.playTone(880, 0.05, 'sine', 0.05);
          this.syncHotbar();
        }
      } else if (item.age > 90) {
        this.itemGroup.remove(item.mesh);
        this.items.splice(index, 1);
      }
    }
  }

  private updateFootsteps(): void {
    if (!this.player.onGround) return;
    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    if (speed < 1.4) return;
    const sample = Math.sin(this.player.bobTime);
    if (this.lastBobSin <= 0 && sample > 0) this.playBlockSound(0.38);
    this.lastBobSin = sample;
  }

  private updateLights(): void {
    const origin = this.player.position.clone();
    origin.y += 1.2;
    const torches = this.world.nearestTorches(origin, this.torchLights.length);
    this.torchLights.forEach((light, index) => {
      const position = torches[index];
      if (!position) {
        light.intensity = 0;
        return;
      }
      light.position.copy(position);
      light.intensity = 2.35;
    });
    this.handLight.intensity = this.inventory.selectedBlock === Block.Torch && this.player.pointerLocked ? 1.7 : 0;
    this.handLight.position.set(0.2, -0.1, -0.4);
  }

  private stopRepeatingAction(): void {
    if (this.actionTimer === undefined) return;
    window.clearInterval(this.actionTimer);
    this.actionTimer = undefined;
  }

  private configureSunShadows(): void {
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -42;
    this.sun.shadow.camera.right = 42;
    this.sun.shadow.camera.top = 42;
    this.sun.shadow.camera.bottom = -42;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 135;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.035;
    this.sun.target = this.sunTarget;
  }

  private updateDayNight(deltaTime: number): void {
    this.dayTime = (this.dayTime + deltaTime / 260) % 1;
    const angle = this.dayTime * Math.PI * 2;
    const direction = new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0.38).normalize();
    const focus = this.player.position;
    this.sun.position.copy(focus).addScaledVector(direction, 85);
    this.sunTarget.position.set(focus.x, 0, focus.z);
    this.sunTarget.updateMatrixWorld();
    this.sunMesh.position.copy(focus).addScaledVector(direction, 90);
    this.moonMesh.position.copy(focus).addScaledVector(direction, -90);

    this.daylight = THREE.MathUtils.clamp((direction.y + 0.15) / 0.62, 0.06, 1);
    const horizon = 1 - THREE.MathUtils.clamp(Math.abs(direction.y) * 5, 0, 1);
    const nightColor = new THREE.Color(0x07111f);
    const dayColor = new THREE.Color(0x86cdf5);
    const sunsetColor = new THREE.Color(0xf3a16b);
    const skyColor = nightColor.clone().lerp(dayColor, this.daylight).lerp(sunsetColor, horizon * this.daylight * 0.42);
    this.scene.background = skyColor;
    if (this.scene.fog && !this.player.headSubmerged && !this.player.inLava) this.scene.fog.color.copy(skyColor);
    this.hemisphereLight.intensity = 0.28 + this.daylight * 1.28;
    this.hemisphereLight.color.set(this.daylight > 0.25 ? 0xaedcff : 0x55658e);
    this.sun.intensity = this.daylight * 2.35;
    this.sun.color.set(horizon > 0.4 ? 0xffc08a : 0xfff2d2);
    (this.stars.material as THREE.PointsMaterial).opacity = THREE.MathUtils.clamp(1 - this.daylight * 1.8, 0, 0.85);
    this.stars.position.set(focus.x, 0, focus.z);
    this.sunMesh.visible = this.daylight > 0.12;
    this.moonMesh.visible = this.daylight < 0.55;
    const cloudMaterial = (this.cloudGroup.children[0] as THREE.Mesh | undefined)?.material;
    if (cloudMaterial instanceof THREE.MeshLambertMaterial) {
      cloudMaterial.opacity = 0.28 + this.daylight * 0.44;
    }
  }

  private createStars(): THREE.Points {
    const positions: number[] = [];
    let state = (this.seed ^ 0x7f4a7c15) >>> 0;
    const random = (): number => {
      state = Math.imul(state ^ (state >>> 15), 1 | state);
      state ^= state + Math.imul(state ^ (state >>> 7), 61 | state);
      return ((state ^ (state >>> 14)) >>> 0) / 4294967296;
    };
    for (let index = 0; index < 420; index += 1) {
      const theta = random() * Math.PI * 2;
      const phi = random() * Math.PI * 0.45 + 0.08;
      const radius = 112;
      positions.push(
        Math.cos(theta) * Math.cos(phi) * radius,
        Math.sin(phi) * radius + 10,
        Math.sin(theta) * Math.cos(phi) * radius,
      );
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xf2f5ff,
      size: 0.72,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
    });
    const points = new THREE.Points(geometry, material);
    points.name = 'Stars';
    return points;
  }

  private createClouds(): void {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshLambertMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    });
    let state = (this.seed + 0x1234abcd) >>> 0;
    const random = (): number => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
    for (let index = 0; index < 24; index += 1) {
      const cloud = new THREE.Mesh(geometry, material);
      cloud.position.set((random() - 0.5) * 150, 47 + random() * 6, (random() - 0.5) * 150);
      cloud.scale.set(7 + random() * 12, 1.2 + random() * 1.1, 3 + random() * 6);
      cloud.castShadow = false;
      cloud.receiveShadow = false;
      this.cloudGroup.add(cloud);
    }
  }

  private updateClouds(deltaTime: number): void {
    const centerX = this.player.position.x;
    const centerZ = this.player.position.z;
    for (const cloud of this.cloudGroup.children) {
      cloud.position.x += deltaTime * 0.75;
      if (cloud.position.x > centerX + 90) cloud.position.x = centerX - 90;
      if (cloud.position.z > centerZ + 90) cloud.position.z = centerZ - 90;
      if (cloud.position.z < centerZ - 90) cloud.position.z = centerZ + 90;
    }
  }

  private createHeldItem(): void {
    this.heldItem = new THREE.Group();
    this.heldCube = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.28, 0.28),
      new THREE.MeshBasicMaterial({ color: BLOCKS[Block.Planks].iconColor }),
    );
    this.heldTool = new THREE.Group();
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.045, 0.4, 0.045),
      new THREE.MeshBasicMaterial({ color: 0x6b4423 }),
    );
    handle.position.y = -0.08;
    this.heldToolHead = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.08, 0.08),
      new THREE.MeshBasicMaterial({ color: 0xc09358 }),
    );
    this.heldToolHead.position.set(0.05, 0.14, 0);
    this.heldTool.add(handle, this.heldToolHead);
    this.heldTool.visible = false;
    this.heldItem.add(this.heldCube, this.heldTool);
    this.heldItem.position.set(0.48, -0.39, -0.72);
    this.heldItem.rotation.set(-0.28, -0.55, 0.1);
    this.heldItem.visible = false;
    this.camera.add(this.heldItem);
  }

  private syncHeldItem(): void {
    const selected = this.inventory.selectedBlock;
    this.heldItem.visible = this.player.pointerLocked && selected !== undefined;
    if (selected === undefined) return;
    const tool = itemToolType(selected);
    this.heldCube.visible = !tool;
    this.heldTool.visible = Boolean(tool);
    if (tool) {
      (this.heldToolHead.material as THREE.MeshBasicMaterial).color.set(BLOCKS[selected].iconColor);
      this.heldToolHead.scale.set(
        tool === 'sword' ? 0.7 : tool === 'shovel' ? 0.7 : 1,
        tool === 'sword' ? 2.4 : 1,
        tool === 'pickaxe' ? 1.6 : 1,
      );
      this.heldToolHead.position.set(tool === 'sword' ? 0 : 0.05, tool === 'sword' ? 0.18 : 0.14, 0);
    } else {
      (this.heldCube.material as THREE.MeshBasicMaterial).color.set(BLOCKS[selected].iconColor);
    }
  }

  private updateViewModel(deltaTime: number): void {
    if (!this.heldItem) return;
    this.heldItem.visible = this.player.pointerLocked && this.inventory.selectedBlock !== undefined;
    this.swing = Math.max(0, this.swing - deltaTime * 5.5);
    const swingCurve = Math.sin(this.swing * Math.PI);
    const speed = Math.hypot(this.player.velocity.x, this.player.velocity.z);
    const walk = performance.now() * 0.008;
    this.heldItem.position.x = 0.48 + Math.sin(walk) * 0.012 * Math.min(speed, 1);
    this.heldItem.position.y = -0.39 - swingCurve * 0.17 + Math.abs(Math.cos(walk)) * 0.009 * Math.min(speed, 1);
    this.heldItem.rotation.z = 0.1 + swingCurve * 0.85;
  }

  private spawnParticles(x: number, y: number, z: number, block: Block): void {
    let material = this.particleMaterials.get(block);
    if (!material) {
      material = new THREE.MeshBasicMaterial({ color: BLOCKS[block].iconColor });
      this.particleMaterials.set(block, material);
    }
    for (let index = 0; index < 9; index += 1) {
      const mesh = new THREE.Mesh(this.particleGeometry, material);
      mesh.position.set(x + Math.random(), y + Math.random(), z + Math.random());
      const scale = 0.65 + Math.random() * 0.75;
      mesh.scale.setScalar(scale);
      this.particleGroup.add(mesh);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3((Math.random() - 0.5) * 3.2, 1.4 + Math.random() * 2.8, (Math.random() - 0.5) * 3.2),
        life: 0.45 + Math.random() * 0.35,
      });
    }
  }

  private updateParticles(deltaTime: number): void {
    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.life -= deltaTime;
      particle.velocity.y -= 9 * deltaTime;
      particle.mesh.position.addScaledVector(particle.velocity, deltaTime);
      particle.mesh.rotation.x += deltaTime * 4;
      particle.mesh.rotation.y += deltaTime * 5;
      particle.mesh.scale.multiplyScalar(Math.max(0.7, 1 - deltaTime * 1.8));
      if (particle.life > 0) continue;
      this.particleGroup.remove(particle.mesh);
      this.particles.splice(index, 1);
    }
  }

  private resumeAudio(): void {
    if (!this.audioContext) this.audioContext = new AudioContext();
    if (this.audioContext.state === 'suspended') void this.audioContext.resume();
  }

  private playBlockSound(pitch: number): void {
    if (!this.audioContext || this.audioContext.state !== 'running') return;
    const context = this.audioContext;
    const duration = 0.075;
    const frameCount = Math.floor(context.sampleRate * duration);
    const buffer = context.createBuffer(1, frameCount, context.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      const envelope = 1 - index / frameCount;
      channel[index] = (Math.random() * 2 - 1) * envelope;
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = pitch;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700 * pitch;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.13, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
  }

  private playTone(frequency: number, duration: number, type: OscillatorType, volume: number): void {
    if (!this.audioContext || this.audioContext.state !== 'running') return;
    const context = this.audioContext;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, context.currentTime);
    gain.gain.setValueAtTime(volume, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + duration);
  }

  private savePlayer(): void {
    if (!this.player) return;
    const payload: PlayerSave = {
      mode: this.mode,
      health: this.health,
      energy: this.energy,
      air: this.air,
      x: this.player.position.x,
      y: this.player.position.y,
      z: this.player.position.z,
      yaw: this.player.lookYaw,
      pitch: this.player.lookPitch,
      flying: this.player.flying,
      inventory: this.inventory.serialize(),
    };
    try {
      localStorage.setItem(playerSaveKey(this.seed), JSON.stringify(payload));
    } catch (error) {
      console.warn('Could not save player', error);
    }
  }

  private loadPlayer(): void {
    try {
      const serialized = localStorage.getItem(playerSaveKey(this.seed));
      if (!serialized) {
        this.mode = 'survival';
        this.player.allowFlight = false;
        return;
      }
      const save = JSON.parse(serialized) as PlayerSave;
      this.mode = save.mode === 'creative' ? 'creative' : 'survival';
      this.health = THREE.MathUtils.clamp(save.health ?? 20, 1, 20);
      this.energy = THREE.MathUtils.clamp(save.energy ?? 20, 0, 20);
      this.air = THREE.MathUtils.clamp(save.air ?? 20, 0, 20);
      this.player.allowFlight = this.mode === 'creative';
      this.player.flying = this.mode === 'creative' && Boolean(save.flying);
      this.player.lookAt(save.yaw ?? 0, save.pitch ?? 0);
      if (Number.isFinite(save.x) && Number.isFinite(save.y) && Number.isFinite(save.z)) {
        this.player.teleport(new THREE.Vector3(save.x, save.y, save.z));
      }
      if (save.inventory) this.inventory.load(save.inventory);
    } catch (error) {
      console.warn('Could not load player', error);
    }
  }

  private resize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  }
}
