import { useEffect, useRef } from 'react';
import type { MutableRefObject } from 'react';
import { Chessground } from '@lichess-org/chessground';
import type { Api as ChessgroundApi } from '@lichess-org/chessground/api';

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

/**
 * The one 2D board renderer for QQURZ.
 *
 * Gameplay, tournament rooms, homepage previews, future spectator boards and
 * analysis/puzzle boards should all mount Chessground through this component.
 * The cburnett SVG asset sheet is loaded once in main.tsx, so every board gets
 * the exact same white/black piece artwork at every size.
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
  const latestConfig = useRef(config);
  const latestReady = useRef(onReady);
  latestConfig.current = config;
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
    ownApi.current?.set(config);
  }, [config]);

  return (
    <div
      ref={node}
      className={`cg-wrap board-mount qqurz-chessboard ${className}`.trim()}
      aria-label={ariaLabel}
      data-board-renderer="chessground"
      data-piece-set="cburnett-svg"
    />
  );
}
