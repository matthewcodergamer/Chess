import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type RenderScheduler = {
  render: () => void;
  dispose: () => void;
};

export function cappedPixelRatio(): number {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency || 4;
  if (ios && cores <= 6) return Math.min(dpr, 1.25);
  if (ios) return Math.min(dpr, 1.5);
  return Math.min(dpr, cores <= 4 ? 1.5 : 2);
}

export function shadowMapSize(): number {
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const cores = navigator.hardwareConcurrency || 4;
  if (ios && cores <= 6) return 512;
  return ios ? 768 : 1024;
}

export function createRenderScheduler(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, controls: OrbitControls): RenderScheduler {
  let frame = 0;
  const render = () => {
    if (document.visibilityState === 'hidden' || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      renderer.render(scene, camera);
    });
  };
  const visibility = () => {
    const visible = document.visibilityState !== 'hidden';
    controls.enabled = visible;
    if (!visible && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else if (visible) render();
  };
  controls.addEventListener('change', render);
  document.addEventListener('visibilitychange', visibility);
  return {
    render,
    dispose: () => {
      controls.removeEventListener('change', render);
      document.removeEventListener('visibilitychange', visibility);
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
