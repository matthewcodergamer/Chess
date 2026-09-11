import { useReducer } from 'react';
import {
  createGameSession,
  reduceGameSession,
  type CreateGameSessionOptions,
  type GameSessionEvent,
  type GameSessionModel,
} from '../../shared/gameSession';

export type GameSessionController = {
  session: GameSessionModel;
  dispatchSession: (event: GameSessionEvent) => void;
};

export function useGameSession(initial: CreateGameSessionOptions = {}): GameSessionController {
  const [session, dispatchSession] = useReducer(
    reduceGameSession,
    initial,
    options => createGameSession(options),
  );
  return { session, dispatchSession };
}
