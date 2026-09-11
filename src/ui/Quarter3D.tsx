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
export const QUARTER_WEIGHT_GRAMS = 5.67;

// Public-domain photographs are fetched at build time. They provide the real
// Washington obverse and Crossing the Delaware reverse instead of synthesized
// coin artwork.
const QUARTER_FACES = {
  heads: `${import.meta.env.BASE_URL}coins/quarter-obverse-2021.jpg`,
  tails: `${import.meta.env.BASE_URL}coins/quarter-reverse-2021.jpg`,
} as const;

function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

function configureTexture(texture: THREE.Texture, renderer: THREE.WebGLRenderer, compact: boolean): void {
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(compact ? 6 : 12, renderer.capabilities.getMaxAnisotropy());
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
}

export default function Quarter3D({ result, flippedAt = null, className = '' }: Props) {
  const mount = useRef<HTMLDivElement | null>(null);
  const resultRef = useRef<QuarterFace | null>(result);
  const flippedAtRef = useRef<number | null>(flippedAt ?? null);

  useEffect(() => {
    resultRef.current = result;
    flippedAtRef.current = flippedAt ?? null;
  }, [flippedAt, result]);

  useEffect(() => {
    const element = mount.current;
    if (!element) return;

    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const compact = window.matchMedia('(max-width: 760px)').matches || deviceMemory <= 4;
    const radialSegments = compact ? 96 : 160;
    const shadowSegments = compact ? 48 : 72;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 140);
    camera.position.set(0, 1.2, 58);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.35 : 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    // The soft contact shadow below is a tiny transparent mesh. Disabling the
    // full shadow-map pipeline saves GPU memory/bandwidth on mobile.
    renderer.shadowMap.enabled = false;
    renderer.setClearColor(0x000000, 0);
    element.replaceChildren(renderer.domElement);

    const radius = QUARTER_DIAMETER_MM * 0.5;
    const halfThickness = QUARTER_THICKNESS_MM * 0.5;
    const coin = new THREE.Group();
    coin.userData.spec = {
      diameterMm: QUARTER_DIAMETER_MM,
      thicknessMm: QUARTER_THICKNESS_MM,
      reeds: QUARTER_REEDS,
      weightGrams: QUARTER_WEIGHT_GRAMS,
      design: '2021 General George Washington Crossing the Delaware Quarter',
    };
    scene.add(coin);

    const textureLoader = new THREE.TextureLoader();
    const headsTexture = textureLoader.load(QUARTER_FACES.heads, texture => configureTexture(texture, renderer, compact));
    const tailsTexture = textureLoader.load(QUARTER_FACES.tails, texture => configureTexture(texture, renderer, compact));

    const faceGeometry = new THREE.CircleGeometry(radius * 0.982, radialSegments);
    const faceBase = {
      color: 0xf7f8f9,
      metalness: 0.68,
      roughness: 0.39,
      clearcoat: 0.14,
      clearcoatRoughness: 0.42,
      envMapIntensity: 0.9,
    } as const;

    // The real photography supplies the actual relief artwork. Reusing each
    // face as a shallow bump map makes the engraving react to studio lighting.
    const headsMaterial = new THREE.MeshPhysicalMaterial({
      ...faceBase,
      map: headsTexture,
      bumpMap: headsTexture,
      bumpScale: 0.055,
    });
    const tailsMaterial = new THREE.MeshPhysicalMaterial({
      ...faceBase,
      map: tailsTexture,
      bumpMap: tailsTexture,
      bumpScale: 0.055,
    });

    const heads = new THREE.Mesh(faceGeometry, headsMaterial);
    heads.position.z = halfThickness + 0.025;
    coin.add(heads);

    const tailsGeometry = faceGeometry.clone();
    const tails = new THREE.Mesh(tailsGeometry, tailsMaterial);
    tails.position.z = -(halfThickness + 0.025);
    tails.rotation.y = Math.PI;
    coin.add(tails);

    const edgeMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xc7cbd0,
      metalness: 0.94,
      roughness: 0.3,
      clearcoat: 0.2,
      clearcoatRoughness: 0.28,
    });
    const edgeGeometry = new THREE.CylinderGeometry(radius, radius, QUARTER_THICKNESS_MM, radialSegments, 1, false);
    const edge = new THREE.Mesh(edgeGeometry, edgeMaterial);
    edge.rotation.x = Math.PI / 2;
    coin.add(edge);

    // Raised rims preserve the physical silhouette and make the 1.75 mm edge
    // thickness visible at the oblique camera angle.
    const rimGeometry = new THREE.TorusGeometry(radius * 0.972, 0.13, compact ? 6 : 8, radialSegments);
    const rimMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xd5d8dc,
      metalness: 0.96,
      roughness: 0.26,
      clearcoat: 0.18,
    });
    const frontRim = new THREE.Mesh(rimGeometry, rimMaterial);
    frontRim.position.z = halfThickness + 0.055;
    coin.add(frontRim);
    const backRimGeometry = rimGeometry.clone();
    const backRim = new THREE.Mesh(backRimGeometry, rimMaterial);
    backRim.position.z = -(halfThickness + 0.055);
    coin.add(backRim);

    // Keep every one of the Mint-spec 119 reeds. Instancing makes them a single
    // draw call, so authenticity does not require 119 independent meshes.
    const reedGeometry = new THREE.BoxGeometry(0.14, 0.58, QUARTER_THICKNESS_MM * 1.045);
    const reedMaterial = new THREE.MeshStandardMaterial({
      color: 0x8f959b,
      metalness: 0.9,
      roughness: 0.38,
    });
    const reeds = new THREE.InstancedMesh(reedGeometry, reedMaterial, QUARTER_REEDS);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);
    const zAxis = new THREE.Vector3(0, 0, 1);
    for (let i = 0; i < QUARTER_REEDS; i += 1) {
      const angle = (i / QUARTER_REEDS) * Math.PI * 2;
      position.set(Math.cos(angle) * (radius + 0.07), Math.sin(angle) * (radius + 0.07), 0);
      quaternion.setFromAxisAngle(zAxis, angle);
      matrix.compose(position, quaternion, scale);
      reeds.setMatrixAt(i, matrix);
    }
    reeds.instanceMatrix.needsUpdate = true;
    coin.add(reeds);

    // A small fixed studio-light rig gives readable relief and realistic metal
    // without environment maps or dynamic shadows.
    scene.add(new THREE.HemisphereLight(0xffffff, 0x4c535a, 2.2));
    const key = new THREE.DirectionalLight(0xffffff, 5.2);
    key.position.set(-14, 18, 26);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xd7e4ff, 2.0);
    fill.position.set(16, 3, 18);
    scene.add(fill);
    const rimLight = new THREE.DirectionalLight(0xffffff, 1.7);
    rimLight.position.set(2, -14, -12);
    scene.add(rimLight);
    const warmBounce = new THREE.PointLight(0xffead1, 8.5, 75);
    warmBounce.position.set(-10, -8, 22);
    scene.add(warmBounce);

    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
    });
    const shadowGeometry = new THREE.CircleGeometry(radius * 0.9, shadowSegments);
    const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
    shadow.scale.set(1, 0.18, 1);
    shadow.position.set(0, -(radius + 2.2), -2.5);
    scene.add(shadow);

    const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const idleStartedAt = performance.now();
    const flightQuaternion = new THREE.Quaternion();
    const targetQuaternion = new THREE.Quaternion();
    const flightEuler = new THREE.Euler();
    const targetEuler = new THREE.Euler();
    let frame = 0;

    const animate = (now: number) => {
      const target = resultRef.current;
      const serverStart = flippedAtRef.current;
      const idleSeconds = (now - idleStartedAt) / 1000;

      if (target && serverStart) {
        const duration = prefersReducedMotion ? 650 : 1850;
        const elapsed = Math.max(0, Date.now() - serverStart);
        const t = THREE.MathUtils.clamp(elapsed / duration, 0, 1);
        // This timestamp-derived value changes only the choreography. It can
        // never choose heads/tails: `target` came from the authoritative room.
        const motionSeed = Math.abs(Math.sin(serverStart * 0.000137));
        const flipTurns = prefersReducedMotion ? 1 : 7 + Math.floor(motionSeed * 3);
        const yawTurns = prefersReducedMotion ? 0.25 : 1.5 + motionSeed * 1.5;
        const travelT = Math.min(1, t / 0.78);

        const lift = 4 * travelT * (1 - travelT) * (prefersReducedMotion ? 2.2 : 7.2);
        const landingBounce = t > 0.78
          ? Math.sin(((t - 0.78) / 0.22) * Math.PI * 2) * (1 - t) * 1.1
          : 0;
        coin.position.y = lift + landingBounce;

        flightEuler.set(
          -0.1 + travelT * Math.PI * 2 * flipTurns,
          0.16 + travelT * Math.PI * 2 * yawTurns,
          Math.sin(travelT * Math.PI * 5) * 0.22 * (1 - travelT),
          'XYZ',
        );
        flightQuaternion.setFromEuler(flightEuler);

        // End upright on exactly the face stored by the server. Y=PI exposes
        // tails without turning the reverse artwork upside-down.
        targetEuler.set(-0.08, target === 'heads' ? 0.12 : Math.PI + 0.12, target === 'heads' ? 0.015 : -0.015, 'XYZ');
        targetQuaternion.setFromEuler(targetEuler);
        const settle = smoothstep(0.72, 1, t);
        coin.quaternion.copy(flightQuaternion).slerp(targetQuaternion, settle);

        const air = THREE.MathUtils.clamp(lift / 7.2, 0, 1);
        shadow.scale.set(1 + air * 0.5, 0.18 + air * 0.035, 1);
        shadowMaterial.opacity = 0.15 - air * 0.09;

        if (t >= 1) {
          coin.position.y = 0;
          coin.quaternion.copy(targetQuaternion);
          shadow.scale.set(1, 0.18, 1);
          shadowMaterial.opacity = 0.14;
        }
      } else if (target) {
        targetEuler.set(-0.08, target === 'heads' ? 0.12 : Math.PI + 0.12, 0, 'XYZ');
        coin.quaternion.setFromEuler(targetEuler);
        coin.position.y = 0;
        shadow.scale.set(1, 0.18, 1);
        shadowMaterial.opacity = 0.14;
      } else {
        // Before a toss, slowly present the physical coin at an angle that
        // exposes face relief, edge thickness, and reeds.
        coin.rotation.x = -0.11 + Math.sin(idleSeconds * 0.7) * 0.025;
        coin.rotation.y = 0.26 + Math.sin(idleSeconds * 0.5) * 0.07;
        coin.rotation.z = Math.sin(idleSeconds * 0.45) * 0.025;
        coin.position.y = Math.sin(idleSeconds * 0.9) * 0.14;
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
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.dispose();
      headsTexture.dispose();
      tailsTexture.dispose();
      headsMaterial.dispose();
      tailsMaterial.dispose();
      edgeMaterial.dispose();
      rimMaterial.dispose();
      reedMaterial.dispose();
      shadowMaterial.dispose();
      faceGeometry.dispose();
      tailsGeometry.dispose();
      edgeGeometry.dispose();
      rimGeometry.dispose();
      backRimGeometry.dispose();
      reedGeometry.dispose();
      shadowGeometry.dispose();
      element.replaceChildren();
    };
  }, []);

  return (
    <div className="qqurz-quarter-wrap">
      <div
        ref={mount}
        className={`qqurz-quarter-3d ${className}`.trim()}
        aria-label="Three-dimensional 2021 U.S. Washington Crossing the Delaware quarter"
      />
      <small className="qqurz-quarter-spec">2021 U.S. quarter · 24.26 mm × 1.75 mm · 119 reeds</small>
    </div>
  );
}
