import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export type ThreePerformanceSnapshot = {
  targetFps: 60;
  recentFps: number;
  qualityScale: number;
  shadowsEnabled: boolean;
  slowFrameCount: number;
};

export type RenderScheduler = {
  render: () => void;
  setViewportVisible: (visible: boolean) => void;
  dispose: () => void;
  snapshot: () => ThreePerformanceSnapshot;
};

declare global {
  interface Window { __QQURZ_3D_PERFORMANCE__?: () => ThreePerformanceSnapshot; }
}

function isIOS(): boolean { return /iPhone|iPad|iPod/i.test(navigator.userAgent); }
export function lowerPower3DDevice(): boolean {
  return isIOS() && (navigator.hardwareConcurrency || 4) <= 6;
}

export function webglPowerPreference(): WebGLPowerPreference {
  return lowerPower3DDevice() ? 'low-power' : 'high-performance';
}

export function cappedPixelRatio(): number {
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const cores = navigator.hardwareConcurrency || 4;
  if (isIOS() && cores <= 6) return Math.min(dpr, 1.25);
  if (isIOS()) return Math.min(dpr, 1.5);
  return Math.min(dpr, cores <= 4 ? 1.5 : 2);
}

export function shadowMapSize(): number {
  const cores = navigator.hardwareConcurrency || 4;
  if (isIOS() && cores <= 6) return 384;
  return isIOS() ? 640 : 1024;
}

export function createRenderScheduler(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, controls: OrbitControls): RenderScheduler {
  let frame = 0;
  let lastFrameAt = 0;
  let qualityScale = 1;
  let slowFrameCount = 0;
  let recentFps = 60;
  let viewportVisible = true;
  const baseDpr = cappedPixelRatio();

  const isActive = () => viewportVisible && document.visibilityState !== 'hidden';
  const cancelFrame = () => {
    if (!frame) return;
    cancelAnimationFrame(frame);
    frame = 0;
    lastFrameAt = 0;
  };

  const applyQuality = (next: number) => {
    if (next >= qualityScale) return;
    qualityScale = next;
    const size = renderer.getSize(new THREE.Vector2());
    renderer.setPixelRatio(Math.max(1, baseDpr * qualityScale));
    renderer.setSize(size.x, size.y, false);
    if (qualityScale <= .72) renderer.shadowMap.enabled = false;
    renderer.domElement.dataset.renderQuality = qualityScale.toFixed(2);
  };

  const snapshot = (): ThreePerformanceSnapshot => ({
    targetFps: 60,
    recentFps: Math.round(recentFps),
    qualityScale,
    shadowsEnabled: renderer.shadowMap.enabled,
    slowFrameCount,
  });
  window.__QQURZ_3D_PERFORMANCE__ = snapshot;

  const render = () => {
    if (!isActive() || frame) return;
    frame = requestAnimationFrame(now => {
      frame = 0;
      if (!isActive()) return;
      if (lastFrameAt > 0) {
        const delta = Math.max(1, now - lastFrameAt);
        if (delta <= 100) {
          const instantFps = Math.min(60, 1000 / delta);
          recentFps = recentFps * .82 + instantFps * .18;
          if (delta > 20) slowFrameCount += 1;
          else slowFrameCount = Math.max(0, slowFrameCount - 1);
        } else {
          recentFps = 60;
          slowFrameCount = Math.max(0, slowFrameCount - 2);
        }
        if (slowFrameCount >= 16) applyQuality(.68);
        else if (slowFrameCount >= 8) applyQuality(.82);
      }
      lastFrameAt = now;
      const renderStart = performance.now();
      renderer.render(scene, camera);
      if (performance.now() - renderStart > 14) slowFrameCount += 1;
    });
  };

  const syncVisibility = () => {
    controls.enabled = isActive();
    if (!isActive()) cancelFrame();
    else render();
  };
  const visibility = () => syncVisibility();
  const setViewportVisible = (visible: boolean) => {
    viewportVisible = visible;
    syncVisibility();
  };

  controls.addEventListener('change', render);
  document.addEventListener('visibilitychange', visibility);
  return {
    render,
    setViewportVisible,
    snapshot,
    dispose: () => {
      controls.removeEventListener('change', render);
      document.removeEventListener('visibilitychange', visibility);
      cancelFrame();
      if (window.__QQURZ_3D_PERFORMANCE__ === snapshot) delete window.__QQURZ_3D_PERFORMANCE__;
    },
  };
}
