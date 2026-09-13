import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type MutableRefObject } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api as ChessgroundApi } from '@lichess-org/chessground/api';
import type { Key } from '@lichess-org/chessground/types';
import { boardCoordinateConfig, useAccessibilityPreferences } from '../accessibility/preferences';
import { useReducedMotion } from './motion';

export type QQurzChessgroundConfig = NonNullable<Parameters<typeof Chessground>[1]>;
export type QQurzChessgroundApi = ChessgroundApi;

type Props = {
  config: QQurzChessgroundConfig;
  apiRef?: MutableRefObject<ChessgroundApi | null>;
  instanceKey?: string | number;
  className?: string;
  ariaLabel: string;
  onReady?: (api: ChessgroundApi) => void;
};

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const;
const RANKS = ['1', '2', '3', '4', '5', '6', '7', '8'] as const;

function clamp(value: number): number { return Math.max(0, Math.min(7, value)); }

function moveKeyboardSquare(square: Key, key: string, orientation: 'white' | 'black'): Key {
  let file = FILES.indexOf(square[0] as (typeof FILES)[number]);
  let rank = RANKS.indexOf(square[1] as (typeof RANKS)[number]);
  if (file < 0 || rank < 0) return orientation === 'white' ? 'e2' : 'e7';
  const direction = orientation === 'white' ? 1 : -1;
  if (key === 'ArrowRight') file = clamp(file + direction);
  if (key === 'ArrowLeft') file = clamp(file - direction);
  if (key === 'ArrowUp') rank = clamp(rank + direction);
  if (key === 'ArrowDown') rank = clamp(rank - direction);
  return `${FILES[file]}${RANKS[rank]}` as Key;
}

function cursorStyle(square: Key, orientation: 'white' | 'black'): CSSProperties {
  const file = Math.max(0, FILES.indexOf(square[0] as (typeof FILES)[number]));
  const rank = Math.max(0, RANKS.indexOf(square[1] as (typeof RANKS)[number]));
  const visualFile = orientation === 'white' ? file : 7 - file;
  const visualRank = orientation === 'white' ? 7 - rank : rank;
  return { left: `${visualFile * 12.5}%`, top: `${visualRank * 12.5}%` };
}

/**
 * The one 2D board renderer for QQURZ.
 *
 * Gameplay, tournament rooms, homepage previews, future spectator boards and
 * analysis/puzzle boards should all mount Chessground through this component.
 * Accessibility preferences are applied here so coordinates, motion and
 * keyboard operation stay consistent across every 2D board surface.
 */
export default function ChessBoardSurface({
  config,
  apiRef,
  instanceKey = 'board',
  className = '',
  ariaLabel,
  onReady,
}: Props) {
  const node = useRef<HTMLDivElement | null>(null);
  const ownApi = useRef<ChessgroundApi | null>(null);
  const latestReady = useRef(onReady);
  const [preferences] = useAccessibilityPreferences();
  const reducedMotion = useReducedMotion();
  const instructionsId = useId();
  const announcementId = useId();
  const orientation = (config.orientation ?? 'white') as 'white' | 'black';
  const [keyboardSquare, setKeyboardSquare] = useState<Key>(() => orientation === 'white' ? 'e2' : 'e7');
  const [keyboardActive, setKeyboardActive] = useState(false);
  const [announcement, setAnnouncement] = useState('');

  const effectiveConfig = useMemo<QQurzChessgroundConfig>(() => {
    const coordinateConfig = boardCoordinateConfig(preferences.boardCoordinates);
    return {
      ...config,
      ...coordinateConfig,
      animation: reducedMotion ? { enabled: false, duration: 0 } : config.animation,
    };
  }, [config, preferences.boardCoordinates, reducedMotion]);

  const latestConfig = useRef(effectiveConfig);
  latestConfig.current = effectiveConfig;
  latestReady.current = onReady;

  useEffect(() => {
    if (!node.current) return;

    const api = Chessground(node.current, latestConfig.current);
    ownApi.current = api;
    if (apiRef) apiRef.current = api;
    latestReady.current?.(api);

    const resize = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => api.redrawAll())
      : null;
    resize?.observe(node.current);

    return () => {
      resize?.disconnect();
      api.destroy();
      if (ownApi.current === api) ownApi.current = null;
      if (apiRef?.current === api) apiRef.current = null;
    };
  }, [apiRef, instanceKey]);

  useEffect(() => {
    ownApi.current?.set(effectiveConfig);
  }, [effectiveConfig]);

  useEffect(() => {
    setKeyboardSquare(orientation === 'white' ? 'e2' : 'e7');
  }, [orientation]);

  const onKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key.startsWith('Arrow')) {
      event.preventDefault();
      const next = moveKeyboardSquare(keyboardSquare, event.key, orientation);
      setKeyboardSquare(next);
      setKeyboardActive(true);
      setAnnouncement(`Keyboard focus ${next}. Press Enter or Space to select this square.`);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setKeyboardActive(true);
      ownApi.current?.selectSquare(keyboardSquare);
      setAnnouncement(`Selected ${keyboardSquare}. Use the arrow keys to move to a destination, then press Enter or Space.`);
    }
  };

  return (
    <div
      className="qqurz-board-accessible-shell"
      role="group"
      aria-roledescription="interactive chessboard"
      aria-label={ariaLabel}
      aria-describedby={`${instructionsId} ${announcementId}`}
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter Space"
      tabIndex={0}
      onFocus={() => {
        setKeyboardActive(true);
        setAnnouncement(`Keyboard focus ${keyboardSquare}. Use arrow keys to move between squares and Enter or Space to select.`);
      }}
      onKeyDown={onKeyboard}
      onPointerDown={() => setKeyboardActive(false)}
      data-keyboard-active={keyboardActive ? 'true' : 'false'}
    >
      <div
        ref={node}
        className={`cg-wrap board-mount qqurz-chessboard ${className}`.trim()}
        aria-hidden="true"
        data-board-renderer="chessground"
        data-piece-set="cburnett-svg"
      />
      {keyboardActive && <span className="qqurz-board-keyboard-cursor" style={cursorStyle(keyboardSquare, orientation)} aria-hidden="true" />}
      <span id={instructionsId} className="qqurz-sr-only">Use arrow keys to move the keyboard square. Press Enter or Space to select a piece or destination. Board coordinates follow your accessibility setting.</span>
      <span id={announcementId} className="qqurz-sr-only" aria-live="polite" aria-atomic="true">{announcement}</span>
    </div>
  );
}
