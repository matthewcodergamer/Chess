import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { Key } from '@lichess-org/chessground/types';
import type { ChessBoardViewState } from '../game/boardViewState';
import * as THREE from 'three';
import { createThreeScene, syncThreePieces, syncThreeSelection, type ThreeSceneHandle } from './threeScene';
import { squareFromWorldPoint } from './threeGeometry';

export type ThreeBoardRendererHandle = { resetCamera: () => void };
export type ThreeBoardRendererProps = {
  state: ChessBoardViewState;
  onMove: (orig: Key, dest: Key) => void;
  className?: string;
  ariaLabel?: string;
};

/**
 * Presentation-only board renderer.
 *
 * It receives a complete renderer-facing state projection and can only emit a
 * square-to-square move intent. Move legality and every game transition remain
 * owned by the shared controller/server layer.
 */
const ThreeBoardRenderer = forwardRef<ThreeBoardRendererHandle, ThreeBoardRendererProps>(function ThreeBoardRenderer({
  state,
  onMove,
  className = '',
  ariaLabel = 'Interactive 3D chess board',
}, ref) {
  const mount = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<ThreeSceneHandle | null>(null);
  const onMoveRef = useRef(onMove);
  const legalRef = useRef(state.legalDests);
  const movableRef = useRef(state.movableColor);
  const [selected, setSelected] = useState<Key | null>(null);
  onMoveRef.current = onMove;
  legalRef.current = state.legalDests;
  movableRef.current = state.movableColor;

  useImperativeHandle(ref, () => ({ resetCamera: () => sceneRef.current?.resetCamera() }), []);

  useEffect(() => {
    const element = mount.current;
    if (!element) return;
    const { handle, cleanup } = createThreeScene(element);
    sceneRef.current = handle;
    const raycaster = new THREE.Raycaster();
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -.075);
    const pointer = new THREE.Vector2();
    const hit = new THREE.Vector3();
    let down: Key | null = null;
    let moved = false;
    let sx = 0;
    let sy = 0;

    const pick = (event: PointerEvent): Key | null => {
      const rect = handle.renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
      );
      raycaster.setFromCamera(pointer, handle.camera);
      return raycaster.ray.intersectPlane(plane, hit) ? squareFromWorldPoint(handle.board, hit) : null;
    };
    const pointerDown = (event: PointerEvent) => {
      sx = event.clientX;
      sy = event.clientY;
      moved = false;
      down = pick(event);
    };
    const pointerMove = (event: PointerEvent) => {
      if (Math.abs(event.clientX - sx) > 7 || Math.abs(event.clientY - sy) > 7) moved = true;
    };
    const pointerUp = (event: PointerEvent) => {
      if (moved || !movableRef.current) return;
      const square = pick(event);
      if (!down || !square || down !== square) return;
      setSelected(current => {
        if (!current) return legalRef.current.has(square) ? square : null;
        const destinations = legalRef.current.get(current) ?? [];
        if (destinations.includes(square)) {
          onMoveRef.current(current, square);
          return null;
        }
        return legalRef.current.has(square) ? square : null;
      });
    };

    handle.renderer.domElement.addEventListener('pointerdown', pointerDown, { passive: true });
    handle.renderer.domElement.addEventListener('pointermove', pointerMove, { passive: true });
    handle.renderer.domElement.addEventListener('pointerup', pointerUp, { passive: true });
    handle.renderer.domElement.addEventListener('pointercancel', pointerUp, { passive: true });
    return () => {
      handle.renderer.domElement.removeEventListener('pointerdown', pointerDown);
      handle.renderer.domElement.removeEventListener('pointermove', pointerMove);
      handle.renderer.domElement.removeEventListener('pointerup', pointerUp);
      handle.renderer.domElement.removeEventListener('pointercancel', pointerUp);
      sceneRef.current = null;
      cleanup();
    };
  }, []);

  useEffect(() => {
    if (selected && !state.legalDests.has(selected)) setSelected(null);
  }, [selected, state.fen, state.legalDests]);

  useEffect(() => {
    if (sceneRef.current) syncThreePieces(sceneRef.current, state);
  }, [state.fen, state.orientation, state.lastMove, state.check, state.turnColor]);

  useEffect(() => {
    if (sceneRef.current) syncThreeSelection(sceneRef.current, selected, state);
  }, [selected, state.legalDests, state.movableColor]);

  return <div ref={mount} className={`three-board-mount ${className}`.trim()} aria-label={ariaLabel} role="application" />;
});

export default ThreeBoardRenderer;
