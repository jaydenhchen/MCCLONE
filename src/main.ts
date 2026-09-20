import './style.css';
import { Game, getOrCreateSeed } from './game';

async function start(): Promise<void> {
  try {
    const game = new Game(getOrCreateSeed());
    await game.initialize();
  } catch (error) {
    console.error(error);
    const loading = document.querySelector<HTMLElement>('#loading-state');
    const playButton = document.querySelector<HTMLButtonElement>('#play-button');
    if (loading) loading.innerHTML = '<strong>Could not build this world. Check WebGL support and refresh.</strong>';
    if (playButton) playButton.disabled = true;
  }
}

void start();
