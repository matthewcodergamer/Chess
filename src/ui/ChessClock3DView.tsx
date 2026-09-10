import { useEffect, useRef } from 'react';
import type { Color } from '@lichess-org/chessground/types';
import * as THREE from 'three';
import { createChessClock3D } from '../premium/chessClock3D';

type Props = {
  whiteSeconds: number;
  blackSeconds: number;
  activeColor?: Color | null;
  pendingSlap?: Color | null;
  disabled?: boolean;
  onSlap?: () => void;
  compact?: boolean;
  className?: string;
};

type ClockState = {
  whiteSeconds: number;
  blackSeconds: number;
  activeColor: Color | null;
  pendingSlap: Color | null;
  disabled: boolean;
  onSlap?: () => void;
};

/**
 * Lightweight 3D clock renderer. Unlike the board scene, the clock does not need
 * a permanent animation loop: it redraws when the time/state changes and only
 * animates for a short window when the rocker changes direction.
 */
export default function ChessClock3DView({
  whiteSeconds,
  blackSeconds,
  activeColor = null,
  pendingSlap = null,
  disabled = false,
  onSlap,
  compact = false,
  className = '',
}: Props) {
  const mount = useRef<HTMLDivElement | null>(null);
  const state = useRef<ClockState>({ whiteSeconds, blackSeconds, activeColor, pendingSlap, disabled, onSlap });
  const invalidate = useRef<((animateMs?: number) => void) | null>(null);

  state.current = { whiteSeconds, blackSeconds, activeColor, pendingSlap, disabled, onSlap };

  useEffect(() => {
    const element = mount.current;
    if (!element) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(compact ? 30 : 28, 1, 0.1, 60);
    camera.position.set(0, 2.72, 8.25);
    camera.lookAt(0, 0.52, 0.18);

    const renderer = new THREE.WebGLRenderer({
      antialias: false,
      alpha: true,
      powerPreference: 'high-performance',
      precision: 'mediump',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.15 : 1.35));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.14;
    renderer.shadowMap.enabled = false;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.touchAction = 'manipulation';
    element.replaceChildren(renderer.domElement);

    const clock = createChessClock3D();
    clock.group.scale.setScalar(compact ? 1.03 : 1.10);
    clock.group.position.set(0, -0.07, 0);
    scene.add(clock.group);

    // Two cheap lights are enough for a small matte-plastic object.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x34383c, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 3.7);
    key.position.set(-4, 6, 7);
    scene.add(key);

    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pressed = false;
    let moved = false;
    let downX = 0;
    let downY = 0;
    let frame = 0;
    let animateUntil = 0;
    let lastFrame = 0;
    let inViewport = true;
    let destroyed = false;

    const renderOnce = (now = performance.now()) => {
      if (destroyed || !inViewport || document.hidden) return;
      const value = state.current;
      clock.update(value.whiteSeconds, value.blackSeconds, value.activeColor, value.pendingSlap);
      renderer.render(scene, camera);
      lastFrame = now;
    };

    const animate = (now: number) => {
      frame = 0;
      if (destroyed || !inViewport || document.hidden) return;
      if (now - lastFrame >= 33) renderOnce(now);
      if (now < animateUntil) frame = requestAnimationFrame(animate);
    };

    const requestRender = (animateMs = 0) => {
      if (destroyed) return;
      animateUntil = Math.max(animateUntil, performance.now() + animateMs);
      renderOnce();
      if (animateMs > 0 && !frame) frame = requestAnimationFrame(animate);
    };
    invalidate.current = requestRender;

    const aim = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.set(
        ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -(((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 - 1),
      );
      ray.setFromCamera(pointer, camera);
    };
    const hitsRocker = (event: PointerEvent) => {
      aim(event);
      return ray.intersectObjects(clock.hitTargets, true).length > 0;
    };
    const pointerDown = (event: PointerEvent) => {
      downX = event.clientX;
      downY = event.clientY;
      moved = false;
      pressed = hitsRocker(event);
      if (pressed) renderer.domElement.setPointerCapture?.(event.pointerId);
    };
    const pointerMove = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - downX, event.clientY - downY) > 8) moved = true;
    };
    const pointerUp = (event: PointerEvent) => {
      const value = state.current;
      const canSlap = Boolean(value.pendingSlap && value.onSlap && !value.disabled);
      if (!moved && pressed && canSlap && hitsRocker(event)) {
        clock.slap(value.pendingSlap!);
        requestRender(240);
        value.onSlap?.();
      }
      pressed = false;
    };

    renderer.domElement.addEventListener('pointerdown', pointerDown);
    renderer.domElement.addEventListener('pointermove', pointerMove);
    renderer.domElement.addEventListener('pointerup', pointerUp);
    renderer.domElement.addEventListener('pointercancel', pointerUp);

    const resize = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      requestRender();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(element);

    const intersectionObserver = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(entries => {
          inViewport = Boolean(entries[0]?.isIntersecting);
          if (inViewport) requestRender(180);
        }, { rootMargin: '80px' })
      : null;
    intersectionObserver?.observe(element);

    const visibilityChange = () => { if (!document.hidden) requestRender(180); };
    document.addEventListener('visibilitychange', visibilityChange);
    resize();
    requestRender(180);

    return () => {
      destroyed = true;
      invalidate.current = null;
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener('visibilitychange', visibilityChange);
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerUp);
      scene.remove(clock.group);
      clock.dispose();
      renderer.dispose();
      element.replaceChildren();
    };
  }, [compact]);

  // Time updates render once. Turn/press changes animate long enough for the
  // seesaw to visibly switch direction, including Stockfish's automatic slap.
  useEffect(() => {
    invalidate.current?.(260);
  }, [activeColor, pendingSlap]);

  useEffect(() => {
    invalidate.current?.();
  }, [whiteSeconds, blackSeconds]);

  const canSlap = Boolean(pendingSlap && onSlap && !disabled);
  return (
    <div
      ref={mount}
      className={`qqurz-clock-3d-view ${compact ? 'compact' : ''} ${canSlap ? 'ready' : ''} ${className}`.trim()}
      role={canSlap ? 'button' : 'img'}
      tabIndex={canSlap ? 0 : -1}
      aria-label={pendingSlap ? `${pendingSlap} chess clock — press your rocker` : '3D tournament chess clock'}
      onKeyDown={event => {
        if (!canSlap || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        onSlap?.();
      }}
    />
  );
}
