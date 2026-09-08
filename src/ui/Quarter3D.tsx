import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export type QuarterFace = 'heads' | 'tails';

type Props = {
  result: QuarterFace | null;
  flippedAt?: number | null;
  className?: string;
};

// Official U.S. Mint circulating-quarter specifications.
export const QUARTER_DIAMETER_MM = 24.26;
export const QUARTER_THICKNESS_MM = 1.75;
export const QUARTER_REEDS = 119;

// Public-domain U.S. Treasury/Mint photographs hosted by Wikimedia Commons.
// The procedural texture below remains only as an offline fallback.
const REAL_QUARTER_FACES = {
  heads: 'https://upload.wikimedia.org/wikipedia/commons/7/70/2021-P_US_Quarter_Obverse.jpg',
  tails: 'https://upload.wikimedia.org/wikipedia/commons/e/eb/United_States_Quarter_Reverse_2021.jpg',
} as const;

function fallbackTexture(side: QuarterFace): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 768;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is required for the quarter fallback texture.');
  const gradient = ctx.createRadialGradient(290, 255, 45, 384, 384, 380);
  gradient.addColorStop(0, '#f5f6f7');
  gradient.addColorStop(.46, '#c7ccd0');
  gradient.addColorStop(.82, '#959ca2');
  gradient.addColorStop(1, '#e2e5e7');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 768, 768);
  ctx.save();
  ctx.translate(384, 384);
  ctx.strokeStyle = 'rgba(52,58,63,.58)';
  ctx.fillStyle = 'rgba(58,64,70,.52)';
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(0, 0, 355, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 333, 0, Math.PI * 2); ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = '700 42px Georgia, serif';
  ctx.fillText(side === 'heads' ? 'LIBERTY' : 'UNITED STATES OF AMERICA', 0, -255);
  if (side === 'heads') {
    ctx.beginPath();
    ctx.moveTo(-56, 164); ctx.bezierCurveTo(-117, 79, -105, -100, 18, -185);
    ctx.bezierCurveTo(95, -207, 124, -127, 112, -70); ctx.bezierCurveTo(158, -42, 115, 76, 31, 116);
    ctx.bezierCurveTo(-11, 138, -30, 156, -36, 184); ctx.closePath(); ctx.fill();
    ctx.font = '700 24px Georgia, serif'; ctx.fillText('IN GOD WE TRUST', -130, 192); ctx.fillText('2021', 0, 272);
  } else {
    ctx.beginPath();
    ctx.moveTo(-235, -80); ctx.bezierCurveTo(-153, -119, -71, -105, 0, -51);
    ctx.bezierCurveTo(71, -105, 153, -119, 235, -80); ctx.bezierCurveTo(155, -20, 112, 30, 0, 49);
    ctx.bezierCurveTo(-112, 30, -155, -20, -235, -80); ctx.closePath(); ctx.fill();
    ctx.font = '800 44px Georgia, serif'; ctx.fillText('25¢', 0, 170); ctx.font = '700 26px Georgia, serif'; ctx.fillText('QUARTER DOLLAR', 0, 262);
  }
  ctx.restore();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function loadRealFace(url: string, target: THREE.MeshPhysicalMaterial, renderer: THREE.WebGLRenderer, disposed: () => boolean) {
  const loader = new THREE.TextureLoader();
  loader.setCrossOrigin('anonymous');
  loader.load(url, texture => {
    if (disposed()) { texture.dispose(); return; }
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    const old = target.map;
    target.map = texture;
    target.needsUpdate = true;
    old?.dispose();
  }, undefined, () => {
    // Keep the in-bundle fallback if the photo cannot be fetched offline.
  });
}

export default function Quarter3D({ result, flippedAt = null, className = '' }: Props) {
  const mount = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef<QuarterFace | null>(result);
  const flippedAtRef = useRef<number | null>(flippedAt ?? null);
  useEffect(() => { resultRef.current = result; flippedAtRef.current = flippedAt ?? null; }, [flippedAt, result]);

  useEffect(() => {
    const element = mount.current;
    if (!element) return;
    let isDisposed = false;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(27, 1, .1, 100);
    camera.position.set(0, 2.4, 34);
    camera.lookAt(0, 0, 0);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.8));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.setClearColor(0x000000, 0);
    element.replaceChildren(renderer.domElement);

    const radius = QUARTER_DIAMETER_MM * .5;
    const thickness = QUARTER_THICKNESS_MM;
    const coin = new THREE.Group();
    coin.userData.spec = { diameterMm: QUARTER_DIAMETER_MM, thicknessMm: QUARTER_THICKNESS_MM, reeds: QUARTER_REEDS, weightGrams: 5.67 };
    scene.add(coin);

    const edgeMat = new THREE.MeshPhysicalMaterial({ color: 0xb9bec3, roughness: .31, metalness: .92, clearcoat: .19, clearcoatRoughness: .32 });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, thickness, QUARTER_REEDS, 2, false), edgeMat);
    core.rotation.x = Math.PI / 2;
    core.castShadow = true;
    core.receiveShadow = true;
    coin.add(core);

    const headsFallback = fallbackTexture('heads');
    const tailsFallback = fallbackTexture('tails');
    const headsMat = new THREE.MeshPhysicalMaterial({ map: headsFallback, color: 0xffffff, roughness: .40, metalness: .70, clearcoat: .12, clearcoatRoughness: .45 });
    const tailsMat = new THREE.MeshPhysicalMaterial({ map: tailsFallback, color: 0xffffff, roughness: .40, metalness: .70, clearcoat: .12, clearcoatRoughness: .45 });
    const faceGeo = new THREE.CircleGeometry(radius * .985, 128);
    const heads = new THREE.Mesh(faceGeo, headsMat);
    heads.position.z = thickness * .505;
    coin.add(heads);
    const tailsGeo = faceGeo.clone();
    const tails = new THREE.Mesh(tailsGeo, tailsMat);
    tails.rotation.y = Math.PI;
    tails.position.z = -thickness * .505;
    coin.add(tails);

    loadRealFace(REAL_QUARTER_FACES.heads, headsMat, renderer, () => isDisposed);
    loadRealFace(REAL_QUARTER_FACES.tails, tailsMat, renderer, () => isDisposed);

    // Exactly 119 modeled reeds, matching the Mint specification.
    const reedGeo = new THREE.BoxGeometry(.16, .48, thickness * 1.04);
    const reedMat = new THREE.MeshStandardMaterial({ color: 0x8c9298, roughness: .43, metalness: .84 });
    const reeds = new THREE.InstancedMesh(reedGeo, reedMat, QUARTER_REEDS);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    const axis = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < QUARTER_REEDS; i += 1) {
      const a = i / QUARTER_REEDS * Math.PI * 2;
      pos.set(Math.cos(a) * (radius + .055), Math.sin(a) * (radius + .055), 0);
      quat.setFromAxisAngle(axis, a);
      matrix.compose(pos, quat, scale);
      reeds.setMatrixAt(i, matrix);
    }
    reeds.instanceMatrix.needsUpdate = true;
    coin.add(reeds);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x27303a, 2.55));
    const key = new THREE.DirectionalLight(0xffffff, 4.9); key.position.set(-12, 16, 22); scene.add(key);
    const rim = new THREE.DirectionalLight(0xc9dcff, 2.2); rim.position.set(16, -4, 10); scene.add(rim);
    const warm = new THREE.PointLight(0xffe8c9, 11, 60); warm.position.set(-10, -7, 18); scene.add(warm);

    let frame = 0;
    const started = performance.now();
    const animate = (now: number) => {
      const target = resultRef.current;
      const serverStart = flippedAtRef.current;
      const idleTime = (now - started) / 1000;
      if (target && serverStart) {
        const elapsed = Math.max(0, Date.now() - serverStart);
        const p = THREE.MathUtils.clamp(elapsed / 1900, 0, 1);
        const ease = 1 - Math.pow(1 - p, 4);
        const finalTurn = target === 'heads' ? 0 : Math.PI;
        coin.rotation.y = (1 - ease) * (Math.PI * 10) + finalTurn;
        coin.rotation.x = Math.sin(p * Math.PI * 7) * .28 * (1 - ease);
        coin.rotation.z = Math.sin(p * Math.PI * 4) * .18 * (1 - ease);
        coin.position.y = Math.sin(p * Math.PI) * 5.6;
      } else if (target) {
        coin.rotation.y = target === 'heads' ? 0 : Math.PI;
        coin.rotation.x = -.08;
        coin.rotation.z = 0;
        coin.position.y = 0;
      } else {
        coin.rotation.y = .20 + Math.sin(idleTime * .55) * .09;
        coin.rotation.x = -.12 + Math.sin(idleTime * .72) * .04;
        coin.rotation.z = Math.sin(idleTime * .47) * .025;
        coin.position.y = Math.sin(idleTime * .9) * .17;
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };

    const resize = () => {
      const rect = element.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    frame = requestAnimationFrame(animate);

    return () => {
      isDisposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.dispose();
      headsMat.map?.dispose(); tailsMat.map?.dispose();
      headsMat.dispose(); tailsMat.dispose();
      faceGeo.dispose(); tailsGeo.dispose();
      core.geometry.dispose(); edgeMat.dispose(); reedGeo.dispose(); reedMat.dispose();
      element.replaceChildren();
    };
  }, []);

  return (
    <div className="qqurz-quarter-wrap">
      <div ref={mount} className={`qqurz-quarter-3d ${className}`.trim()} aria-label="Realistic three-dimensional U.S. quarter" />
      <small className="qqurz-quarter-spec">24.26 mm × 1.75 mm · 119 reeds</small>
    </div>
  );
}
