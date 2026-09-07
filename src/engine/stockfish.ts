export type AiDifficulty = 'easy' | 'hard' | 'crazy';

export const AI_DIFFICULTIES: Record<AiDifficulty, {
  label: string;
  subtitle: string;
  skill: number;
  moveTime: number;
}> = {
  easy: {
    label: 'Easy',
    subtitle: 'Relaxed robot · makes human-like mistakes',
    skill: 2,
    moveTime: 180,
  },
  hard: {
    label: 'Hard',
    subtitle: 'Strong club-level fight',
    skill: 12,
    moveTime: 650,
  },
  crazy: {
    label: 'Crazy Hard',
    subtitle: 'Stockfish unleashed',
    skill: 20,
    moveTime: 1800,
  },
};

type Waiter = {
  test: (line: string) => boolean;
  resolve: (line: string) => void;
  reject: (error: Error) => void;
  timer: number;
};

export class StockfishEngine {
  private worker: Worker | null = null;
  private waiters: Waiter[] = [];
  private initPromise: Promise<void> | null = null;
  private ready = false;
  private currentSearch: Promise<string> | null = null;

  isReady(): boolean {
    return this.ready;
  }

  async init(): Promise<void> {
    if (this.ready) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const workerPath = `${import.meta.env.BASE_URL}stockfish/stockfish-18-lite-single.js`;
      this.worker = new Worker(workerPath);
      this.worker.addEventListener('message', this.handleMessage);
      this.worker.addEventListener('error', this.handleError);

      const uciReady = this.waitFor(line => line === 'uciok', 20000);
      this.post('uci');
      await uciReady;

      this.post('setoption name UCI_Chess960 value true');
      this.post('setoption name Ponder value false');
      const ready = this.waitFor(line => line === 'readyok', 10000);
      this.post('isready');
      await ready;
      this.ready = true;
    })().catch(error => {
      this.ready = false;
      this.initPromise = null;
      this.destroyWorker();
      throw error;
    });

    return this.initPromise;
  }

  async bestMove(fen: string, difficulty: AiDifficulty): Promise<string> {
    await this.init();

    if (this.currentSearch) {
      this.post('stop');
      try {
        await this.currentSearch;
      } catch {
        // A previous search may have been cancelled by a new match.
      }
    }

    const settings = AI_DIFFICULTIES[difficulty];
    this.post(`setoption name Skill Level value ${settings.skill}`);
    this.post('setoption name UCI_Chess960 value true');

    const ready = this.waitFor(line => line === 'readyok', 10000);
    this.post('isready');
    await ready;

    this.post(`position fen ${fen}`);

    const search = this.waitFor(line => line.startsWith('bestmove '), Math.max(15000, settings.moveTime + 10000))
      .then(line => {
        const move = line.split(/\s+/)[1];
        if (!move || move === '(none)' || move === '0000') {
          throw new Error('Stockfish did not return a legal move.');
        }
        return move;
      })
      .finally(() => {
        this.currentSearch = null;
      });

    this.currentSearch = search;
    this.post(`go movetime ${settings.moveTime}`);
    return search;
  }

  cancelSearch(): void {
    if (this.currentSearch) this.post('stop');
  }

  destroy(): void {
    this.cancelSearch();
    this.destroyWorker();
    this.ready = false;
    this.initPromise = null;
    this.currentSearch = null;
  }

  private post(command: string): void {
    if (!this.worker) throw new Error('Stockfish worker is not available.');
    this.worker.postMessage(command);
  }

  private waitFor(test: (line: string) => boolean, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.waiters = this.waiters.filter(waiter => waiter.timer !== timer);
        reject(new Error('Stockfish took too long to respond.'));
      }, timeoutMs);
      this.waiters.push({ test, resolve, reject, timer });
    });
  }

  private handleMessage = (event: MessageEvent<unknown>): void => {
    const payload = typeof event.data === 'string' ? event.data : String(event.data ?? '');
    const lines = payload.split(/\r?\n/).filter(Boolean);

    for (const line of lines) {
      const matched = this.waiters.filter(waiter => waiter.test(line));
      if (!matched.length) continue;
      this.waiters = this.waiters.filter(waiter => !matched.includes(waiter));
      for (const waiter of matched) {
        window.clearTimeout(waiter.timer);
        waiter.resolve(line);
      }
    }
  };

  private handleError = (): void => {
    const error = new Error('The Stockfish AI worker failed to load.');
    this.ready = false;
    for (const waiter of this.waiters) {
      window.clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters = [];
  };

  private destroyWorker(): void {
    if (this.worker) {
      this.worker.removeEventListener('message', this.handleMessage);
      this.worker.removeEventListener('error', this.handleError);
      this.worker.terminate();
      this.worker = null;
    }
    for (const waiter of this.waiters) {
      window.clearTimeout(waiter.timer);
      waiter.reject(new Error('Stockfish worker was stopped.'));
    }
    this.waiters = [];
  }
}
