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

/**
 * The normal board is 2D, but the clock is not. This component renders the exact
 * same volumetric clock used by Premium 3D from a restrained front/three-quarter
 * camera so the body depth and seesaw rocker remain visible.
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
  const state = useRef({ whiteSeconds, blackSeconds, activeColor, pendingSlap, disabled, onSlap });
  state.current = { whiteSeconds, blackSeconds, activeColor, pendingSlap, disabled, onSlap };

  useEffect(() => {
    const element = mount.current;
    if (!element) return;

    const scene = new THREE.Scene();
    scene.background = null;
    const camera = new THREE.PerspectiveCamera(compact ? 31 : 29, 1, .1, 60);
    camera.position.set(0, 3.25, 8.55);
    camera.lookAt(0, .52, .12);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.touchAction = 'manipulation';
    element.replaceChildren(renderer.domElement);

    const clock = createChessClock3D();
    clock.group.scale.setScalar(compact ? 1.03 : 1.08);
    clock.group.position.set(0, -.02, 0);
    scene.add(clock.group);

    // A small receiving plane gives the clock believable contact shadow without
    // introducing another visible UI surface.
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(7.2, 5.4),
      new THREE.ShadowMaterial({ color: 0x000000, transparent: true, opacity: .19 }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -.03;
    shadow.receiveShadow = true;
    scene.add(shadow);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x30343a, 2.45));
    const key = new THREE.DirectionalLight(0xffffff, 4.2);
    key.position.set(-4.4, 7.5, 7.2);
    key.castShadow = true;
    key.shadow.mapSize.set(768, 768);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xdde8ff, 1.55);
    fill.position.set(5.2, 3.4, 3.4);
    scene.add(fill);
    const warm = new THREE.PointLight(0xffead5, 5.2, 20);
    warm.position.set(-3.2, 1.5, 5.8);
    scene.add(warm);

    const ray = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pressed = false;
    let moved = false;
    let downX = 0;
    let downY = 0;

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
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();

    let frame = 0;
    let last = 0;
    const animate = (now: number) => {
      // 30fps is enough for the very small clock scene and materially reduces GPU
      // work on iPhone while keeping the rocker response fluid.
      if (now - last >= 31) {
        last = now;
        const value = state.current;
        clock.update(value.whiteSeconds, value.blackSeconds, value.activeColor, value.pendingSlap);
        renderer.render(scene, camera);
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      renderer.domElement.removeEventListener('pointermove', pointerMove);
      renderer.domElement.removeEventListener('pointerup', pointerUp);
      renderer.domElement.removeEventListener('pointercancel', pointerUp);
      scene.remove(clock.group);
      clock.dispose();
      shadow.geometry.dispose();
      (shadow.material as THREE.Material).dispose();
      renderer.dispose();
      element.replaceChildren();
    };
  }, [compact]);

  const canSlap = Boolean(pendingSlap && onSlap && !disabled);
  return (
    <div
      ref={mount}
      className={`qqurz-clock-3d-view ${compact ? 'compact' : ''} ${canSlap ? 'ready' : ''} ${className}`.trim()}
      role={canSlap ? 'button' : 'img'}
      tabIndex={canSlap ? 0 : -1}
      aria-label={pendingSlap ? `${pendingSlap} 3D chess clock — press the white rocker` : '3D tournament chess clock'}
      onKeyDown={event => {
        if (!canSlap || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        onSlap?.();
      }}
    />
  );
}
