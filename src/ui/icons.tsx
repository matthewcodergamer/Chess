import { Fragment, type ReactNode } from 'react';

export type UiIconName =
  | 'menu'
  | 'close'
  | 'theme'
  | 'board'
  | 'sound'
  | 'muted'
  | 'accessibility'
  | 'retry'
  | 'external'
  | 'back';

const UI_GLYPHS: Record<UiIconName, ReactNode> = {
  menu: '☰',
  close: '×',
  theme: '◐',
  board: '▦',
  sound: '♪',
  muted: '×',
  accessibility: '◎',
  retry: '↻',
  external: '↗',
  back: '←',
};

/**
 * Central source for non-chess interface glyphs.
 * Chess pieces intentionally remain part of QQURZ's product identity; generic
 * navigation/status symbols come from here so screens do not invent icons.
 */
export function UiIcon({ name }: { name: UiIconName }) {
  return <Fragment>{UI_GLYPHS[name]}</Fragment>;
}
