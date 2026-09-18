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

async function moveE2ToE4(page: import('@playwright/test').Page) {
  const board = page.locator('.qqurz-board-accessible-shell');
  await expect(board).toBeVisible();
  await board.scrollIntoViewIfNeeded();
  const box = await board.boundingBox();
  if (!box) throw new Error('Chess board has no measurable bounds.');
  // The local AI starts with White and Chess960 keeps pawns on their normal
  // ranks, so e2-e4 is legal for every starting position. Pointer input tests
  // the same real board interaction a player uses on touch and desktop.
  const file = 4;
  const e2RankFromTop = 6;
  const e4RankFromTop = 4;
  const square = (rankFromTop: number) => ({
    x: box.x + ((file + 0.5) / 8) * box.width,
    y: box.y + ((rankFromTop + 0.5) / 8) * box.height,
  });
  await page.mouse.click(square(e2RankFromTop).x, square(e2RankFromTop).y);
  await page.mouse.click(square(e4RankFromTop).x, square(e4RankFromTop).y);
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

  // Chess960 opens with a short strategy phase. Confirm the engine is ready,
  // then use the real board control to enter the active clock phase.
  const strategyStart = page.locator('.local-board-overlay .primary-black');
  if (await strategyStart.isVisible().catch(() => false)) {
    await strategyStart.click();
  }
  await expect(page.locator('.match-turn-note')).toContainText('Your move', { timeout: 20_000 });

  // The production navigation must expose only the lowercase brand, with no legacy QQURZ mark or subtitle.
  const wordmark = page.locator('.qqurz-wordmark').first();
  await expect(wordmark).toHaveText('qqurzchess');
  await expect(wordmark.locator('.wordmark-piece')).toHaveCount(0);
  await expect(wordmark.locator('.wordmark-copy small')).toHaveCount(0);

  // Capture the black-piece render positions before the AI turn.
  const moves = page.locator('.match-move-list li');
  const blackPiecesBefore = await page.locator('.cg-wrap .piece.black').evaluateAll(
    pieces => pieces.map(piece => piece.getAttribute('style')).sort(),
  );

  // e2-e4 is legal from every Chess960 starting position and leaves White in control.
  // Use the board's real accessibility interaction instead of viewport coordinates;
  // large desktop boards can place e4 beneath the fixed navigation bar.
  await moveE2ToE4(page);
  await page.getByRole('button', { name: 'Options' }).click();
  await expect(moves).toHaveCount(1, { timeout: 10_000 });

  await expect(moves).toHaveCount(2, { timeout: 20_000 });
  await expect(moves.nth(1)).not.toHaveText('');

  // Do not accept "Stockfish moved" as a sound-only success: a black piece must
  // have a different rendered board position after the AI move.
  await expect.poll(
    async () => JSON.stringify(await page.locator('.cg-wrap .piece.black').evaluateAll(
      pieces => pieces.map(piece => piece.getAttribute('style')).sort(),
    )),
    { timeout: 5_000 },
  ).not.toBe(JSON.stringify(blackPiecesBefore));

  await expect(page.locator('.local-engine-state')).toContainText('Stockfish ready');
  await expect(page.locator('.match-turn-note')).toContainText('Your move');
});
