import * as THREE from 'three';

export enum Block {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Sand = 4,
  Wood = 5,
  Leaves = 6,
  Planks = 7,
  Brick = 8,
  Glass = 9,
  Water = 10,
  Bedrock = 11,
  CoalOre = 12,
  IronOre = 13,
  Snow = 14,
  Cobblestone = 15,
  Gravel = 16,
  Cactus = 17,
  Lava = 18,
  TallGrass = 19,
  Flower = 20,
  Torch = 21,
  CraftingTable = 22,
  Stick = 23,
  WoodenPickaxe = 24,
  WoodenAxe = 25,
  WoodenShovel = 26,
  WoodenSword = 27,
  StonePickaxe = 28,
  StoneAxe = 29,
  StoneShovel = 30,
  StoneSword = 31,
}

export type BlockFace = 'top' | 'bottom' | 'side';
export type BlockShape = 'cube' | 'cross';
export type ToolType = 'pickaxe' | 'axe' | 'shovel' | 'sword';
export type ToolTier = 'wood' | 'stone';

type BlockDefinition = {
  name: string;
  iconColor: string;
  solid: boolean;
  transparent: boolean;
  breakable: boolean;
  fluid: boolean;
  hardness: number;
  drops: Block | null;
  shape: BlockShape;
  textures: Record<BlockFace, number>;
  world: boolean;
  maxStack: number;
  harvest?: ToolType;
  harvestTier?: number;
  toolType?: ToolType;
  toolTier?: ToolTier;
  toolSpeed?: number;
  toolDamage?: number;
  durability?: number;
};

const tile = (all: number): Record<BlockFace, number> => ({ top: all, bottom: all, side: all });

const cube = (
  name: string,
  iconColor: string,
  textures: Record<BlockFace, number>,
  extras: Partial<Omit<BlockDefinition, 'name' | 'iconColor' | 'textures'>> = {},
): BlockDefinition => ({
  name,
  iconColor,
  solid: true,
  transparent: false,
  breakable: true,
  fluid: false,
  hardness: 0.4,
  drops: null,
  shape: 'cube',
  textures,
  world: true,
  maxStack: 64,
  ...extras,
});

const held = (
  name: string,
  iconColor: string,
  extras: Partial<Omit<BlockDefinition, 'name' | 'iconColor' | 'textures'>> = {},
): BlockDefinition => cube(name, iconColor, tile(0), {
  solid: false,
  transparent: true,
  breakable: false,
  world: false,
  hardness: 0,
  drops: null,
  ...extras,
});

const tool = (
  name: string,
  iconColor: string,
  type: ToolType,
  tier: ToolTier,
  speed: number,
  damage: number,
  durability: number,
): BlockDefinition => held(name, iconColor, {
  maxStack: 1,
  toolType: type,
  toolTier: tier,
  toolSpeed: speed,
  toolDamage: damage,
  durability,
});

export const BLOCKS: Record<Block, BlockDefinition> = {
  [Block.Air]: cube('Air', '#000000', tile(0), {
    solid: false, transparent: true, breakable: false, hardness: 0, drops: null,
  }),
  [Block.Grass]: cube('Grass Block', '#69a93f', { top: 0, bottom: 2, side: 1 }, {
    hardness: 0.32, drops: Block.Dirt, harvest: 'shovel',
  }),
  [Block.Dirt]: cube('Dirt', '#8c603b', tile(2), { hardness: 0.28, drops: Block.Dirt, harvest: 'shovel' }),
  [Block.Stone]: cube('Stone', '#85898a', tile(3), { hardness: 0.9, drops: Block.Cobblestone, harvest: 'pickaxe' }),
  [Block.Sand]: cube('Sand', '#d9c57d', tile(4), { hardness: 0.28, drops: Block.Sand, harvest: 'shovel' }),
  [Block.Wood]: cube('Oak Log', '#8b673d', { top: 6, bottom: 6, side: 5 }, { hardness: 0.48, drops: Block.Wood, harvest: 'axe' }),
  [Block.Leaves]: cube('Oak Leaves', '#397b35', tile(7), {
    transparent: true, hardness: 0.16, drops: null, harvest: 'axe',
  }),
  [Block.Planks]: cube('Oak Planks', '#b88950', tile(8), { hardness: 0.38, drops: Block.Planks, harvest: 'axe' }),
  [Block.Brick]: cube('Bricks', '#a44d3e', tile(9), { hardness: 0.85, drops: Block.Brick, harvest: 'pickaxe' }),
  [Block.Glass]: cube('Glass', '#a9d7df', tile(10), {
    transparent: true, hardness: 0.22, drops: Block.Glass,
  }),
  [Block.Water]: cube('Water', '#3c83c9', tile(11), {
    solid: false, transparent: true, breakable: false, fluid: true, hardness: 99, drops: null,
  }),
  [Block.Bedrock]: cube('Bedrock', '#343739', tile(12), { breakable: false, hardness: 99, drops: null }),
  [Block.CoalOre]: cube('Coal Ore', '#55595b', tile(13), { hardness: 1.05, drops: Block.CoalOre, harvest: 'pickaxe' }),
  [Block.IronOre]: cube('Iron Ore', '#9a8476', tile(14), {
    hardness: 1.2, drops: Block.IronOre, harvest: 'pickaxe', harvestTier: 1,
  }),
  [Block.Snow]: cube('Snowy Grass', '#e6f0ee', { top: 15, bottom: 2, side: 16 }, {
    hardness: 0.3, drops: Block.Dirt, harvest: 'shovel',
  }),
  [Block.Cobblestone]: cube('Cobblestone', '#7a7d7f', tile(17), {
    hardness: 0.85, drops: Block.Cobblestone, harvest: 'pickaxe',
  }),
  [Block.Gravel]: cube('Gravel', '#8a8175', tile(18), { hardness: 0.3, drops: Block.Gravel, harvest: 'shovel' }),
  [Block.Cactus]: cube('Cactus', '#3e8f46', tile(19), { hardness: 0.32, drops: Block.Cactus, harvest: 'axe' }),
  [Block.Lava]: cube('Lava', '#e05a12', tile(20), {
    solid: false, transparent: true, breakable: false, fluid: true, hardness: 99, drops: null,
  }),
  [Block.TallGrass]: cube('Tall Grass', '#5ea63d', tile(21), {
    solid: false, transparent: true, hardness: 0.05, drops: null, shape: 'cross',
  }),
  [Block.Flower]: cube('Poppy', '#d23c3c', tile(22), {
    solid: false, transparent: true, hardness: 0.05, drops: Block.Flower, shape: 'cross',
  }),
  [Block.Torch]: cube('Torch', '#f0c14a', tile(23), {
    solid: false, transparent: true, hardness: 0.05, drops: Block.Torch, shape: 'cross',
  }),
  [Block.CraftingTable]: cube('Crafting Table', '#8b5a2b', { top: 24, bottom: 8, side: 25 }, {
    hardness: 0.42, drops: Block.CraftingTable, harvest: 'axe',
  }),
  [Block.Stick]: held('Stick', '#b08958'),
  [Block.WoodenPickaxe]: tool('Wooden Pickaxe', '#c4a36a', 'pickaxe', 'wood', 2.5, 2, 60),
  [Block.WoodenAxe]: tool('Wooden Axe', '#c09358', 'axe', 'wood', 2.5, 3, 60),
  [Block.WoodenShovel]: tool('Wooden Shovel', '#d2b27a', 'shovel', 'wood', 2.5, 2, 60),
  [Block.WoodenSword]: tool('Wooden Sword', '#e0c48a', 'sword', 'wood', 1.4, 4, 60),
  [Block.StonePickaxe]: tool('Stone Pickaxe', '#8a8e90', 'pickaxe', 'stone', 4, 3, 132),
  [Block.StoneAxe]: tool('Stone Axe', '#7d8184', 'axe', 'stone', 4, 4, 132),
  [Block.StoneShovel]: tool('Stone Shovel', '#9aa0a3', 'shovel', 'stone', 4, 2, 132),
  [Block.StoneSword]: tool('Stone Sword', '#b8bcbd', 'sword', 'stone', 1.4, 5, 132),
};

export const PLACEABLE_BLOCKS: Block[] = [
  Block.Grass,
  Block.Dirt,
  Block.Stone,
  Block.Cobblestone,
  Block.Sand,
  Block.Wood,
  Block.Planks,
  Block.Brick,
  Block.Glass,
  Block.CraftingTable,
];

export const HOTBAR_SIZE = 9;
export const MAX_STACK = 64;

const TIER_RANK: Record<ToolTier, number> = { wood: 0, stone: 1 };

export const isKnownBlock = (block: number): block is Block => (
  Number.isInteger(block) && Object.hasOwn(BLOCKS, block)
);
export const isSolid = (block: Block): boolean => BLOCKS[block]?.solid === true;
export const isTransparent = (block: Block): boolean => BLOCKS[block]?.transparent === true;
export const isBreakable = (block: Block): boolean => BLOCKS[block]?.breakable === true;
export const isFluid = (block: Block): boolean => BLOCKS[block]?.fluid === true;
export const isCrossShape = (block: Block): boolean => BLOCKS[block]?.shape === 'cross';
export const isWorldBlock = (block: Block): boolean => Boolean(BLOCKS[block]?.world);
export const isPlaceable = (block: Block): boolean => (
  BLOCKS[block].world && block !== Block.Air && !BLOCKS[block].fluid && block !== Block.Bedrock
);
export const isTool = (block: Block): boolean => BLOCKS[block].toolType !== undefined;
export const blockName = (block: Block): string => BLOCKS[block].name;
export const blockHardness = (block: Block): number => BLOCKS[block].hardness;
export const blockDrop = (block: Block): Block | null => BLOCKS[block].drops;
export const itemMaxStack = (block: Block): number => BLOCKS[block].maxStack;
export const itemDurability = (block: Block): number | undefined => BLOCKS[block].durability;
export const itemToolType = (block: Block): ToolType | undefined => BLOCKS[block].toolType;
export const isReplaceable = (block: Block): boolean =>
  block === Block.Air || block === Block.Water || block === Block.TallGrass || block === Block.Flower || block === Block.Torch;

export const canHarvest = (held: Block | undefined, target: Block): boolean => {
  const need = BLOCKS[target].harvest;
  if (need !== 'pickaxe') return true;
  const tool = held === undefined ? undefined : BLOCKS[held];
  if (!tool?.toolType || tool.toolType !== 'pickaxe' || !tool.toolTier) return false;
  return TIER_RANK[tool.toolTier] >= (BLOCKS[target].harvestTier ?? 0);
};

export const mineMultiplier = (held: Block | undefined, target: Block): number => {
  const need = BLOCKS[target].harvest;
  const tool = held === undefined ? undefined : BLOCKS[held];
  if (!need) return tool?.toolType === 'sword' ? 1.35 : 1;
  if (tool?.toolType === need) return tool.toolSpeed ?? 1;
  return 0.32;
};

export const attackDamage = (held: Block | undefined): number => {
  const tool = held === undefined ? undefined : BLOCKS[held];
  return tool?.toolDamage ?? 1;
};

export const ATLAS_COLUMNS = 4;
export const ATLAS_ROWS = 7;
const TILE_SIZE = 16;

const hexToRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace('#', '');
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
};

const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const paintNoiseTile = (
  context: CanvasRenderingContext2D,
  index: number,
  colors: string[],
  seed: number,
): void => {
  const random = seededRandom(seed);
  const offsetX = (index % ATLAS_COLUMNS) * TILE_SIZE;
  const offsetY = Math.floor(index / ATLAS_COLUMNS) * TILE_SIZE;
  const palette = colors.map(hexToRgb);
  const image = context.createImageData(TILE_SIZE, TILE_SIZE);

  for (let pixel = 0; pixel < TILE_SIZE * TILE_SIZE; pixel += 1) {
    const color = palette[Math.floor(random() * palette.length)];
    const target = pixel * 4;
    image.data[target] = color[0];
    image.data[target + 1] = color[1];
    image.data[target + 2] = color[2];
    image.data[target + 3] = 255;
  }
  context.putImageData(image, offsetX, offsetY);
};

const tileOrigin = (index: number): [number, number] => [
  (index % ATLAS_COLUMNS) * TILE_SIZE,
  Math.floor(index / ATLAS_COLUMNS) * TILE_SIZE,
];

const clearTile = (context: CanvasRenderingContext2D, index: number): [number, number] => {
  const [x, y] = tileOrigin(index);
  context.clearRect(x, y, TILE_SIZE, TILE_SIZE);
  return [x, y];
};

export function createBlockAtlas(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_COLUMNS * TILE_SIZE;
  canvas.height = ATLAS_ROWS * TILE_SIZE;
  const context = canvas.getContext('2d', { alpha: true });
  if (!context) throw new Error('Could not create texture atlas');
  context.imageSmoothingEnabled = false;

  const stripe = (index: number, color: string, horizontal: boolean, step = 5, start = 3): void => {
    const [x, y] = tileOrigin(index);
    context.fillStyle = color;
    if (horizontal) {
      for (let row = start; row < TILE_SIZE; row += step) context.fillRect(x, y + row, TILE_SIZE, 1);
    } else {
      for (let column = start; column < TILE_SIZE; column += step) context.fillRect(x + column, y, 1, TILE_SIZE);
    }
  };

  paintNoiseTile(context, 0, ['#5f9f39', '#6aac40', '#4d8b31', '#7bb84a'], 1);
  paintNoiseTile(context, 1, ['#815635', '#8e603b', '#765030', '#986740'], 2);
  const [grassX, grassY] = tileOrigin(1);
  const grassRandom = seededRandom(20);
  for (let column = 0; column < TILE_SIZE; column += 1) {
    const height = 3 + Math.floor(grassRandom() * 3);
    context.fillStyle = grassRandom() > 0.5 ? '#619f39' : '#74ae43';
    context.fillRect(grassX + column, grassY, 1, height);
  }
  paintNoiseTile(context, 2, ['#815635', '#8e603b', '#765030', '#986740'], 3);
  paintNoiseTile(context, 3, ['#7f8383', '#8b8e8e', '#6f7475', '#999b98'], 4);
  paintNoiseTile(context, 4, ['#d8c77f', '#e2d08a', '#cdbc75', '#ead994'], 5);
  paintNoiseTile(context, 5, ['#89653b', '#78562f', '#9a7446', '#6b4b29'], 6);
  stripe(5, 'rgba(66, 43, 23, 0.38)', false, 5, 2);
  paintNoiseTile(context, 6, ['#aa8250', '#9c7445', '#b58d5a'], 7);
  const [logX, logY] = tileOrigin(6);
  context.strokeStyle = '#75512e';
  context.lineWidth = 1;
  context.strokeRect(logX + 3.5, logY + 3.5, 9, 9);
  context.strokeRect(logX + 6.5, logY + 6.5, 3, 3);
  paintNoiseTile(context, 7, ['#367533', '#43843a', '#2d682e', '#4b9140'], 8);
  const [leafX, leafY] = tileOrigin(7);
  context.clearRect(leafX + 2, leafY + 3, 2, 2);
  context.clearRect(leafX + 11, leafY + 2, 2, 2);
  context.clearRect(leafX + 6, leafY + 10, 2, 2);
  context.clearRect(leafX + 13, leafY + 12, 1, 2);
  paintNoiseTile(context, 8, ['#b7864c', '#c09358', '#a97843', '#c99a5d'], 9);
  stripe(8, '#76502c', true, 5, 3);
  const [plankX, plankY] = tileOrigin(8);
  context.fillStyle = '#76502c';
  context.fillRect(plankX + 5, plankY, 1, 3);
  context.fillRect(plankX + 11, plankY + 4, 1, 4);
  context.fillRect(plankX + 7, plankY + 9, 1, 5);
  paintNoiseTile(context, 9, ['#a94f3f', '#994438', '#b75c49', '#8c3f35'], 10);
  stripe(9, '#d0a18c', true, 5, 4);
  const [glassX, glassY] = clearTile(context, 10);
  context.fillStyle = 'rgba(183, 225, 233, 0.38)';
  context.fillRect(glassX, glassY, TILE_SIZE, TILE_SIZE);
  context.fillStyle = '#d8f4f3';
  context.fillRect(glassX, glassY, TILE_SIZE, 2);
  context.fillRect(glassX, glassY, 2, TILE_SIZE);
  context.fillStyle = '#8abfc9';
  context.fillRect(glassX + 14, glassY, 2, TILE_SIZE);
  context.fillRect(glassX, glassY + 14, TILE_SIZE, 2);
  context.fillStyle = 'rgba(255,255,255,0.75)';
  context.fillRect(glassX + 4, glassY + 4, 5, 1);
  context.fillRect(glassX + 4, glassY + 5, 1, 4);
  paintNoiseTile(context, 11, ['#347dbe', '#3d87ca', '#2e72b3', '#4a91d0'], 11);
  const [waterX, waterY] = tileOrigin(11);
  context.fillStyle = 'rgba(147, 207, 239, 0.45)';
  context.fillRect(waterX + 1, waterY + 3, 7, 1);
  context.fillRect(waterX + 9, waterY + 10, 6, 1);
  paintNoiseTile(context, 12, ['#323638', '#494c4e', '#25292b', '#5a5b5b'], 12);
  paintNoiseTile(context, 13, ['#777b7b', '#828686', '#292d2e', '#383b3c'], 13);
  paintNoiseTile(context, 14, ['#7d7f7d', '#8a8b88', '#a47458', '#b48362'], 14);
  paintNoiseTile(context, 15, ['#eff7f5', '#dce9e8', '#f8ffff', '#cbdedc'], 15);
  paintNoiseTile(context, 16, ['#815635', '#8e603b', '#765030', '#986740'], 16);
  const [snowX, snowY] = tileOrigin(16);
  context.fillStyle = '#edf6f4';
  context.fillRect(snowX, snowY, TILE_SIZE, 4);
  context.fillStyle = '#d9e9e7';
  context.fillRect(snowX + 5, snowY + 4, 4, 1);
  context.fillRect(snowX + 12, snowY + 4, 2, 1);
  paintNoiseTile(context, 17, ['#6f7274', '#838688', '#5c6062', '#9a9c9d'], 17);
  stripe(17, '#4f5355', true, 4, 2);
  stripe(17, '#b0b3b4', false, 7, 1);
  paintNoiseTile(context, 18, ['#8a8175', '#9a9082', '#746c62', '#b0a696'], 18);
  paintNoiseTile(context, 19, ['#3e8f46', '#2f7a38', '#4ea356', '#24662c'], 19);
  stripe(19, 'rgba(18, 70, 28, 0.45)', false, 6, 3);
  paintNoiseTile(context, 20, ['#e05a12', '#ff7a18', '#c43a08', '#ffcc33'], 21);
  const [lavaX, lavaY] = tileOrigin(20);
  context.fillStyle = 'rgba(255, 220, 80, 0.55)';
  context.fillRect(lavaX + 2, lavaY + 4, 5, 2);
  context.fillRect(lavaX + 9, lavaY + 10, 4, 2);
  const [grassCrossX, grassCrossY] = clearTile(context, 21);
  context.fillStyle = '#5ea63d';
  context.fillRect(grassCrossX + 7, grassCrossY + 3, 2, 13);
  context.fillRect(grassCrossX + 4, grassCrossY + 6, 8, 2);
  context.fillRect(grassCrossX + 3, grassCrossY + 2, 2, 5);
  context.fillRect(grassCrossX + 11, grassCrossY + 4, 2, 6);
  const [flowerX, flowerY] = clearTile(context, 22);
  context.fillStyle = '#3f7a32';
  context.fillRect(flowerX + 7, flowerY + 7, 2, 9);
  context.fillStyle = '#d23c3c';
  context.fillRect(flowerX + 5, flowerY + 3, 6, 6);
  context.fillStyle = '#f0d24a';
  context.fillRect(flowerX + 7, flowerY + 5, 2, 2);
  const [torchX, torchY] = clearTile(context, 23);
  context.fillStyle = '#8b673d';
  context.fillRect(torchX + 7, torchY + 6, 2, 10);
  context.fillStyle = '#f0c14a';
  context.fillRect(torchX + 6, torchY + 2, 4, 5);
  context.fillStyle = '#fff3ad';
  context.fillRect(torchX + 7, torchY + 3, 2, 2);
  paintNoiseTile(context, 24, ['#b7864c', '#c09358', '#a97843', '#c99a5d'], 24);
  const [tableX, tableY] = tileOrigin(24);
  context.fillStyle = '#6d4a28';
  context.fillRect(tableX + 1, tableY + 1, 14, 14);
  context.fillStyle = '#d2ae72';
  context.fillRect(tableX + 3, tableY + 3, 10, 10);
  context.strokeStyle = '#5a3b1c';
  context.strokeRect(tableX + 3.5, tableY + 3.5, 9, 9);
  paintNoiseTile(context, 25, ['#b7864c', '#8b5a2b', '#c09358', '#6d4a28'], 25);
  stripe(25, '#5a3b1c', true, 4, 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.needsUpdate = true;
  return texture;
}

export function textureForFace(block: Block, face: BlockFace): number {
  return BLOCKS[block]?.textures[face] ?? 3;
}

export function atlasUV(tile: number, inset = 0.015): { u0: number; u1: number; v0: number; v1: number } {
  const column = tile % ATLAS_COLUMNS;
  const row = Math.floor(tile / ATLAS_COLUMNS);
  return {
    u0: (column + inset) / ATLAS_COLUMNS,
    u1: (column + 1 - inset) / ATLAS_COLUMNS,
    v0: 1 - (row + 1 - inset) / ATLAS_ROWS,
    v1: 1 - (row + inset) / ATLAS_ROWS,
  };
}
