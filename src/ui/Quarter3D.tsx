import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export type QuarterFace = 'heads' | 'tails';

type Props = {
  result: QuarterFace | null;
  flippedAt?: number | null;
  className?: string;
};

// U.S. Mint circulating-quarter specifications.
export const QUARTER_DIAMETER_MM = 24.26;
export const QUARTER_THICKNESS_MM = 1.75;
export const QUARTER_REEDS = 119;

function makeFaceTexture(side: QuarterFace): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is required for the quarter texture.');

  const gradient = ctx.createRadialGradient(420, 350, 80, 512, 512, 510);
  gradient.addColorStop(0, '#f2f4f5');
  gradient.addColorStop(.45, '#c6cbd0');
  gradient.addColorStop(.76, '#9aa1a7');
  gradient.addColorStop(1, '#d8dbde');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 1024, 1024);

  ctx.save();
  ctx.translate(512, 512);
  ctx.strokeStyle = 'rgba(52,58,63,.58)';
  ctx.fillStyle = 'rgba(64,70,76,.48)';
  ctx.lineWidth = 12;
  ctx.beginPath(); ctx.arc(0, 0, 472, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 446, 0, Math.PI * 2); ctx.stroke();

  if (side === 'heads') {
    // Readable Washington-quarter obverse treatment. The relief is intentionally
    // graphic rather than photographic so lighting still sells it as minted metal.
    ctx.font = '700 54px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('LIBERTY', 0, -336);
    ctx.font = '650 28px Georgia, serif';
    ctx.fillText('IN GOD WE TRUST', -178, 238);
    ctx.fillText('QUARTER DOLLAR', 0, 360);

    ctx.beginPath();
    ctx.moveTo(-82, 205);
    ctx.bezierCurveTo(-146, 120, -154, 4, -112, -120);
    ctx.bezierCurveTo(-83, -205, -23, -250, 50, -236);
    ctx.bezierCurveTo(96, -227, 129, -188, 122, -146);
    ctx.bezierCurveTo(116, -113, 139, -89, 174, -73);
    ctx.bezierCurveTo(130, -49, 112, -12, 114, 25);
    ctx.bezierCurveTo(115, 83, 77, 125, 22, 150);
    ctx.bezierCurveTo(-14, 168, -41, 188, -47, 222);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(242,245,247,.62)';
    ctx.lineWidth = 7;
    ctx.stroke();
    ctx.font = '700 30px Georgia, serif';
    ctx.fillStyle = 'rgba(58,64,70,.55)';
    ctx.fillText('WASHINGTON', 0, 300);
  } else {
    ctx.font = '700 38px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.fillText('UNITED STATES OF AMERICA', 0, -344);
    ctx.font = '650 30px Georgia, serif';
    ctx.fillText('E PLURIBUS UNUM', 0, 272);
    ctx.font = '750 40px Georgia, serif';
    ctx.fillText('QUARTER DOLLAR', 0, 350);

    // Raised eagle silhouette for a familiar quarter reverse.
    ctx.beginPath();
    ctx.moveTo(0, -88);
    ctx.bezierCurveTo(-74, -145, -166, -160, -272, -125);
    ctx.bezierCurveTo(-208, -76, -170, -25, -143, 39);
    ctx.bezierCurveTo(-87, 5, -43, 2, 0, 33);
    ctx.bezierCurveTo(43, 2, 87, 5, 143, 39);
    ctx.bezierCurveTo(170, -25, 208, -76, 272, -125);
    ctx.bezierCurveTo(166, -160, 74, -145, 0, -88);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-58, 42); ctx.lineTo(0, 128); ctx.lineTo(58, 42); ctx.lineTo(0, 66); ctx.closePath(); ctx.fill();
    ctx.font = '800 56px Georgia, serif';
    ctx.fillText('25¢', 0, 214);
  }

  // Fine radial mint marks catch the light without turning the face into a flat image.
  ctx.strokeStyle = 'rgba(255,255,255,.19)';
  ctx.lineWidth = 2;
  for (let i = 0; i < 72; i += 1) {
    const a = i / 72 * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 408, Math.sin(a) * 408);
    ctx.lineTo(Math.cos(a) * 432, Math.sin(a) * 432);
    ctx.stroke();
  }
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export default function Quarter3D({ result, flippedAt = null, className = '' }: Props) {
  const mount = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef<QuarterFace | null>(result);
  const flippedAtRef = useRef<number | null>(flippedAt ?? null);

  useEffect(() => { resultRef.current = result; flippedAtRef.current = flippedAt ?? null; }, [flippedAt, result]);

  useEffect(() => {
    const element = mount.current;
    if (!element) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(27, 1, .1, 100);
    camera.position.set(0, 2.4, 34);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
    renderer.setClearColor(0x000000, 0);
    element.replaceChildren(renderer.domElement);

    const radius = QUARTER_DIAMETER_MM * .5;
    const thickness = QUARTER_THICKNESS_MM;
    const coin = new THREE.Group();
    coin.userData.spec = { diameterMm: QUARTER_DIAMETER_MM, thicknessMm: QUARTER_THICKNESS_MM, reeds: QUARTER_REEDS };
    scene.add(coin);

    const edgeMat = new THREE.MeshPhysicalMaterial({ color: 0xb9bec3, roughness: .34, metalness: .91, clearcoat: .18, clearcoatRoughness: .34 });
    const core = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, thickness, QUARTER_REEDS, 2, false), edgeMat);
    core.rotation.x = Math.PI / 2;
    core.castShadow = true;
    core.receiveShadow = true;
    coin.add(core);

    const headsTexture = makeFaceTexture('heads');
    const tailsTexture = makeFaceTexture('tails');
    const headsMat = new THREE.MeshPhysicalMaterial({ map: headsTexture, color: 0xffffff, roughness: .40, metalness: .78, clearcoat: .16, clearcoatRoughness: .42, side: THREE.FrontSide });
    const tailsMat = new THREE.MeshPhysicalMaterial({ map: tailsTexture, color: 0xffffff, roughness: .40, metalness: .78, clearcoat: .16, clearcoatRoughness: .42, side: THREE.FrontSide });
    const faceGeo = new THREE.CircleGeometry(radius * .985, 128);
    const heads = new THREE.Mesh(faceGeo, headsMat);
    heads.position.z = thickness * .505;
    coin.add(heads);
    const tails = new THREE.Mesh(faceGeo.clone(), tailsMat);
    tails.rotation.y = Math.PI;
    tails.position.z = -thickness * .505;
    coin.add(tails);

    // The Mint specifies 119 reeds. Instancing keeps all 119 actual edge ridges cheap on mobile.
    const reedGeo = new THREE.BoxGeometry(.16, .48, thickness * 1.035);
    const reedMat = new THREE.MeshStandardMaterial({ color: 0x8e9499, roughness: .48, metalness: .82 });
    const reeds = new THREE.InstancedMesh(reedGeo, reedMat, QUARTER_REEDS);
    const matrix = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < QUARTER_REEDS; i += 1) {
      const a = i / QUARTER_REEDS * Math.PI * 2;
      pos.set(Math.cos(a) * (radius + .055), Math.sin(a) * (radius + .055), 0);
      quat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a);
      matrix.compose(pos, quat, scale);
      reeds.setMatrixAt(i, matrix);
    }
    reeds.instanceMatrix.needsUpdate = true;
    coin.add(reeds);

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(18, 64),
      new THREE.ShadowMaterial({ color: 0x000000, transparent: true, opacity: .23 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -13.4;
    floor.receiveShadow = true;
    scene.add(floor);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x27303a, 2.4));
    const key = new THREE.DirectionalLight(0xffffff, 5.2); key.position.set(-12, 16, 22); key.castShadow = true; scene.add(key);
    const rim = new THREE.DirectionalLight(0xbcd6ff, 2.4); rim.position.set(16, -4, 10); scene.add(rim);
    const warm = new THREE.PointLight(0xffe4bf, 14, 60); warm.position.set(-10, -7, 18); scene.add(warm);

    let frame = 0;
    const started = performance.now();
    const animate = (now: number) => {
      const target = resultRef.current;
      const serverStart = flippedAtRef.current;
      let t = (now - started) / 1000;
      if (target && serverStart) {
        const elapsed = Math.max(0, Date.now() - serverStart);
        const p = THREE.MathUtils.clamp(elapsed / 1850, 0, 1);
        const ease = 1 - Math.pow(1 - p, 4);
        const finalTurn = target === 'heads' ? 0 : Math.PI;
        coin.rotation.y = (1 - ease) * (Math.PI * 8.5) + finalTurn;
        coin.rotation.x = Math.sin(p * Math.PI * 7) * .24 * (1 - ease);
        coin.rotation.z = Math.sin(p * Math.PI * 4) * .14 * (1 - ease);
        coin.position.y = Math.sin(Math.min(1, p) * Math.PI) * 5.2;
      } else if (target) {
        coin.rotation.y = target === 'heads' ? 0 : Math.PI;
        coin.rotation.x = -.08;
        coin.position.y = 0;
      } else {
        t = (now - started) / 1000;
        coin.rotation.y = .22 + Math.sin(t * .55) * .10;
        coin.rotation.x = -.12 + Math.sin(t * .72) * .045;
        coin.rotation.z = Math.sin(t * .47) * .025;
        coin.position.y = Math.sin(t * .9) * .18;
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };

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
    frame = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.dispose();
      headsTexture.dispose(); tailsTexture.dispose();
      faceGeo.dispose(); heads.geometry.dispose(); tails.geometry.dispose();
      headsMat.dispose(); tailsMat.dispose(); core.geometry.dispose(); edgeMat.dispose(); reedGeo.dispose(); reedMat.dispose(); floor.geometry.dispose(); (floor.material as THREE.Material).dispose();
      element.replaceChildren();
    };
  }, []);

  return <div ref={mount} className={`qqurz-quarter-3d ${className}`.trim()} aria-label="Three-dimensional U.S. quarter, 24.26 millimeter diameter, 1.75 millimeter thickness, 119 reeds" />;
}
