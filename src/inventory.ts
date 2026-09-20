import {
  Block,
  HOTBAR_SIZE,
  PLACEABLE_BLOCKS,
  isKnownBlock,
  isTool,
  itemDurability,
  itemMaxStack,
} from './blocks';

export const INVENTORY_SIZE = 36;

export type GameMode = 'survival' | 'creative';

export type ItemStack = {
  block: Block;
  count: number;
  durability?: number;
};

export type InventorySave = {
  selected: number;
  slots: Array<{ block: number; count: number; durability?: number } | null>;
};

const makeStack = (block: Block, count: number, durability?: number): ItemStack => {
  const stack: ItemStack = { block, count: Math.min(itemMaxStack(block), count) };
  const max = itemDurability(block);
  if (max !== undefined) stack.durability = durability ?? max;
  return stack;
};

export class Inventory {
  readonly slots: Array<ItemStack | null> = Array.from({ length: INVENTORY_SIZE }, () => null);
  selectedIndex = 0;

  get selected(): ItemStack | null {
    return this.slots[this.selectedIndex] ?? null;
  }

  get selectedBlock(): Block | undefined {
    return this.selected?.block;
  }

  select(index: number): boolean {
    if (index < 0 || index >= HOTBAR_SIZE) return false;
    this.selectedIndex = index;
    return true;
  }

  cycle(direction: number): void {
    this.selectedIndex = (this.selectedIndex + direction + HOTBAR_SIZE) % HOTBAR_SIZE;
  }

  add(block: Block, count: number, durability?: number): number {
    if (block === Block.Air || count <= 0 || !isKnownBlock(block)) return count;
    let remaining = count;
    const cap = itemMaxStack(block);
    if (cap > 1) {
      for (const slot of this.slots) {
        if (!slot || slot.block !== block) continue;
        const room = cap - slot.count;
        if (room <= 0) continue;
        const moved = Math.min(room, remaining);
        slot.count += moved;
        remaining -= moved;
        if (remaining === 0) return 0;
      }
    }
    for (let index = 0; index < this.slots.length; index += 1) {
      if (this.slots[index]) continue;
      const moved = Math.min(cap, remaining);
      this.slots[index] = makeStack(block, moved, durability);
      remaining -= moved;
      if (remaining === 0) return 0;
    }
    return remaining;
  }

  countOf(block: Block): number {
    return this.slots.reduce((total, slot) => total + (slot?.block === block ? slot.count : 0), 0);
  }

  consume(block: Block, count = 1): boolean {
    if (this.countOf(block) < count) return false;
    let remaining = count;
    for (let index = 0; index < this.slots.length; index += 1) {
      const slot = this.slots[index];
      if (!slot || slot.block !== block) continue;
      const taken = Math.min(slot.count, remaining);
      slot.count -= taken;
      remaining -= taken;
      if (slot.count <= 0) this.slots[index] = null;
      if (remaining === 0) return true;
    }
    return remaining === 0;
  }

  consumeSelected(creative: boolean): Block | undefined {
    const slot = this.selected;
    if (!slot) return undefined;
    if (creative) return slot.block;
    slot.count -= 1;
    if (slot.count <= 0) this.slots[this.selectedIndex] = null;
    return slot.block;
  }

  takeSelected(count = 1): ItemStack | undefined {
    const slot = this.selected;
    if (!slot) return undefined;
    const taken = Math.min(count, slot.count);
    const result = makeStack(slot.block, taken, slot.durability);
    slot.count -= taken;
    if (slot.count <= 0) this.slots[this.selectedIndex] = null;
    return result;
  }

  damageSelected(amount = 1): boolean {
    const slot = this.selected;
    if (!slot || !isTool(slot.block) || slot.durability === undefined) return false;
    slot.durability -= amount;
    if (slot.durability > 0) return false;
    this.slots[this.selectedIndex] = null;
    return true;
  }

  setSlot(index: number, block: Block, count: number, durability?: number): void {
    this.slots[index] = count > 0 ? makeStack(block, count, durability) : null;
  }

  fillCreativePalette(): void {
    this.slots.fill(null);
    const extras = [
      Block.Torch,
      Block.Stick,
      Block.WoodenPickaxe,
      Block.WoodenAxe,
      Block.WoodenShovel,
      Block.WoodenSword,
      Block.StonePickaxe,
      Block.StoneAxe,
      Block.StoneShovel,
      Block.StoneSword,
      Block.CoalOre,
      Block.IronOre,
    ];
    [...PLACEABLE_BLOCKS, ...extras].forEach((block, index) => {
      if (index < INVENTORY_SIZE) this.setSlot(index, block, itemMaxStack(block));
    });
  }

  serialize(): InventorySave {
    return {
      selected: this.selectedIndex,
      slots: this.slots.map((slot) => (
        slot ? { block: slot.block, count: slot.count, durability: slot.durability } : null
      )),
    };
  }

  load(save: InventorySave): void {
    this.slots.fill(null);
    this.selectedIndex = Math.max(0, Math.min(HOTBAR_SIZE - 1, save.selected | 0));
    save.slots.forEach((slot, index) => {
      if (index >= INVENTORY_SIZE) return;
      if (!slot || !isKnownBlock(slot.block) || !Number.isFinite(slot.count) || slot.count <= 0) {
        this.slots[index] = null;
        return;
      }
      this.setSlot(index, slot.block, slot.count, slot.durability);
    });
  }
}
