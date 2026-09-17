import { test, expect } from '@playwright/test';

const onboarding = {
  version: 1,
  completedAt: Date.now(),
  experience: 'experienced',
  boardAppearance: 'tournament',
  soundEnabled: false,
  accountCreated: false,
};

async function seedApp(page: import('@playwright/test').Page) {
  await page.addInitScript(value => {
    localStorage.setItem('qqurz:onboarding-v1', JSON.stringify(value));
    localStorage.setItem('qqurz:board-appearance', 'tournament');
  }, onboarding);
}

async function clickSquare(
  page: import('@playwright/test').Page,
  square: string,
  orientation: 'white' | 'black' = 'white',
) {
  const board = page.locator('.board-mount');
  await expect(board).toBeVisible();
  const box = await board.boundingBox();
  if (!box) throw new Error('Chessground board has no layout box.');
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const xFile = orientation === 'white' ? file : 7 - file;
  const yRank = orientation === 'white' ? 7 - rank : rank;
  await page.mouse.click(
    box.x + ((xFile + 0.5) / 8) * box.width,
    box.y + ((yRank + 0.5) / 8) * box.height,
  );
}

test('Stockfish makes the AI reply after a human move', async ({ page }) => {
  await seedApp(page);
  await page.goto('/');

  await page.getByRole('button', { name: 'Practice' }).click();
  await expect(page.getByRole('heading', { name: 'Play Stockfish.' })).toBeVisible();

  await page.getByRole('button', { name: 'Start game' }).click();
  await expect(page.locator('.board-mount')).toBeVisible();

  await page.waitForFunction(() => {
    const status = document.querySelector('.local-engine-state');
    return status?.textContent?.includes('Stockfish ready');
  }, null, { timeout: 20_000 });

  // Keep the move list open so the browser test can verify the AI reply as well as engine state.
  await page.getByRole('button', { name: 'Options' }).click();
  const moves = page.locator('.match-move-list li');
  await expect(moves).toHaveCount(0);

  // e2-e4 is legal from every Chess960 starting position and leaves White in control.
  await clickSquare(page, 'e2');
  await clickSquare(page, 'e4');

  await expect(moves).toHaveCount(2, { timeout: 20_000 });
  await expect(moves.nth(1)).not.toHaveText('');
  await expect(page.locator('.local-engine-state')).toContainText('Stockfish ready');
  await expect(page.locator('.match-turn-note')).toContainText('Your move');
});
