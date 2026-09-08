import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { multiplayerConfigured } from '../multiplayer/client';
import { createCheckout } from '../tournaments/client';

type Props = { onBack: () => void };
type Role = 'rook' | 'knight' | 'bishop' | 'queen' | 'king' | 'pawn';

function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, y = 0): THREE.Mesh {
  const value = new THREE.Mesh(geometry, material);
  value.position.y = y;
  return value;
}

function makePiece(role: Role, material: THREE.MeshStandardMaterial): THREE.Group {
  const group = new THREE.Group();
  const low = 10;
  group.add(mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.12, low), material, 0.06));
  group.add(mesh(new THREE.CylinderGeometry(0.25, 0.31, 0.10, low), material, 0.17));

  if (role === 'pawn') {
    group.add(mesh(new THREE.CylinderGeometry(0.13, 0.22, 0.42, low), material, 0.40));
    group.add(mesh(new THREE.SphereGeometry(0.18, low, 7), material, 0.69));
  } else if (role === 'rook') {
    group.add(mesh(new THREE.CylinderGeometry(0.20, 0.24, 0.55, low), material, 0.48));
    group.add(mesh(new THREE.CylinderGeometry(0.29, 0.22, 0.18, 8), material, 0.83));
  } else if (role === 'knight') {
    group.add(mesh(new THREE.CylinderGeometry(0.17, 0.24, 0.38, low), material, 0.39));
    const neck = mesh(new THREE.ConeGeometry(0.26, 0.55, 7), material, 0.72);
    neck.rotation.z = -0.34;
    neck.position.x = 0.07;
    group.add(neck);
    const head = mesh(new THREE.BoxGeometry(0.28, 0.22, 0.24), material, 0.93);
    head.rotation.z = -0.22;
    head.position.x = 0.16;
    group.add(head);
  } else if (role === 'bishop') {
    group.add(mesh(new THREE.CylinderGeometry(0.14, 0.23, 0.55, low), material, 0.47));
    group.add(mesh(new THREE.ConeGeometry(0.23, 0.43, low), material, 0.84));
    group.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), material, 1.07));
  } else if (role === 'queen') {
    group.add(mesh(new THREE.CylinderGeometry(0.16, 0.24, 0.64, low), material, 0.50));
    group.add(mesh(new THREE.CylinderGeometry(0.28, 0.18, 0.20, low), material, 0.90));
    group.add(mesh(new THREE.SphereGeometry(0.11, 8, 6), material, 1.08));
  } else {
    group.add(mesh(new THREE.CylinderGeometry(0.16, 0.25, 0.69, low), material, 0.52));
    group.add(mesh(new THREE.SphereGeometry(0.16, 8, 6), material, 0.92));
    group.add(mesh(new THREE.BoxGeometry(0.08, 0.30, 0.08), material, 1.16));
    group.add(mesh(new THREE.BoxGeometry(0.25, 0.07, 0.08), material, 1.18));
  }
  return group;
}

function addStartingPieces(board: THREE.Group, white: THREE.MeshStandardMaterial, black: THREE.MeshStandardMaterial) {
  const back: Role[] = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
  for (let file = 0; file < 8; file += 1) {
    const x = file - 3.5;
    const whiteBack = makePiece(back[file], white);
    whiteBack.position.set(x, 0.10, 3.5);
    board.add(whiteBack);
    const whitePawn = makePiece('pawn', white);
    whitePawn.position.set(x, 0.10, 2.5);
    board.add(whitePawn);
    const blackBack = makePiece(back[file], black);
    blackBack.position.set(x, 0.10, -3.5);
    blackBack.rotation.y = Math.PI;
    board.add(blackBack);
    const blackPawn = makePiece('pawn', black);
    blackPawn.position.set(x, 0.10, -2.5);
    board.add(blackPawn);
  }
}

export default function PremiumBoard3D({ onBack }: Props) {
  const mount = useRef<HTMLDivElement | null>(null);
  const [unlocked, setUnlocked] = useState(() => window.localStorage.getItem('qqurz:3d-pass') === 'test-unlocked');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const element = mount.current;
    if (!element) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(7.4, 7.2, 8.4);
    camera.lookAt(0, 0.4, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: window.devicePixelRatio < 2, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = false;
    element.appendChild(renderer.domElement);

    const root = new THREE.Group();
    scene.add(root);
    const lightSquare = new THREE.MeshStandardMaterial({ color: 0xece7de, roughness: 0.86, metalness: 0.02 });
    const darkSquare = new THREE.MeshStandardMaterial({ color: 0x8d6747, roughness: 0.90, metalness: 0.01 });
    const whitePiece = new THREE.MeshStandardMaterial({ color: 0xf7f6f2, roughness: 0.58, metalness: 0.04 });
    const blackPiece = new THREE.MeshStandardMaterial({ color: 0x15171b, roughness: 0.54, metalness: 0.08 });
    root.add(mesh(new THREE.BoxGeometry(8.55, 0.24, 8.55), new THREE.MeshStandardMaterial({ color: 0x2a211c, roughness: 0.92 }), -0.18));
    for (let rank = 0; rank < 8; rank += 1) {
      for (let file = 0; file < 8; file += 1) {
        const square = mesh(new THREE.BoxGeometry(1, 0.08, 1), (file + rank) % 2 === 0 ? lightSquare : darkSquare, 0);
        square.position.x = file - 3.5;
        square.position.z = rank - 3.5;
        root.add(square);
      }
    }
    addStartingPieces(root, whitePiece, blackPiece);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x3a332e, 2.3));
    const key = new THREE.DirectionalLight(0xffffff, 3.0);
    key.position.set(4, 9, 6);
    scene.add(key);

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
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const down = (event: PointerEvent) => {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
      renderer.domElement.setPointerCapture?.(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      lastX = event.clientX;
      lastY = event.clientY;
      root.rotation.y += dx * 0.008;
      root.rotation.x = THREE.MathUtils.clamp(root.rotation.x + dy * 0.003, -0.22, 0.18);
      render();
    };
    const up = () => { dragging = false; };
    renderer.domElement.addEventListener('pointerdown', down);
    renderer.domElement.addEventListener('pointermove', move);
    renderer.domElement.addEventListener('pointerup', up);
    renderer.domElement.addEventListener('pointercancel', up);
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();

    return () => {
      observer.disconnect();
      renderer.domElement.removeEventListener('pointerdown', down);
      renderer.domElement.removeEventListener('pointermove', move);
      renderer.domElement.removeEventListener('pointerup', up);
      renderer.domElement.removeEventListener('pointercancel', up);
      renderer.dispose();
      scene.traverse(object => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
      lightSquare.dispose(); darkSquare.dispose(); whitePiece.dispose(); blackPiece.dispose();
      element.replaceChildren();
    };
  }, []);

  const unlock = async () => {
    setBusy(true);
    setMessage('');
    try {
      const url = await createCheckout('3d-pass', 'premium3d');
      window.location.assign(url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not open test checkout.');
      setBusy(false);
    }
  };

  const unlockPreview = () => {
    window.localStorage.setItem('qqurz:3d-pass', 'test-unlocked');
    setUnlocked(true);
    setMessage('Local prototype unlock enabled. Production access must be verified by the backend.');
  };

  return (
    <div className="premium-page-v14 qqurz-content-page">
      <section className="page-heading-v14 compact">
        <button className="text-back" onClick={onBack}>← Home</button>
        <span className="qqurz-kicker">PREMIUM 3D</span>
        <h1>A real 3D board, loaded only when requested.</h1>
        <p>Low-poly pieces, capped pixel ratio and on-demand rendering keep the normal 2D chess path lightweight.</p>
      </section>
      <section className="three-board-card">
        <div ref={mount} className="three-board-mount" aria-label="Interactive low-poly 3D chess board preview" />
        {!unlocked && <div className="three-preview-badge">PREVIEW</div>}
        <div className="three-board-help">Drag to rotate</div>
      </section>
      <section className="premium-purchase-v14">
        <div>
          <span>{unlocked ? 'UNLOCKED' : '3D BOARD PASS'}</span>
          <h2>{unlocked ? 'Premium 3D is enabled on this device.' : 'Keep 2D free and fast. Add 3D only if you want it.'}</h2>
          <p>The test checkout price is configurable in the backend. Current prototype default: $4.99.</p>
        </div>
        {unlocked ? (
          <button className="primary-black" onClick={() => setMessage('3D is already enabled for this prototype device.')}>3D enabled</button>
        ) : multiplayerConfigured ? (
          <button className="primary-black" onClick={unlock} disabled={busy}>{busy ? 'Opening checkout…' : 'Unlock with test checkout'}</button>
        ) : (
          <button className="secondary-clean" onClick={unlockPreview}>Local prototype unlock</button>
        )}
      </section>
      {message && <div className="inline-message-v14">{message}</div>}
    </div>
  );
}
