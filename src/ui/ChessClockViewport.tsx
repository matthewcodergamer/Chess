import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  animateChessClockRocker,
  createChessClockModel,
  disposeChessClockModel,
  updateChessClockModel,
  type ChessClockModel,
  type ClockSide,
} from '../premium/ChessClock3D';

type Props = {
  whiteSeconds: number;
  blackSeconds: number;
  pendingSlap: ClockSide | null;
  phase: 'setup' | 'strategy' | 'playing' | 'ended';
  disabled?: boolean;
  onSlap?: () => void;
  className?: string;
};

type ViewHandle = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  model: ChessClockModel;
};

export default function ChessClockViewport({
  whiteSeconds,
  blackSeconds,
  pendingSlap,
  phase,
  disabled = false,
  onSlap,
  className = '',
}: Props) {
  const mount = useRef<HTMLDivElement | null>(null);
  const handle = useRef<ViewHandle | null>(null);
  const previousPending = useRef<ClockSide | null>(pendingSlap);
  const slapRef = useRef(onSlap);
  const disabledRef = useRef(disabled);
  const pendingRef = useRef<ClockSide | null>(pendingSlap);
  slapRef.current = onSlap;
  disabledRef.current = disabled;
  pendingRef.current = pendingSlap;

  useEffect(() => {
    const element = mount.current;
    if (!element) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x17191b);
    const camera = new THREE.PerspectiveCamera(25, 1, 0.1, 50);
    camera.position.set(0, 6.65, 5.25);
    camera.lookAt(0, 0.50, 0.02);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    element.replaceChildren(renderer.domElement);

    const model = createChessClockModel();
    model.group.scale.setScalar(0.92);
    model.group.position.y = 0.02;
    scene.add(model.group);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(8.4, 6.5),
      new THREE.MeshStandardMaterial({ color: 0x232629, roughness: 0.98 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.06;
    floor.receiveShadow = true;
    scene.add(floor);

    scene.add(new THREE.AmbientLight(0xffffff, 0.68));
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3b3f43, 1.55));
    const key = new THREE.DirectionalLight(0xffffff, 2.7);
    key.position.set(-2.8, 6.5, 4.5);
    key.castShadow = true;
    key.shadow.mapSize.set(768, 768);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xcfe1ff, 0.8);
    fill.position.set(4, 3, -3);
    scene.add(fill);

    const render = () => renderer.render(scene, camera);
    const resize = () => {
      const rect = element.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const height = Math.max(1, rect.height);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();

    const raycaster = new THREE.Raycaster();
    const pickSide = (event: PointerEvent): ClockSide | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, camera);
      return (raycaster.intersectObjects(model.hitMeshes, false)[0]?.object.userData.clockSide as ClockSide | undefined) ?? null;
    };
    const pointerDown = (event: PointerEvent) => {
      if (disabledRef.current) return;
      const side = pickSide(event);
      if (!side || side !== pendingRef.current) return;
      event.preventDefault();
      animateChessClockRocker(model, side, render);
      slapRef.current?.();
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown, { passive: false });

    handle.current = { scene, camera, renderer, model };
    return () => {
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', pointerDown);
      disposeChessClockModel(model);
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
      handle.current = null;
      element.replaceChildren();
    };
  }, []);

  useEffect(() => {
    const current = handle.current;
    if (!current) return;
    updateChessClockModel(current.model, whiteSeconds, blackSeconds, pendingSlap, phase);
    current.renderer.render(current.scene, current.camera);
  }, [blackSeconds, pendingSlap, phase, whiteSeconds]);

  useEffect(() => {
    const previous = previousPending.current;
    previousPending.current = pendingSlap;
    const current = handle.current;
    if (!current || !previous || pendingSlap !== null) return;
    animateChessClockRocker(current.model, previous, () => current.renderer.render(current.scene, current.camera));
  }, [pendingSlap]);

  return (
    <div className={`qqurz-clock-viewport ${disabled ? 'disabled' : ''} ${pendingSlap && !disabled ? 'ready-to-slap' : ''} ${className}`.trim()}>
      <div ref={mount} className="qqurz-clock-canvas" aria-label="Interactive top-down QQURZ chess clock" />
      <div className="qqurz-clock-status" aria-hidden="true">
        {pendingSlap && !disabled ? `SLAP ${pendingSlap.toUpperCase()}` : 'LIVE CLOCK'}
      </div>
    </div>
  );
}
