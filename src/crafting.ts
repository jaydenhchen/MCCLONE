import { Block, blockName, isTool, itemMaxStack } from './blocks';
import type { ItemStack } from './inventory';

export type Recipe = {
  id: string;
  name: string;
  table: boolean;
  shapeless?: Array<{ item: Block; count: number }>;
  pattern?: string[];
  keys?: Record<string, Block>;
  result: Block;
  count: number;
};

const wood = 'wood';
const stone = 'stone';

const toolSet = (tier: typeof wood | typeof stone, material: Block): Recipe[] => {
  const label = tier === wood ? 'Wooden' : 'Stone';
  const prefix = tier === wood ? 'wooden' : 'stone';
  const M = 'M';
  const S = 'S';
  const keys = { [M]: material, [S]: Block.Stick };
  return [
    {
      id: `${prefix}-pickaxe`,
      name: `${label} Pickaxe`,
      table: true,
      pattern: ['MMM', ' S ', ' S '],
      keys,
      result: tier === wood ? Block.WoodenPickaxe : Block.StonePickaxe,
      count: 1,
    },
    {
      id: `${prefix}-axe`,
      name: `${label} Axe`,
      table: true,
      pattern: ['MM ', 'MS ', ' S '],
      keys,
      result: tier === wood ? Block.WoodenAxe : Block.StoneAxe,
      count: 1,
    },
    {
      id: `${prefix}-axe-mirror`,
      name: `${label} Axe`,
      table: true,
      pattern: [' MM', ' SM', ' S '],
      keys,
      result: tier === wood ? Block.WoodenAxe : Block.StoneAxe,
      count: 1,
    },
    {
      id: `${prefix}-shovel`,
      name: `${label} Shovel`,
      table: true,
      pattern: [' M ', ' S ', ' S '],
      keys,
      result: tier === wood ? Block.WoodenShovel : Block.StoneShovel,
      count: 1,
    },
    {
      id: `${prefix}-sword`,
      name: `${label} Sword`,
      table: true,
      pattern: [' M ', ' M ', ' S '],
      keys,
      result: tier === wood ? Block.WoodenSword : Block.StoneSword,
      count: 1,
    },
  ];
};

export const RECIPES: Recipe[] = [
  {
    id: 'planks',
    name: 'Oak Planks',
    table: false,
    pattern: ['W'],
    keys: { W: Block.Wood },
    result: Block.Planks,
    count: 4,
  },
  {
    id: 'sticks',
    name: 'Sticks',
    table: false,
    pattern: ['P', 'P'],
    keys: { P: Block.Planks },
    result: Block.Stick,
    count: 4,
  },
  {
    id: 'crafting-table',
    name: 'Crafting Table',
    table: false,
    pattern: ['PP', 'PP'],
    keys: { P: Block.Planks },
    result: Block.CraftingTable,
    count: 1,
  },
  {
    id: 'bricks',
    name: 'Bricks',
    table: false,
    pattern: ['CC', 'CC'],
    keys: { C: Block.Cobblestone },
    result: Block.Brick,
    count: 4,
  },
  {
    id: 'torches',
    name: 'Torches',
    table: false,
    shapeless: [{ item: Block.CoalOre, count: 1 }, { item: Block.Stick, count: 1 }],
    result: Block.Torch,
    count: 4,
  },
  ...toolSet(wood, Block.Planks),
  ...toolSet(stone, Block.Cobblestone),
];

export const visibleRecipes = (table: boolean): Recipe[] => {
  const seen = new Set<string>();
  return RECIPES.filter((recipe) => {
    if (recipe.table && !table) return false;
    if (seen.has(recipe.name)) return false;
    seen.add(recipe.name);
    return true;
  });
};

export const recipeCost = (recipe: Recipe): Map<Block, number> => {
  const cost = new Map<Block, number>();
  const add = (item: Block, count: number): void => {
    cost.set(item, (cost.get(item) ?? 0) + count);
  };
  if (recipe.shapeless) {
    for (const part of recipe.shapeless) add(part.item, part.count);
    return cost;
  }
  for (const row of recipe.pattern ?? []) {
    for (const symbol of row) {
      if (symbol === ' ') continue;
      const item = recipe.keys?.[symbol];
      if (item !== undefined) add(item, 1);
    }
  }
  return cost;
};

const cloneStack = (stack: ItemStack): ItemStack => ({
  block: stack.block,
  count: stack.count,
  durability: stack.durability,
});

const stacksMatch = (a: ItemStack, b: ItemStack): boolean => (
  a.block === b.block && !isTool(a.block) && a.durability === b.durability
);

export function clickStacks(slot: ItemStack | null, cursor: ItemStack | null, right: boolean): {
  slot: ItemStack | null;
  cursor: ItemStack | null;
} {
  if (!cursor) {
    if (!slot) return { slot, cursor };
    if (right && slot.count > 1) {
      const take = Math.ceil(slot.count / 2);
      return {
        slot: { ...slot, count: slot.count - take },
        cursor: { ...slot, count: take },
      };
    }
    return { slot: null, cursor: cloneStack(slot) };
  }
  if (!slot) {
    if (right) {
      return {
        slot: { ...cursor, count: 1 },
        cursor: cursor.count > 1 ? { ...cursor, count: cursor.count - 1 } : null,
      };
    }
    return { slot: cloneStack(cursor), cursor: null };
  }
  if (!stacksMatch(slot, cursor)) return { slot: cloneStack(cursor), cursor: cloneStack(slot) };
  const cap = itemMaxStack(slot.block);
  if (right) {
    if (slot.count >= cap) return { slot, cursor };
    return {
      slot: { ...slot, count: slot.count + 1 },
      cursor: cursor.count > 1 ? { ...cursor, count: cursor.count - 1 } : null,
    };
  }
  const moved = Math.min(cap - slot.count, cursor.count);
  if (moved <= 0) return { slot: cloneStack(cursor), cursor: cloneStack(slot) };
  return {
    slot: { ...slot, count: slot.count + moved },
    cursor: cursor.count > moved ? { ...cursor, count: cursor.count - moved } : null,
  };
}

const trimGrid = (grid: Array<Array<Block | null>>): Array<Array<Block | null>> => {
  let minX = grid[0].length;
  let maxX = -1;
  let minY = grid.length;
  let maxY = -1;
  for (let y = 0; y < grid.length; y += 1) {
    for (let x = 0; x < grid[y].length; x += 1) {
      if (!grid[y][x]) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return [];
  return grid.slice(minY, maxY + 1).map((row) => row.slice(minX, maxX + 1));
};

const patternGrid = (recipe: Recipe): Array<Array<Block | null>> => {
  const rows = recipe.pattern ?? [];
  return rows.map((row) => [...row].map((symbol) => (symbol === ' ' ? null : recipe.keys?.[symbol] ?? null)));
};

const gridsEqual = (a: Array<Array<Block | null>>, b: Array<Array<Block | null>>): boolean => {
  if (a.length !== b.length) return false;
  for (let y = 0; y < a.length; y += 1) {
    if (a[y].length !== b[y].length) return false;
    for (let x = 0; x < a[y].length; x += 1) {
      if (a[y][x] !== b[y][x]) return false;
    }
  }
  return true;
};

const mirrorGrid = (grid: Array<Array<Block | null>>): Array<Array<Block | null>> => (
  grid.map((row) => [...row].reverse())
);

const shapelessMatch = (slots: Array<ItemStack | null>, recipe: Recipe): boolean => {
  const counts = new Map<Block, number>();
  for (const slot of slots) {
    if (!slot) continue;
    counts.set(slot.block, (counts.get(slot.block) ?? 0) + 1);
  }
  const parts = recipe.shapeless ?? [];
  if (counts.size !== parts.length) return false;
  return parts.every((part) => (counts.get(part.item) ?? 0) >= part.count);
};

export function matchRecipe(slots: Array<ItemStack | null>, table: boolean): Recipe | null {
  const width = table ? 3 : 2;
  const grid: Array<Array<Block | null>> = [];
  for (let y = 0; y < width; y += 1) {
    const row: Array<Block | null> = [];
    for (let x = 0; x < width; x += 1) {
      row.push(slots[y * width + x]?.block ?? null);
    }
    grid.push(row);
  }
  const trimmed = trimGrid(grid);
  if (trimmed.length === 0) return null;

  for (const recipe of RECIPES) {
    if (recipe.table && !table) continue;
    if (recipe.shapeless) {
      if (shapelessMatch(slots, recipe)) return recipe;
      continue;
    }
    const pattern = trimGrid(patternGrid(recipe));
    if (gridsEqual(trimmed, pattern) || gridsEqual(trimmed, mirrorGrid(pattern))) return recipe;
  }
  return null;
}


export function hasRecipeMaterials(recipe: Recipe, countOf: (block: Block) => number): boolean {
  for (const [block, count] of recipeCost(recipe)) {
    if (countOf(block) < count) return false;
  }
  return true;
}

export function recipeLabel(recipe: Recipe): string {
  return recipe.count > 1 ? `${blockName(recipe.result)} ×${recipe.count}` : blockName(recipe.result);
}
