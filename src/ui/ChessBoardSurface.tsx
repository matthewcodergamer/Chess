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
  const [keyboardSelectedSquare, setKeyboardSelectedSquare] = useState<Key | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const effectiveConfig = useMemo<QQurzChessgroundConfig>(() => {
    const coordinateConfig = boardCoordinateConfig(preferences.boardCoordinates);
    const baseConfig: QQurzChessgroundConfig = {
      ...config,
      ...coordinateConfig,
    };

    // Do not pass `animation: undefined` into Chessground. WebKit exposed a
    // failure path where a follow-up set() call replaced Chessground's default
    // animation state with undefined and its animation loop then dereferenced
    // `state.animation.current`. Preserve the library default unless QQURZ is
    // explicitly disabling motion.
    if (!reducedMotion) return baseConfig;
    return {
      ...baseConfig,
      animation: { enabled: false, duration: 0 },
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

    // Redrawing synchronously from ResizeObserver can create another geometry
    // change while WebKit is still delivering the same observer batch. Safari
    // reports that as "ResizeObserver loop completed with undelivered
    // notifications". Coalesce redraws onto the next animation frame instead.
    let disposed = false;
    let redrawFrame = 0;
    const scheduleRedraw = () => {
      if (disposed || redrawFrame) return;
      redrawFrame = window.requestAnimationFrame(() => {
        redrawFrame = 0;
        if (!disposed && ownApi.current === api) api.redrawAll();
      });
    };
    const resize = typeof ResizeObserver === 'function'
      ? new ResizeObserver(scheduleRedraw)
      : null;
    resize?.observe(node.current);

    return () => {
      disposed = true;
      resize?.disconnect();
      if (redrawFrame) window.cancelAnimationFrame(redrawFrame);
      if (ownApi.current === api) ownApi.current = null;
      if (apiRef?.current === api) apiRef.current = null;
      api.destroy();
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
      if (!keyboardSelectedSquare) {
        setKeyboardSelectedSquare(keyboardSquare);
        ownApi.current?.selectSquare(keyboardSquare);
        setAnnouncement(`Selected ${keyboardSquare}. Use the arrow keys to move to a destination, then press Enter or Space.`);
        return;
      }
      if (keyboardSelectedSquare === keyboardSquare) {
        setKeyboardSelectedSquare(null);
        ownApi.current?.selectSquare(keyboardSquare);
        setAnnouncement(`Cancelled selection on ${keyboardSquare}.`);
        return;
      }
      const after = latestConfig.current.movable?.events?.after;
      if (after) {
        after(keyboardSelectedSquare, keyboardSquare);
        setAnnouncement(`Moved from ${keyboardSelectedSquare} to ${keyboardSquare}.`);
      }
      setKeyboardSelectedSquare(null);
      ownApi.current?.selectSquare(keyboardSquare);
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
      onPointerDown={() => { setKeyboardActive(false); setKeyboardSelectedSquare(null); }}
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
