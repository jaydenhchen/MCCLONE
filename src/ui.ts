import { BLOCKS, HOTBAR_SIZE, itemDurability, itemToolType } from './blocks';
import { INVENTORY_SIZE, type GameMode, type ItemStack } from './inventory';
import { recipeCost, recipeLabel, visibleRecipes, type Recipe } from './crafting';

const requiredElement = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing UI element: ${selector}`);
  return element;
};

export class GameUI {
  private readonly startScreen = requiredElement<HTMLElement>('#start-screen');
  private readonly pauseScreen = requiredElement<HTMLElement>('#pause-screen');
  private readonly deathScreen = requiredElement<HTMLElement>('#death-screen');
  private readonly craftScreen = requiredElement<HTMLElement>('#craft-screen');
  private readonly hud = requiredElement<HTMLElement>('#hud');
  private readonly playButton = requiredElement<HTMLButtonElement>('#play-button');
  private readonly resumeButton = requiredElement<HTMLButtonElement>('#resume-button');
  private readonly newWorldButton = requiredElement<HTMLButtonElement>('#new-world-button');
  private readonly modeButton = requiredElement<HTMLButtonElement>('#mode-button');
  private readonly respawnButton = requiredElement<HTMLButtonElement>('#respawn-button');
  private readonly craftClose = requiredElement<HTMLButtonElement>('#craft-close');
  private readonly loadingState = requiredElement<HTMLElement>('#loading-state');
  private readonly seedValue = requiredElement<HTMLElement>('#seed-value');
  private readonly biomeValue = requiredElement<HTMLElement>('#biome-value');
  private readonly coordinates = requiredElement<HTMLElement>('#coordinates');
  private readonly performance = requiredElement<HTMLElement>('#performance');
  private readonly hotbar = requiredElement<HTMLElement>('#hotbar');
  private readonly targetLabel = requiredElement<HTMLElement>('#target-label');
  private readonly toastElement = requiredElement<HTMLElement>('#toast');
  private readonly saveIndicator = requiredElement<HTMLElement>('#save-indicator');
  private readonly hearts = requiredElement<HTMLElement>('#hearts');
  private readonly hunger = requiredElement<HTMLElement>('#hunger');
  private readonly breath = requiredElement<HTMLElement>('#breath');
  private readonly mineBar = requiredElement<HTMLElement>('#mine-bar');
  private readonly mineFill = requiredElement<HTMLElement>('#mine-fill');
  private readonly waterOverlay = requiredElement<HTMLElement>('#water-overlay');
  private readonly lavaOverlay = requiredElement<HTMLElement>('#lava-overlay');
  private readonly damageVignette = requiredElement<HTMLElement>('#damage-vignette');
  private readonly deathCause = requiredElement<HTMLElement>('#death-cause');
  private readonly craftHeading = requiredElement<HTMLElement>('#craft-heading');
  private readonly craftGrid = requiredElement<HTMLElement>('#craft-grid');
  private readonly craftResult = requiredElement<HTMLElement>('#craft-result');
  private readonly recipeList = requiredElement<HTMLElement>('#recipe-list');
  private readonly recipeReady = requiredElement<HTMLElement>('#recipe-ready');
  private readonly invGrid = requiredElement<HTMLElement>('#inv-grid');
  private readonly cursorItem = requiredElement<HTMLElement>('#cursor-item');
  private toastTimer?: number;
  private saveTimer?: number;
  private damageTimer?: number;

  constructor(seed: number) {
    this.seedValue.textContent = String(seed >>> 0);
    this.buildHotbar();
    this.buildInventoryGrid();
    const splashes = [
      'Every block is yours.',
      'Dig deeper.',
      'Mind the lava.',
      'No two worlds alike!',
      'Punch a tree. Craft a home.',
      'Zombies hate sunlight.',
    ];
    requiredElement<HTMLElement>('#splash').textContent = splashes[Math.abs(seed) % splashes.length];
    window.addEventListener('mousemove', (event) => {
      this.cursorItem.style.left = `${event.clientX + 14}px`;
      this.cursorItem.style.top = `${event.clientY + 14}px`;
    });
  }

  get craftingOpen(): boolean {
    return this.craftScreen.classList.contains('visible');
  }

  onPlay(callback: () => void): void {
    this.playButton.addEventListener('click', callback);
  }

  onResume(callback: () => void): void {
    this.resumeButton.addEventListener('click', callback);
  }

  onNewWorld(callback: () => void): void {
    this.newWorldButton.addEventListener('click', callback);
  }

  onToggleMode(callback: () => void): void {
    this.modeButton.addEventListener('click', callback);
  }

  onRespawn(callback: () => void): void {
    this.respawnButton.addEventListener('click', callback);
  }

  onCloseCraft(callback: () => void): void {
    this.craftClose.addEventListener('click', callback);
  }

  onCraftGrid(callback: (index: number, right: boolean) => void): void {
    this.craftGrid.addEventListener('mousedown', (event) => {
      const slot = (event.target as HTMLElement).closest<HTMLElement>('.craft-slot');
      if (!slot || slot.dataset.index === undefined) return;
      event.preventDefault();
      callback(Number(slot.dataset.index), event.button === 2);
    });
    this.craftGrid.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  onCraftResult(callback: (right: boolean) => void): void {
    this.craftResult.addEventListener('mousedown', (event) => {
      event.preventDefault();
      callback(event.button === 2);
    });
    this.craftResult.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  onInventorySlot(callback: (index: number, right: boolean) => void): void {
    this.invGrid.addEventListener('mousedown', (event) => {
      const slot = (event.target as HTMLElement).closest<HTMLElement>('.craft-slot');
      if (!slot || slot.dataset.index === undefined) return;
      event.preventDefault();
      callback(Number(slot.dataset.index), event.button === 2);
    });
    this.invGrid.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  onRecipeCraft(callback: (id: string) => void): void {
    this.recipeList.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest<HTMLElement>('[data-recipe]');
      if (!target?.dataset.recipe || target.classList.contains('locked')) return;
      callback(target.dataset.recipe);
    });
  }

  setReady(): void {
    this.loadingState.classList.add('done');
    this.playButton.disabled = false;
  }

  showPlaying(): void {
    this.startScreen.classList.remove('visible');
    this.pauseScreen.classList.remove('visible');
    this.deathScreen.classList.remove('visible');
    this.craftScreen.classList.remove('visible');
    this.hud.classList.add('active');
    document.body.classList.remove('crafting');
    this.paintSlot(this.cursorItem, null, true);
  }

  showPaused(): void {
    this.pauseScreen.classList.add('visible');
    this.deathScreen.classList.remove('visible');
    this.craftScreen.classList.remove('visible');
    this.hud.classList.remove('active');
    document.body.classList.remove('crafting');
  }

  showCrafting(table: boolean): void {
    this.pauseScreen.classList.remove('visible');
    this.deathScreen.classList.remove('visible');
    this.craftScreen.classList.add('visible');
    this.hud.classList.add('active');
    this.craftHeading.textContent = table ? 'Crafting Table' : 'Inventory';
    this.craftGrid.style.setProperty('--craft-size', table ? '3' : '2');
    this.craftGrid.classList.toggle('table', table);
    document.body.classList.add('crafting');
  }

  showDeath(cause: string): void {
    this.deathCause.textContent = cause;
    this.deathScreen.classList.add('visible');
    this.pauseScreen.classList.remove('visible');
    this.craftScreen.classList.remove('visible');
    this.hud.classList.remove('active');
    document.body.classList.remove('crafting');
  }

  setMode(mode: GameMode): void {
    this.modeButton.textContent = mode === 'creative' ? 'SWITCH TO SURVIVAL' : 'SWITCH TO CREATIVE';
    this.hud.classList.toggle('creative', mode === 'creative');
  }

  refreshHotbar(slots: Array<ItemStack | null>, selected: number, showCounts: boolean): void {
    for (let index = 0; index < HOTBAR_SIZE; index += 1) {
      const slot = this.hotbar.children[index] as HTMLElement | undefined;
      if (!slot) continue;
      slot.classList.toggle('selected', index === selected);
      this.paintSlot(slot, slots[index] ?? null, showCounts);
    }
  }

  refreshCrafting(
    table: boolean,
    grid: Array<ItemStack | null>,
    result: ItemStack | null,
    inventory: Array<ItemStack | null>,
    cursor: ItemStack | null,
    canCraft: (recipe: Recipe) => boolean,
    hasMaterials: (recipe: Recipe) => boolean,
  ): void {
    const size = table ? 9 : 4;
    if (this.craftGrid.childElementCount !== size) {
      this.craftGrid.replaceChildren();
      for (let index = 0; index < size; index += 1) {
        const slot = document.createElement('div');
        slot.className = 'craft-slot';
        slot.dataset.index = String(index);
        slot.innerHTML = '<span class="block-icon"></span><span class="count"></span><i class="durability"></i>';
        this.craftGrid.append(slot);
      }
    }
    for (let index = 0; index < size; index += 1) {
      this.paintSlot(this.craftGrid.children[index] as HTMLElement, grid[index] ?? null, true);
    }
    this.paintSlot(this.craftResult, result, true);
    for (let index = 0; index < INVENTORY_SIZE; index += 1) {
      const slot = this.invGrid.children[index] as HTMLElement | undefined;
      if (slot) this.paintSlot(slot, inventory[index] ?? null, true);
    }
    this.paintSlot(this.cursorItem, cursor, true);
    this.cursorItem.classList.toggle('visible', Boolean(cursor));

    const ready = visibleRecipes(table).filter((recipe) => canCraft(recipe));
    const needTable = table
      ? []
      : visibleRecipes(true).filter((recipe) => recipe.table && hasMaterials(recipe) && !canCraft(recipe));
    this.recipeReady.textContent = ready.length === 1 ? '1 ready' : `${ready.length} ready`;

    this.recipeList.replaceChildren();
    if (ready.length === 0 && needTable.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'recipe-empty';
      empty.textContent = 'Nothing you can craft yet. Punch a tree for wood, then come back here.';
      this.recipeList.append(empty);
    }

    const appendRecipe = (recipe: Recipe, locked: boolean): void => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = `recipe-row${locked ? ' locked' : ' ready'}`;
      row.dataset.recipe = recipe.id;
      const ingredients = [...recipeCost(recipe).entries()].map(([item, count]) => `
        <span class="recipe-need" title="${BLOCKS[item].name}">
          <span class="block-icon" style="--block-color:${BLOCKS[item].iconColor}"></span>
          <em>${count}</em>
        </span>
      `).join('');
      row.innerHTML = `
        <span class="block-icon" style="--block-color:${BLOCKS[recipe.result].iconColor}"></span>
        <div>
          <strong>${recipeLabel(recipe)}</strong>
          <div class="recipe-cost">${ingredients}</div>
        </div>
        <span class="recipe-action">${locked ? 'Need table' : 'Craft'}</span>
      `;
      this.recipeList.append(row);
    };

    for (const recipe of ready) appendRecipe(recipe, false);
    if (needTable.length > 0) {
      const note = document.createElement('p');
      note.className = 'recipe-section';
      note.textContent = 'Have the materials — need a crafting table';
      this.recipeList.append(note);
      for (const recipe of needTable) appendRecipe(recipe, true);
    }
  }

  setTarget(name?: string): void {
    this.targetLabel.textContent = name ?? '';
    this.targetLabel.classList.toggle('visible', Boolean(name));
  }

  setMining(progress: number | null): void {
    this.mineBar.classList.toggle('visible', progress !== null);
    this.mineFill.style.width = `${Math.round((progress ?? 0) * 100)}%`;
  }

  setVitals(health: number, energy: number, air: number, submerged: boolean): void {
    this.hearts.textContent = this.meter(health, 20, '♥', '♡');
    this.hunger.textContent = this.meter(energy, 20, '◆', '◇');
    this.breath.classList.toggle('visible', submerged && air < 19.5);
    this.breath.textContent = this.meter(air, 20, '●', '○');
  }

  setOverlays(water: boolean, lava: boolean): void {
    this.waterOverlay.classList.toggle('visible', water);
    this.lavaOverlay.classList.toggle('visible', lava);
  }

  flashDamage(): void {
    this.damageVignette.classList.add('flash');
    if (this.damageTimer !== undefined) window.clearTimeout(this.damageTimer);
    this.damageTimer = window.setTimeout(() => this.damageVignette.classList.remove('flash'), 220);
  }

  updateStats(x: number, y: number, z: number, biome: string, fps: number, chunks: number): void {
    this.coordinates.textContent = `XYZ ${Math.floor(x)} / ${Math.floor(y)} / ${Math.floor(z)}`;
    this.biomeValue.textContent = biome;
    this.performance.textContent = `${Math.round(fps)} FPS · ${chunks} CHUNKS`;
  }

  toast(message: string): void {
    if (this.toastTimer !== undefined) window.clearTimeout(this.toastTimer);
    this.toastElement.textContent = message;
    this.toastElement.classList.add('visible');
    this.toastTimer = window.setTimeout(() => this.toastElement.classList.remove('visible'), 1800);
  }

  saved(): void {
    if (this.saveTimer !== undefined) window.clearTimeout(this.saveTimer);
    this.saveIndicator.classList.add('visible');
    this.saveTimer = window.setTimeout(() => this.saveIndicator.classList.remove('visible'), 1300);
  }

  private paintSlot(slot: HTMLElement, stack: ItemStack | null, showCounts: boolean): void {
    slot.classList.toggle('empty', !stack);
    const icon = slot.querySelector<HTMLElement>('.block-icon') ?? slot;
    const count = slot.querySelector<HTMLElement>('.count');
    const bar = slot.querySelector<HTMLElement>('.durability');
    if (icon) {
      icon.style.setProperty('--block-color', stack ? BLOCKS[stack.block].iconColor : 'transparent');
      icon.style.opacity = stack ? '1' : icon === slot ? '0' : '0';
      icon.classList.toggle('is-tool', Boolean(stack && itemToolType(stack.block)));
      icon.dataset.tool = stack ? (itemToolType(stack.block) ?? '') : '';
    }
    if (count) count.textContent = stack && showCounts && stack.count > 1 ? String(stack.count) : '';
    if (bar) {
      const max = stack ? itemDurability(stack.block) : undefined;
      const show = Boolean(stack && max && stack.durability !== undefined && stack.durability < max);
      bar.classList.toggle('visible', show);
      if (show && stack?.durability !== undefined && max) {
        const ratio = stack.durability / max;
        bar.style.width = `${Math.max(8, Math.round(ratio * 100))}%`;
        bar.style.background = ratio > 0.45 ? '#6fde6a' : ratio > 0.2 ? '#e7c84d' : '#e35d4b';
      }
    }
    slot.title = stack ? BLOCKS[stack.block].name : '';
  }

  private meter(value: number, max: number, filled: string, empty: string): string {
    const units = max / 2;
    let text = '';
    for (let index = 0; index < units; index += 1) {
      text += value >= (index + 1) * 2 ? `${filled} ` : `${empty} `;
    }
    return text.trim();
  }

  private buildHotbar(): void {
    this.hotbar.replaceChildren();
    for (let index = 0; index < HOTBAR_SIZE; index += 1) {
      const slot = document.createElement('div');
      slot.className = `hotbar-slot${index === 0 ? ' selected' : ''} empty`;
      slot.innerHTML = `<span class="key">${index + 1}</span><span class="block-icon"></span><span class="count"></span><i class="durability"></i>`;
      this.hotbar.append(slot);
    }
  }

  private buildInventoryGrid(): void {
    this.invGrid.replaceChildren();
    for (let index = 0; index < INVENTORY_SIZE; index += 1) {
      const slot = document.createElement('div');
      slot.className = 'craft-slot empty';
      slot.dataset.index = String(index);
      slot.innerHTML = '<span class="block-icon"></span><span class="count"></span><i class="durability"></i>';
      this.invGrid.append(slot);
    }
    this.craftResult.innerHTML = '<span class="block-icon"></span><span class="count"></span><i class="durability"></i>';
    this.cursorItem.innerHTML = '<span class="block-icon"></span><span class="count"></span>';
  }
}
