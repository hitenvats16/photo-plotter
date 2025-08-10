import React, { Suspense, useEffect, useMemo } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, StatsGl, GizmoHelper, GizmoViewport, Line, Stars } from '@react-three/drei'
import { create } from 'zustand'
import * as THREE from 'three'
import * as UTIF from 'utif'
import { EffectComposer, SSAO } from '@react-three/postprocessing'
import ReactGA from 'react-ga4'
import './App.css'

// Image/geometry safety caps
const MAX_IMAGE_DIMENSION = 1024; // downscale large images to keep memory reasonable
const MAX_SPHERE_SEGMENTS = 256; // clamp sphere segments to avoid excessive vertices

type HeightMappingMode = 'luminance' | 'grayscaleLum' | 'red' | 'green' | 'blue' | 'maxRGB' | 'minRGB';

type ViewPreset = 'perspective' | 'top' | 'isometric';
type ShadingMode =
  | 'image'
  | 'geographic'
  | 'grayscale'
  | 'viridis'
  | 'inferno'
  | 'magma'
  | 'plasma'
  | 'turbo'
  | 'coolwarm'
  | 'rainbow'
  | 'ocean'
  | 'desert'
  | 'forest'
  | 'terrain'
  | 'ice';

type BodyOrbitType =
  | 'circle'
  | 'ellipse'
  | 'inclinedEllipse'
  | 'lissajous'
  | 'rose'
  | 'lemniscate'
  | 'trefoil'
  | 'figure8Knot'
  | 'epicycloid';

type Body = {
  id: string;
  name: string;
  isCentral: boolean;
  imageUrl: string | null;
  radius: number;
  heightScale: number;
  heightMode: HeightMappingMode;
  wireframe: boolean;
  shading: ShadingMode;
  seaLevel: number;
  showContours: boolean;
  contourSteps: number;
  showSea: boolean;
  orbitEnabled: boolean;
  orbitType: BodyOrbitType;
  orbitRadius: number;
  orbitRadiusY: number;
  orbitSpeed: number;
  orbitPhase: number;
  inclination: number;
  k: number;
  showOrbitTrail: boolean;
  trailLength: number;
  trailWidth: number;
  trailColor: string;
};

type AppState = {
  imageUrl: string | null;
  heightScale: number;
  heightMode: HeightMappingMode;
  wireframe: boolean;
  viewPreset: ViewPreset;
  shading: ShadingMode;
  seaLevel: number; // 0..1
  showContours: boolean;
  contourSteps: number;
  sunAzimuth: number; // degrees 0..360
  sunElevation: number; // degrees 0..90
  screenshotToken: number; // increment to trigger capture
  probeInfo: { show: boolean; x: number; y: number; height: number };
  aspectY: number; // terrain height/width
  heightmap: { data: Float32Array | null; width: number; height: number };
  showSea: boolean;
  // Stars settings
  starCount: number;
  starRadius: number;
  starDepth: number;
  starSpeed: number;
  starColor: string;
  setImageUrl: (url: string | null) => void;
  setHeightScale: (scale: number) => void;
  setHeightMode: (mode: HeightMappingMode) => void;
  setWireframe: (wire: boolean) => void;
  setViewPreset: (preset: ViewPreset) => void;
  setShading: (mode: ShadingMode) => void;
  setSeaLevel: (sea: number) => void;
  setShowContours: (v: boolean) => void;
  setContourSteps: (n: number) => void;
  setSunAzimuth: (deg: number) => void;
  setSunElevation: (deg: number) => void;
  requestScreenshot: () => void;
  setProbeInfo: (info: { show: boolean; x: number; y: number; height: number }) => void;
  setAspectY: (aspectY: number) => void;
  setHeightmap: (hm: { data: Float32Array | null; width: number; height: number }) => void;
  setShowSea: (v: boolean) => void;
  bodies: Body[];
  activeBodyId: string | null;
  addBody: () => void;
  removeActiveBody: () => void;
  selectBody: (id: string) => void;
  updateActiveBody: (patch: Partial<Body>) => void;
  // Stars setters
  setStarCount: (n: number) => void;
  setStarRadius: (n: number) => void;
  setStarDepth: (n: number) => void;
  setStarSpeed: (n: number) => void;
  setStarColor: (c: string) => void;
};

function createDefaultBody(id: string, name: string, base: Partial<Body> = {}): Body {
  return {
    id,
    name,
    isCentral: false,
    imageUrl: null,
    radius: 1,
    heightScale: 3,
    heightMode: 'luminance',
    wireframe: false,
    shading: 'geographic',
    seaLevel: 0.5,
    showContours: false,
    contourSteps: 24,
    showSea: true,
    orbitEnabled: false,
    orbitType: 'circle',
    orbitRadius: 2.5,
    orbitRadiusY: 1.5,
    orbitSpeed: 0.2,
    orbitPhase: 0,
    inclination: 0.0,
    k: 3,
    showOrbitTrail: true,
    trailLength: 100,
    trailWidth: 2,
    trailColor: '#ffffff',
    ...base,
  };
}

const useAppState = create<AppState>()((set, get) => ({
  imageUrl: null,
  heightScale: 3,
  heightMode: 'luminance',
  wireframe: false,
  viewPreset: 'perspective',
  shading: 'geographic',
  seaLevel: 0.5,
  showContours: false,
  contourSteps: 24,
  sunAzimuth: 135,
  sunElevation: 35,
  screenshotToken: 0,
  probeInfo: { show: false, x: 0, y: 0, height: 0 },
  aspectY: 1,
  heightmap: { data: null, width: 0, height: 0 },
  showSea: true,
  // Stars defaults
  starCount: 5000,
  starRadius: 200,
  starDepth: 80,
  starSpeed: 1,
  starColor: '#ffffff',
  bodies: [createDefaultBody('central', 'Central', { isCentral: true })],
  activeBodyId: 'central',
  setImageUrl: (url) => set({ imageUrl: url }),
  setHeightScale: (heightScale) => {
    set({ heightScale });
    const { activeBodyId, bodies } = get();
    set({ bodies: bodies.map(b => b.id === activeBodyId ? { ...b, heightScale } : b) });
  },
  setHeightMode: (heightMode) => {
    set({ heightMode });
    const { activeBodyId, bodies } = get();
    set({ bodies: bodies.map(b => b.id === activeBodyId ? { ...b, heightMode } : b) });
  },
  setWireframe: (wireframe) => {
    set({ wireframe });
    const { activeBodyId, bodies } = get();
    set({ bodies: bodies.map(b => b.id === activeBodyId ? { ...b, wireframe } : b) });
  },
  setViewPreset: (viewPreset) => set({ viewPreset }),
  setShading: (shading) => {
    set({ shading });
    const { activeBodyId, bodies } = get();
    set({ bodies: bodies.map(b => b.id === activeBodyId ? { ...b, shading } : b) });
  },
  setSeaLevel: (seaLevel) => {
    set({ seaLevel });
    const { activeBodyId, bodies } = get();
    set({ bodies: bodies.map(b => b.id === activeBodyId ? { ...b, seaLevel } : b) });
  },
  setShowContours: (showContours) => {
    set({ showContours });
    const { activeBodyId, bodies } = get();
    set({ bodies: bodies.map(b => b.id === activeBodyId ? { ...b, showContours } : b) });
  },
  setContourSteps: (contourSteps) => {
    set({ contourSteps });
    const { activeBodyId, bodies } = get();
    set({ bodies: bodies.map(b => b.id === activeBodyId ? { ...b, contourSteps } : b) });
  },
  setSunAzimuth: (sunAzimuth) => set({ sunAzimuth }),
  setSunElevation: (sunElevation) => set({ sunElevation }),
  requestScreenshot: () => set((s) => ({ screenshotToken: s.screenshotToken + 1 })),
  setProbeInfo: (probeInfo) => set({ probeInfo }),
  setAspectY: (aspectY) => set({ aspectY }),
  setHeightmap: (heightmap) => set({ heightmap }),
  setShowSea: (showSea) => {
    set({ showSea });
    const { activeBodyId, bodies } = get();
    set({ bodies: bodies.map(b => b.id === activeBodyId ? { ...b, showSea } : b) });
  },
  setStarCount: (starCount) => set({ starCount }),
  setStarRadius: (starRadius) => set({ starRadius }),
  setStarDepth: (starDepth) => set({ starDepth }),
  setStarSpeed: (starSpeed) => set({ starSpeed }),
  setStarColor: (starColor) => set({ starColor }),
  addBody: () => {
    const { bodies } = get();
    const id = String(Date.now() + Math.floor(Math.random() * 1000));
    const newBody = createDefaultBody(id, `Body ${bodies.length}`, { isCentral: false, orbitEnabled: true });
    set({ bodies: [...bodies, newBody], activeBodyId: id });
  },
  removeActiveBody: () => {
    const { activeBodyId, bodies } = get();
    if (!activeBodyId) return;
    const filtered = bodies.filter(b => b.id !== activeBodyId);
    set({ bodies: filtered, activeBodyId: filtered[0]?.id ?? null });
  },
  selectBody: (id) => {
    const { bodies } = get();
    const b = bodies.find(bb => bb.id === id);
    if (b) {
      set({
        activeBodyId: id,
        heightScale: b.heightScale,
        heightMode: b.heightMode,
        wireframe: b.wireframe,
        shading: b.shading,
        seaLevel: b.seaLevel,
        showContours: b.showContours,
        contourSteps: b.contourSteps,
        showSea: b.showSea,
      });
    } else {
      set({ activeBodyId: id });
    }
  },
  updateActiveBody: (patch) => {
    const { activeBodyId, bodies } = get();
    if (!activeBodyId) return;
    set({ bodies: bodies.map(b => b.id === activeBodyId ? { ...b, ...patch } : b) });
  },
}));

function readImageData(imageUrl: string): Promise<{ width: number; height: number; data: Uint8ClampedArray; canvas: HTMLCanvasElement }>
{
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      // Compute target size with aspect ratio preserved
      const srcW = image.width;
      const srcH = image.height;
      let dstW = srcW;
      let dstH = srcH;
      if (srcW > MAX_IMAGE_DIMENSION || srcH > MAX_IMAGE_DIMENSION) {
        if (srcW >= srcH) {
          dstW = MAX_IMAGE_DIMENSION;
          dstH = Math.round((srcH / srcW) * dstW);
        } else {
          dstH = MAX_IMAGE_DIMENSION;
          dstW = Math.round((srcW / srcH) * dstH);
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = dstW;
      canvas.height = dstH;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Could not get canvas context'));
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(image, 0, 0, srcW, srcH, 0, 0, dstW, dstH);
      const { data } = ctx.getImageData(0, 0, dstW, dstH);
      resolve({ width: dstW, height: dstH, data, canvas });
    };
    image.onerror = (e) => reject(e);
    image.src = imageUrl;
  });
}

function computeHeightMap(
  width: number,
  height: number,
  data: Uint8ClampedArray,
  mode: HeightMappingMode
): Float32Array {
  const heights = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      let value = 0;
      switch (mode) {
        case 'grayscaleLum':
        case 'luminance':
          // Standard luminance perception
          value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
          break;
        case 'red':
          value = r;
          break;
        case 'green':
          value = g;
          break;
        case 'blue':
          value = b;
          break;
        case 'maxRGB':
          value = Math.max(r, g, b);
          break;
        case 'minRGB':
          value = Math.min(r, g, b);
          break;
        default:
          value = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      }
      // Map 0..255 where black deepest (0) and white tallest (255)
      heights[y * width + x] = value / 255;
    }
  }
  return heights;
}

function TerrainMesh({
  imageUrl,
  heightScale,
  heightMode,
  wireframe,
  shading,
  seaLevel,
  showContours,
  contourSteps,
  onProbe,
}: {
  imageUrl: string;
  heightScale: number;
  heightMode: HeightMappingMode;
  wireframe: boolean;
  shading: ShadingMode;
  seaLevel: number;
  showContours: boolean;
  contourSteps: number;
  onProbe: (info: { show: boolean; x: number; y: number; height: number }) => void;
}) {
  const { setAspectY, setHeightmap } = useAppState();
  const [terrain, setTerrain] = React.useState<{
    texture: THREE.Texture | null;
    heights: Float32Array | null;
    width: number;
    height: number;
  }>({ texture: null, heights: null, width: 0, height: 0 });

  useEffect(() => {
    let isCancelled = false;
    async function load() {
      try {
        const [{ width, height, data, canvas }] = await Promise.all([
          readImageData(imageUrl),
        ]);
        if (isCancelled) return;
        const heights = computeHeightMap(width, height, data, heightMode);
        // Create a texture from the already-resized canvas to avoid loading original large image
        const texture = new THREE.CanvasTexture(canvas);
        if (isCancelled) return;
        setTerrain({ texture, heights, width, height });
        setAspectY(height / width);
        setHeightmap({ data: heights, width, height });
      } catch (e) {
        // no-op
      }
    }
    load();
    return () => {
      isCancelled = true;
    };
  }, [imageUrl, heightMode]);

  function getGeographicColor(height01: number): [number, number, number] {
    // Height thresholds relative to seaLevel
    const h = height01;
    const deepWater = Math.max(0, seaLevel - 0.15);
    const shallowWater = seaLevel;
    const beach = seaLevel + 0.02;
    const grass = seaLevel + 0.2;
    const forest = seaLevel + 0.35;
    const rock = seaLevel + 0.55;
    const snow = seaLevel + 0.75;

    if (h < deepWater) return [0.02, 0.08, 0.3]; // deep ocean blue
    if (h < shallowWater) return [0.05, 0.25, 0.6]; // shallow water
    if (h < beach) return [0.9, 0.85, 0.6]; // sand
    if (h < grass) return [0.3, 0.6, 0.2]; // grassland
    if (h < forest) return [0.15, 0.45, 0.15]; // darker green
    if (h < rock) return [0.4, 0.35, 0.3]; // brownish rock
    if (h < snow) return [0.6, 0.6, 0.6]; // light rock
    return [0.95, 0.97, 1.0]; // snow/ice
  }

  function clamp01(v: number) { return Math.min(1, Math.max(0, v)); }
  function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
  function lerp3(c0: [number, number, number], c1: [number, number, number], t: number): [number, number, number] {
    return [lerp(c0[0], c1[0], t), lerp(c0[1], c1[1], t), lerp(c0[2], c1[2], t)];
  }
  function gradient(stops: Array<[number, [number, number, number]]>, t: number): [number, number, number] {
    const u = clamp01(t);
    for (let i = 0; i < stops.length - 1; i += 1) {
      const [t0, c0] = stops[i];
      const [t1, c1] = stops[i + 1];
      if (u >= t0 && u <= t1) {
        const f = (u - t0) / (t1 - t0);
        return lerp3(c0, c1, f);
      }
    }
    return stops[stops.length - 1][1];
  }

  function getPaletteColor(mode: ShadingMode, h: number): [number, number, number] {
    const t = clamp01(h);
    switch (mode) {
      case 'grayscale':
        return [t, t, t];
      case 'viridis':
        return gradient([
          [0.0, [0.267, 0.004, 0.329]],
          [0.25, [0.283, 0.141, 0.458]],
          [0.5, [0.254, 0.265, 0.53]],
          [0.75, [0.207, 0.372, 0.553]],
          [1.0, [0.993, 0.906, 0.144]],
        ], t);
      case 'inferno':
        return gradient([
          [0.0, [0.001, 0.001, 0.012]],
          [0.25, [0.128, 0.047, 0.477]],
          [0.5, [0.521, 0.09, 0.478]],
          [0.75, [0.892, 0.252, 0.208]],
          [1.0, [0.988, 0.998, 0.645]],
        ], t);
      case 'magma':
        return gradient([
          [0.0, [0.001, 0.0, 0.015]],
          [0.25, [0.212, 0.071, 0.348]],
          [0.5, [0.466, 0.107, 0.506]],
          [0.75, [0.749, 0.249, 0.507]],
          [1.0, [0.987, 0.991, 0.749]],
        ], t);
      case 'plasma':
        return gradient([
          [0.0, [0.05, 0.03, 0.53]],
          [0.25, [0.47, 0.06, 0.64]],
          [0.5, [0.82, 0.19, 0.48]],
          [0.75, [0.98, 0.43, 0.27]],
          [1.0, [0.94, 0.98, 0.14]],
        ], t);
      case 'turbo': // Google Turbo
        return gradient([
          [0.0, [0.18995, 0.07176, 0.23217]],
          [0.25, [0.20803, 0.718, 0.4726]],
          [0.5, [0.43044, 0.79101, 0.4501]],
          [0.75, [0.7802, 0.5102, 0.1019]],
          [1.0, [0.98826, 0.99836, 0.64459]],
        ], t);
      case 'coolwarm':
        return gradient([
          [0.0, [0.23, 0.299, 0.754]],
          [0.5, [0.865, 0.865, 0.865]],
          [1.0, [0.706, 0.016, 0.15]],
        ], t);
      case 'rainbow':
        return gradient([
          [0.0, [0.0, 0.0, 1.0]],
          [0.2, [0.0, 0.5, 1.0]],
          [0.4, [0.0, 1.0, 0.0]],
          [0.6, [1.0, 1.0, 0.0]],
          [0.8, [1.0, 0.5, 0.0]],
          [1.0, [1.0, 0.0, 0.0]],
        ], t);
      case 'ocean':
        return gradient([
          [0.0, [0.0, 0.02, 0.15]],
          [0.5, [0.0, 0.2, 0.5]],
          [1.0, [0.0, 0.7, 0.9]],
        ], t);
      case 'desert':
        return gradient([
          [0.0, [0.25, 0.17, 0.1]],
          [0.4, [0.7, 0.5, 0.2]],
          [0.8, [0.9, 0.75, 0.45]],
          [1.0, [1.0, 0.95, 0.8]],
        ], t);
      case 'forest':
        return gradient([
          [0.0, [0.05, 0.15, 0.05]],
          [0.5, [0.1, 0.35, 0.1]],
          [1.0, [0.6, 0.9, 0.4]],
        ], t);
      case 'terrain':
        return gradient([
          [0.0, [0.2, 0.3, 0.0]],
          [0.3, [0.2, 0.55, 0.15]],
          [0.6, [0.55, 0.4, 0.2]],
          [0.85, [0.65, 0.65, 0.65]],
          [1.0, [1.0, 1.0, 1.0]],
        ], t);
      case 'ice':
        return gradient([
          [0.0, [0.0, 0.1, 0.2]],
          [0.5, [0.5, 0.8, 0.95]],
          [1.0, [1.0, 1.0, 1.0]],
        ], t);
      default:
        return getGeographicColor(t);
    }
  }

  // Rebuild geometry as a globe when image/controls change
  const sphereGeometry = useMemo(() => {
    if (!terrain.heights || !terrain.width || !terrain.height) {
      return new THREE.SphereGeometry(1, 16, 12);
    }
    const width = terrain.width;
    const height = terrain.height;
    const segW = Math.min(Math.max(8, width - 1), MAX_SPHERE_SEGMENTS);
    const segH = Math.min(Math.max(6, height - 1), MAX_SPHERE_SEGMENTS);
    const geom = new THREE.SphereGeometry(1, segW, segH);
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const uv = geom.attributes.uv as THREE.BufferAttribute;
    const colorArray = new Float32Array((pos.count) * 3);
    const vertex = new THREE.Vector3();
    const dispScale = heightScale; // already normalized by caller
    for (let i = 0; i < pos.count; i += 1) {
      const u = uv.getX(i);
      const v = uv.getY(i);
      const ix = Math.round(u * (width - 1));
      const iy = Math.round((1 - v) * (height - 1));
      const h = terrain.heights[iy * width + ix];
      const radius = 1 + (h - 0.5) * 2 * dispScale;
      vertex.set(pos.getX(i), pos.getY(i), pos.getZ(i)).normalize();
      vertex.multiplyScalar(radius);
      pos.setXYZ(i, vertex.x, vertex.y, vertex.z);

      const [r0, g0, b0] = getPaletteColor(shading, h);
      let r = r0, g = g0, b = b0;
      if (showContours) {
        const band = Math.floor(h * contourSteps) % 2;
        const shade = band ? 0.88 : 1.0;
        r *= shade; g *= shade; b *= shade;
      }
      colorArray[i * 3 + 0] = r;
      colorArray[i * 3 + 1] = g;
      colorArray[i * 3 + 2] = b;
    }
    pos.needsUpdate = true;
    geom.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
    geom.computeVertexNormals();
    return geom;
  }, [terrain.heights, terrain.width, terrain.height, heightScale, seaLevel, shading, showContours, contourSteps]);

  const useImageTexture = shading === 'image' && !!terrain.texture;
  return (
    <mesh
      onPointerMove={(e) => {
        if (!terrain.heights) return;
        if (!e.uv) return;
        const u = Math.min(Math.max(e.uv.x, 0), 1);
        const v = Math.min(Math.max(e.uv.y, 0), 1);
        const ix = Math.round(u * (terrain.width - 1));
        const iy = Math.round((1 - v) * (terrain.height - 1));
        const h = terrain.heights[iy * terrain.width + ix];
        onProbe({ show: true, x: ix, y: iy, height: h });
      }}
      onPointerOut={() => onProbe({ show: false, x: 0, y: 0, height: 0 })}
    >
      <primitive
        key={`sphere-${shading}-${seaLevel.toFixed(3)}-${showContours}-${contourSteps}-${heightScale.toFixed(3)}`}
        object={sphereGeometry}
        attach="geometry"
      />
      {useImageTexture ? (
        <meshStandardMaterial map={terrain.texture!} wireframe={wireframe} vertexColors={false} />
      ) : (
        <meshStandardMaterial vertexColors wireframe={wireframe} />
      )}
    </mesh>
  );
}

function ControlsPanel() {
  const {
    heightScale,
    heightMode,
    wireframe,
    viewPreset,
    setViewPreset,
    shading,
    seaLevel,
    showContours,
    contourSteps,
    sunAzimuth,
    setSunAzimuth,
    sunElevation,
    setSunElevation,
    requestScreenshot,
    bodies,
    activeBodyId,
    selectBody,
    addBody,
    removeActiveBody,
    updateActiveBody,
  } = useAppState();
  const activeBody = bodies.find((b) => b.id === activeBodyId) ?? bodies[0];

  return (
    <div className="controls">
      <details open>
        <summary>Bodies</summary>
        <div className="row" style={{ gridTemplateColumns: '1fr auto auto' }}>
          <select value={activeBody?.id ?? ''} onChange={(e) => selectBody(e.target.value)}>
            {bodies.map((b) => (
              <option key={b.id} value={b.id}>{b.name}{b.isCentral ? ' (central)' : ''}</option>
            ))}
          </select>
          <button onClick={() => addBody()}>Add</button>
          <button onClick={() => removeActiveBody()} disabled={!activeBody || bodies.length <= 1}>Remove</button>
        </div>
        <div className="row">
          <label>Name</label>
          <input type="text" value={activeBody?.name ?? ''} onChange={(e) => updateActiveBody({ name: e.target.value })} />
        </div>
      </details>

      <details open>
        <summary>Terrain</summary>
        <div className="row">
          <label htmlFor="heightScale">Height</label>
          <input id="heightScale" type="range" min={1} max={10} step={1} value={activeBody?.heightScale ?? heightScale} onChange={(e) => updateActiveBody({ heightScale: Number(e.target.value) })} />
          <span>{activeBody?.heightScale ?? heightScale}x</span>
        </div>
        <div className="row">
          <label htmlFor="bodyRadius">Radius</label>
          <input id="bodyRadius" type="range" min={0.2} max={5} step={0.1} value={activeBody?.radius ?? 1} onChange={(e) => updateActiveBody({ radius: Number(e.target.value) })} />
          <span>{(activeBody?.radius ?? 1).toFixed(1)}</span>
        </div>
        <div className="row">
          <label htmlFor="heightMode">Height mode</label>
          <select id="heightMode" value={activeBody?.heightMode ?? heightMode} onChange={(e) => updateActiveBody({ heightMode: e.target.value as HeightMappingMode })}>
            <option value="luminance">Luminance (perceived)</option>
            <option value="red">Red</option>
            <option value="green">Green</option>
            <option value="blue">Blue</option>
            <option value="maxRGB">Max RGB</option>
            <option value="minRGB">Min RGB</option>
          </select>
        </div>
        <div className="row">
          <label htmlFor="shading">Shading</label>
          <select id="shading" value={activeBody?.shading ?? shading} onChange={(e) => updateActiveBody({ shading: e.target.value as ShadingMode })}>
            <option value="geographic">Geographic</option>
            <option value="image">Original image</option>
            <option value="grayscale">Grayscale</option>
            <option value="viridis">Viridis</option>
            <option value="inferno">Inferno</option>
            <option value="magma">Magma</option>
            <option value="plasma">Plasma</option>
            <option value="turbo">Turbo</option>
            <option value="coolwarm">Coolwarm</option>
            <option value="rainbow">Rainbow</option>
            <option value="ocean">Ocean</option>
            <option value="desert">Desert</option>
            <option value="forest">Forest</option>
            <option value="terrain">Terrain</option>
            <option value="ice">Ice</option>
          </select>
        </div>
        <div className="row">
          <label htmlFor="contours">Contours</label>
          <input id="contours" type="checkbox" checked={activeBody?.showContours ?? showContours} onChange={(e) => updateActiveBody({ showContours: e.target.checked })} />
          <input type="range" min={6} max={64} step={1} value={activeBody?.contourSteps ?? contourSteps} onChange={(e) => updateActiveBody({ contourSteps: Number(e.target.value) })} disabled={!(activeBody?.showContours ?? showContours)} />
        </div>
        <div className="row">
          <label htmlFor="wireframe">Wireframe</label>
          <input id="wireframe" type="checkbox" checked={activeBody?.wireframe ?? wireframe} onChange={(e) => updateActiveBody({ wireframe: e.target.checked })} />
        </div>
      </details>

      <details>
        <summary>Sea</summary>
        <div className="row">
          <label htmlFor="showSea">Enable</label>
          <input id="showSea" type="checkbox" checked={activeBody?.showSea ?? false} onChange={(e) => updateActiveBody({ showSea: e.target.checked })} />
        </div>
        <div className="row">
          <label htmlFor="seaLevel">Level</label>
          <input id="seaLevel" type="range" min={0} max={1} step={0.01} value={activeBody?.seaLevel ?? seaLevel} onChange={(e) => updateActiveBody({ seaLevel: Number(e.target.value) })} />
          <span>{Math.round(((activeBody?.seaLevel ?? seaLevel) * 100))}%</span>
        </div>
      </details>

      <details>
        <summary>Orbit</summary>
        <div className="row">
          <label>Type</label>
          <select value={activeBody?.orbitType ?? 'circle'} onChange={(e) => updateActiveBody({ orbitType: e.target.value as any })}>
            <option value="circle">Circle</option>
            <option value="ellipse">Ellipse</option>
            <option value="inclinedEllipse">Inclined ellipse</option>
            <option value="lissajous">Lissajous</option>
            <option value="rose">Rose</option>
            <option value="lemniscate">Lemniscate</option>
            <option value="trefoil">Trefoil</option>
            <option value="figure8Knot">Figure-8 Knot</option>
            <option value="epicycloid">Epicycloid</option>
          </select>
        </div>
        <div className="row">
          <label>Enabled</label>
          <input type="checkbox" checked={!!activeBody?.orbitEnabled} onChange={(e) => updateActiveBody({ orbitEnabled: e.target.checked })} />
        </div>
        <div className="row"><label>Radius</label><input type="range" min={0.5} max={10} step={0.1} value={activeBody?.orbitRadius ?? 2.5} onChange={(e) => updateActiveBody({ orbitRadius: Number(e.target.value) })} /></div>
        <div className="row"><label>Radius Y</label><input type="range" min={0.1} max={10} step={0.1} value={activeBody?.orbitRadiusY ?? 1.5} onChange={(e) => updateActiveBody({ orbitRadiusY: Number(e.target.value) })} /></div>
        <div className="row"><label>Speed</label><input type="range" min={0.01} max={2} step={0.01} value={activeBody?.orbitSpeed ?? 0.2} onChange={(e) => updateActiveBody({ orbitSpeed: Number(e.target.value) })} /></div>
        <div className="row"><label>Phase</label><input type="range" min={0} max={6.283} step={0.01} value={activeBody?.orbitPhase ?? 0} onChange={(e) => updateActiveBody({ orbitPhase: Number(e.target.value) })} /></div>
        <div className="row"><label>Inclination</label><input type="range" min={0} max={1.57} step={0.01} value={activeBody?.inclination ?? 0} onChange={(e) => updateActiveBody({ inclination: Number(e.target.value) })} /></div>
        <div className="row"><label>k</label><input type="range" min={1} max={12} step={1} value={activeBody?.k ?? 3} onChange={(e) => updateActiveBody({ k: Number(e.target.value) })} /></div>
        
        <div className="row">
          <label>Show Trail</label>
          <input type="checkbox" checked={activeBody?.showOrbitTrail ?? true} onChange={(e) => updateActiveBody({ showOrbitTrail: e.target.checked })} />
        </div>
        <div className="row">
          <label>Trail Length</label>
          <input type="range" min={10} max={5000} step={10} value={activeBody?.trailLength ?? 100} onChange={(e) => updateActiveBody({ trailLength: Number(e.target.value) })} />
          <span>{activeBody?.trailLength ?? 100}</span>
        </div>
        <div className="row">
          <label>Trail Width</label>
          <input type="range" min={0.5} max={10} step={0.5} value={activeBody?.trailWidth ?? 2} onChange={(e) => updateActiveBody({ trailWidth: Number(e.target.value) })} />
          <span>{activeBody?.trailWidth ?? 2}</span>
        </div>
        <div className="row">
          <label>Trail Color</label>
          <input type="color" value={activeBody?.trailColor ?? '#ffffff'} onChange={(e) => updateActiveBody({ trailColor: e.target.value })} />
        </div>
      </details>

      <details>
        <summary>Lighting</summary>
        <div className="row"><label htmlFor="sunAzimuth">Sun azimuth</label><input id="sunAzimuth" type="range" min={0} max={360} step={1} value={sunAzimuth} onChange={(e) => setSunAzimuth(Number(e.target.value))} /><span>{sunAzimuth}°</span></div>
        <div className="row"><label htmlFor="sunElevation">Sun elevation</label><input id="sunElevation" type="range" min={5} max={85} step={1} value={sunElevation} onChange={(e) => setSunElevation(Number(e.target.value))} /><span>{sunElevation}°</span></div>
      </details>

      <details>
        <summary>View</summary>
        <div className="row">
          <label htmlFor="viewPreset">Preset</label>
          <select id="viewPreset" value={viewPreset} onChange={(e) => setViewPreset(e.target.value as ViewPreset)}>
            <option value="perspective">Perspective</option>
            <option value="top">Top-down</option>
            <option value="isometric">Isometric</option>
          </select>
        </div>
      </details>

      <details>
        <summary>Stars</summary>
        <div className="row"><label>Count</label><StarCountInput /></div>
        <div className="row"><label>Radius</label><StarRadiusInput /></div>
        <div className="row"><label>Depth</label><StarDepthInput /></div>
        <div className="row"><label>Speed</label><StarSpeedInput /></div>
        <div className="row"><label>Color</label><StarColorInput /></div>
      </details>

      <details>
        <summary>Export</summary>
        <div className="row"><label>Screenshot</label><button onClick={() => requestScreenshot()}>Capture PNG</button></div>
        <div className="row"><label>Heightmap</label><button onClick={() => exportHeightmapPNG()}>PNG</button><button onClick={() => exportHeightmapTIFF()}>TIFF</button></div>
      </details>
    </div>
  );
}

function FileDrop() {
  const { setImageUrl, updateActiveBody, activeBodyId } = useAppState();
  const onFile = (file: File) => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    if (activeBodyId) updateActiveBody({ imageUrl: url });
  };

  return (
    <div
      className="dropzone"
      onDragOver={(e) => {
        e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer?.files?.[0];
        if (file) onFile(file);
      }}
    >
      <input
        id="file-input"
        type="file"
        accept="image/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
        }}
      />
      <label htmlFor="file-input">Click to choose an image or drag & drop</label>
    </div>
  );
}

function computeOrbitPosition(t: number, b: Body): THREE.Vector3 {
  const p = new THREE.Vector3();
  const R = b.orbitRadius;
  const Ry = b.orbitRadiusY;
  const w = b.orbitSpeed;
  const ph = b.orbitPhase;
  const k = b.k;
  switch (b.orbitType) {
    case 'circle':
      p.set(R * Math.cos(w * t + ph), 0, R * Math.sin(w * t + ph));
      break;
    case 'ellipse':
      p.set(R * Math.cos(w * t + ph), 0, Ry * Math.sin(w * t + ph));
      break;
    case 'inclinedEllipse': {
      const x = R * Math.cos(w * t + ph);
      const z = Ry * Math.sin(w * t + ph);
      const y = Math.sin(b.inclination) * z;
      p.set(x, y, Math.cos(b.inclination) * z);
      break;
    }
    case 'lissajous':
      p.set(R * Math.sin(w * t + ph), Ry * Math.sin(k * w * t), R * Math.cos(w * t + ph));
      break;
    case 'rose': // rhodonea curve projected
      p.set(R * Math.cos(k * (w * t + ph)) * Math.cos(w * t + ph), 0, R * Math.cos(k * (w * t + ph)) * Math.sin(w * t + ph));
      break;
    case 'lemniscate': { // Bernoulli lemniscate projection
      const a = R;
      const th = w * t + ph;
      const r = (a * Math.sqrt(2) * Math.cos(2 * th)) / (1 + Math.sin(2 * th));
      p.set(r * Math.cos(th), 0, r * Math.sin(th));
      break;
    }
    case 'trefoil': // simple 3D trefoil-like param
      p.set(Math.sin(w * t + ph) + 2 * Math.sin(2 * (w * t + ph)), Math.cos(w * t + ph) - 2 * Math.cos(2 * (w * t + ph)), -Math.sin(3 * (w * t + ph)));
      p.multiplyScalar(R * 0.3);
      break;
    case 'figure8Knot':
      p.set((2 + Math.cos(2 * (w * t + ph))) * Math.cos(3 * (w * t + ph)), Math.sin(2 * (w * t + ph)), (2 + Math.cos(2 * (w * t + ph))) * Math.sin(3 * (w * t + ph)));
      p.multiplyScalar(R * 0.25);
      break;
    case 'epicycloid': {
      const a = R * 0.6; const b2 = R * 0.2;
      const th = w * t + ph;
      const x = (a + b2) * Math.cos(th) - b2 * Math.cos(((a + b2) / b2) * th);
      const z = (a + b2) * Math.sin(th) - b2 * Math.sin(((a + b2) / b2) * th);
      p.set(x, 0, z);
      break;
    }
    default:
      p.set(R * Math.cos(w * t + ph), 0, R * Math.sin(w * t + ph));
  }
  return p;
}

function Scene() {
  const {
    imageUrl, heightScale, viewPreset, sunAzimuth, sunElevation, screenshotToken, setProbeInfo,
    starCount, starRadius, starDepth, starSpeed
  } = useAppState();
  const { gl } = useThree();

  // Adjust camera based on preset
  useFrame(({ camera }) => {
    if (!imageUrl) return;
    if (viewPreset === 'top') {
      camera.up.set(0, 1, 0);
      camera.position.set(0, 3, 0.0001);
      camera.lookAt(0, 0, 0);
    } else if (viewPreset === 'isometric') {
      camera.up.set(0, 1, 0);
      camera.position.set(2.5, 2.5, 2.5);
      camera.lookAt(0, 0, 0);
    }
  });

  // Sun light from azimuth/elevation
  const elev = (sunElevation * Math.PI) / 180;
  const az = (sunAzimuth * Math.PI) / 180;
  const r = 8;
  const sunX = r * Math.cos(elev) * Math.cos(az);
  const sunY = r * Math.sin(elev);
  const sunZ = r * Math.cos(elev) * Math.sin(az);

  // Constrain zoom so camera never enters the globe
  const dispScale = (heightScale / 50);
  const minZoomDistance = 1 + dispScale + 0.05; // add small margin above outer radius
  const maxZoomDistance = Infinity;

  // Screenshot capture
  useEffect(() => {
    if (!imageUrl) return;
    const canvas = gl.domElement as HTMLCanvasElement;
    const capture = () => {
      if (typeof (canvas as HTMLCanvasElement).toBlob === 'function') {
        canvas.toBlob((blob) => {
          if (!blob) return;
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'terrain.png';
          a.click();
        }, 'image/png');
      } else {
        const dataUrl = (canvas as HTMLCanvasElement).toDataURL('image/png');
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = 'terrain.png';
        a.click();
      }
    };
    requestAnimationFrame(() => {
      capture();
    });
  }, [screenshotToken]);

  return (
    <>
      <Stars radius={starRadius} depth={starDepth} count={starCount} factor={4} saturation={0} fade speed={starSpeed} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[sunX, sunY, sunZ]} intensity={1.25} castShadow />
      <group>
        {/* Render bodies: first central at origin, others orbiting */}
        {useAppState.getState().bodies.map((b) => (
          <BodyInstance key={b.id} body={b} onProbe={setProbeInfo} />
        ))}
      </group>
      <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
        <GizmoViewport axisColors={["#ff0000", "#00ff00", "#0000ff"]} labelColor="white" />
      </GizmoHelper>
      <StatsGl />
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.1}
        minPolarAngle={0.01}
        maxPolarAngle={Math.PI / 2 - 0.05}
        minDistance={minZoomDistance}
        maxDistance={maxZoomDistance}
        enablePan={true}
      />
      <EffectComposer>
        <SSAO samples={16} radius={0.075} intensity={35} luminanceInfluence={0.4} color={new THREE.Color(0x000000)} />
      </EffectComposer>
    </>
  );
}

function BodyInstance({ body, onProbe }: { body: Body; onProbe: (info: { show: boolean; x: number; y: number; height: number }) => void; }) {
  const groupRef = React.useRef<THREE.Group>(null);
  const tRef = React.useRef(0);
  const [trailPoints, setTrailPoints] = React.useState<THREE.Vector3[]>([]);
  useFrame((_, delta) => {
    if (!groupRef.current) return;
    tRef.current += delta;
    if (!body.isCentral && body.orbitEnabled) {
      const p = computeOrbitPosition(tRef.current, body);
      groupRef.current.position.set(p.x, p.y, p.z);
      groupRef.current.rotation.y += delta * 0.05;
      // Append to trail, limit length
      setTrailPoints((pts) => {
        const next = [...pts, p.clone()];
        if (next.length > body.trailLength) next.shift();
        return next;
      });
    }
  });
  return (
    <>
      <group ref={groupRef}>
        <TerrainMesh
          imageUrl={body.imageUrl ?? useAppState.getState().imageUrl ?? ''}
          heightScale={(body.heightScale * body.radius) / 50}
          heightMode={body.heightMode}
          wireframe={body.wireframe}
          shading={body.shading}
          seaLevel={body.seaLevel}
          showContours={body.showContours}
          contourSteps={body.contourSteps}
          onProbe={onProbe}
        />
        {body.showSea ? (
          <mesh>
            <sphereGeometry args={[body.radius + (body.seaLevel - 0.5) * 0.02 + 0.01, 64, 48]} />
            <meshPhysicalMaterial color={new THREE.Color('#204060')} transparent opacity={0.5} roughness={0.35} metalness={0} transmission={0.2} thickness={0.2} />
          </mesh>
        ) : null}
      </group>
      {body.orbitEnabled && body.showOrbitTrail && trailPoints.length > 1 ? (
        <Line 
          points={trailPoints} 
          color={body.trailColor} 
          lineWidth={body.trailWidth} 
          dashed={false} 
          opacity={0.9} 
          transparent 
        />
      ) : null}
    </>
  );
}

function App() {
  // Initialize Google Analytics
  useEffect(() => {
    ReactGA.initialize('G-CFPDBFG3K9');
    ReactGA.send({ hitType: 'pageview', page: window.location.pathname });
  }, []);

  const { imageUrl, probeInfo, bodies, activeBodyId, addBody, removeActiveBody, selectBody, updateActiveBody } = useAppState();

  return (
    <div className="app">
      <header className="header">
        <h1>Photo Terrain Plotter</h1>
        <PresetButtons />
      </header>
      <main className="main">
        <section className="left">
          <FileDrop />
          <ControlsPanel />
          <div className="controls" style={{ marginTop: 12 }}>
            <div className="row"><strong>Bodies</strong></div>
            <div className="row" style={{ gridTemplateColumns: '1fr auto auto' }}>
              <select value={activeBodyId ?? ''} onChange={(e) => selectBody(e.target.value)}>
                {bodies.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}{b.isCentral ? ' (central)' : ''}</option>
                ))}
              </select>
              <button onClick={() => addBody()}>Add body</button>
              <button onClick={() => removeActiveBody()} disabled={!activeBodyId || bodies.length <= 1}>Remove</button>
            </div>
            <div className="row">
              <label>Name</label>
              <input type="text" value={bodies.find(b => b.id === activeBodyId)?.name ?? ''} onChange={(e) => updateActiveBody({ name: e.target.value })} />
            </div>
            <div className="row">
              <label>Orbit</label>
              <select value={bodies.find(b => b.id === activeBodyId)?.orbitType ?? 'circle'} onChange={(e) => updateActiveBody({ orbitType: e.target.value as any })}>
                <option value="circle">Circle</option>
                <option value="ellipse">Ellipse</option>
                <option value="inclinedEllipse">Inclined ellipse</option>
                <option value="lissajous">Lissajous</option>
                <option value="rose">Rose</option>
                <option value="lemniscate">Lemniscate</option>
                <option value="trefoil">Trefoil</option>
                <option value="figure8Knot">Figure-8 Knot</option>
                <option value="epicycloid">Epicycloid</option>
              </select>
            </div>
            <div className="row">
              <label>Enabled</label>
              <input type="checkbox" checked={!!bodies.find(b => b.id === activeBodyId)?.orbitEnabled} onChange={(e) => updateActiveBody({ orbitEnabled: e.target.checked })} />
            </div>
            <div className="row">
              <label>Radius</label>
              <input type="range" min={0.5} max={10} step={0.1} value={bodies.find(b => b.id === activeBodyId)?.orbitRadius ?? 2.5} onChange={(e) => updateActiveBody({ orbitRadius: Number(e.target.value) })} />
            </div>
            <div className="row">
              <label>Radius Y</label>
              <input type="range" min={0.1} max={10} step={0.1} value={bodies.find(b => b.id === activeBodyId)?.orbitRadiusY ?? 1.5} onChange={(e) => updateActiveBody({ orbitRadiusY: Number(e.target.value) })} />
            </div>
            <div className="row">
              <label>Speed</label>
              <input type="range" min={0.01} max={2} step={0.01} value={bodies.find(b => b.id === activeBodyId)?.orbitSpeed ?? 0.2} onChange={(e) => updateActiveBody({ orbitSpeed: Number(e.target.value) })} />
            </div>
            <div className="row">
              <label>Phase</label>
              <input type="range" min={0} max={6.283} step={0.01} value={bodies.find(b => b.id === activeBodyId)?.orbitPhase ?? 0} onChange={(e) => updateActiveBody({ orbitPhase: Number(e.target.value) })} />
            </div>
            <div className="row">
              <label>Inclination</label>
              <input type="range" min={0} max={1.57} step={0.01} value={bodies.find(b => b.id === activeBodyId)?.inclination ?? 0} onChange={(e) => updateActiveBody({ inclination: Number(e.target.value) })} />
            </div>
            <div className="row">
              <label>k</label>
              <input type="range" min={1} max={12} step={1} value={bodies.find(b => b.id === activeBodyId)?.k ?? 3} onChange={(e) => updateActiveBody({ k: Number(e.target.value) })} />
            </div>
          </div>
        </section>
        <section className="right">
          <Canvas shadows camera={{ position: [2, 1.5, 2.5], fov: 45 }} gl={{ preserveDrawingBuffer: true }}>
            <Suspense fallback={null}>
              <Scene />
            </Suspense>
          </Canvas>
          {!imageUrl ? (
            <div className="placeholder">Upload an image to generate terrain</div>
          ) : null}
          {probeInfo.show ? (
            <div className="probe">x: {probeInfo.x}, y: {probeInfo.y}, h: {probeInfo.height.toFixed(3)}</div>
          ) : null}
        </section>
      </main>
      <footer className="footer">Black = deepest, White = tallest. Adjust height scale and view presets.</footer>
    </div>
  );
}

function exportHeightmapPNG() {
  const { heightmap } = useAppState.getState();
  const hm = heightmap;
  if (!hm.data || !hm.width || !hm.height) return;
  const canvas = document.createElement('canvas');
  canvas.width = hm.width;
  canvas.height = hm.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const imageData = ctx.createImageData(hm.width, hm.height);
  for (let i = 0; i < hm.width * hm.height; i += 1) {
    const v = Math.max(0, Math.min(255, Math.round(hm.data[i] * 255)));
    imageData.data[i * 4 + 0] = v;
    imageData.data[i * 4 + 1] = v;
    imageData.data[i * 4 + 2] = v;
    imageData.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = 'heightmap.png';
  a.click();
}

function exportHeightmapTIFF() {
  const { heightmap } = useAppState.getState();
  const hm = heightmap;
  if (!hm.data || !hm.width || !hm.height) return;
  // 8-bit grayscale TIFF using UTIF
  const w = hm.width, h = hm.height;
  const buff = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) buff[i] = Math.max(0, Math.min(255, Math.round(hm.data[i] * 255)));
  const tiff = UTIF.encodeImage(buff, w, h);
  const blob = new Blob([new Uint8Array(tiff)], { type: 'image/tiff' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'heightmap.tiff';
  a.click();
}

export default App

type Preset = Partial<Pick<AppState,
  'heightScale' | 'heightMode' | 'wireframe' | 'viewPreset' |
  'shading' | 'seaLevel' | 'showContours' | 'contourSteps' | 'sunAzimuth' | 'sunElevation'
>> & { name: string };

function PresetButtons() {
  const state = useAppState();
  function savePreset() {
    const name = prompt('Preset name?');
    if (!name) return;
    const preset: Preset = {
      name,
      heightScale: state.heightScale,
      heightMode: state.heightMode,
      wireframe: state.wireframe,
      viewPreset: state.viewPreset,
      shading: state.shading,
      seaLevel: state.seaLevel,
      showContours: state.showContours,
      contourSteps: state.contourSteps,
      sunAzimuth: state.sunAzimuth,
      sunElevation: state.sunElevation,
    };
    const list = JSON.parse(localStorage.getItem('pp_presets') || '[]');
    list.push(preset);
    localStorage.setItem('pp_presets', JSON.stringify(list));
    alert('Preset saved');
  }

  function loadPreset() {
    const list: Preset[] = JSON.parse(localStorage.getItem('pp_presets') || '[]');
    if (!list.length) return alert('No presets saved');
    const name = prompt('Enter preset name to load:\n' + list.map((p) => p.name).join(', '));
    if (!name) return;
    const preset = list.find((p) => p.name === name);
    if (!preset) return alert('Preset not found');
    if (preset.heightScale !== undefined) state.setHeightScale(preset.heightScale);
    if (preset.heightMode) state.setHeightMode(preset.heightMode);
    if (preset.wireframe !== undefined) state.setWireframe(preset.wireframe);
    if (preset.viewPreset) state.setViewPreset(preset.viewPreset);
    if (preset.shading) state.setShading(preset.shading);
    if (preset.seaLevel !== undefined) state.setSeaLevel(preset.seaLevel);
    if (preset.showContours !== undefined) state.setShowContours(preset.showContours);
    if (preset.contourSteps !== undefined) state.setContourSteps(preset.contourSteps);
    if (preset.sunAzimuth !== undefined) state.setSunAzimuth(preset.sunAzimuth);
    if (preset.sunElevation !== undefined) state.setSunElevation(preset.sunElevation);
  }

  return (
    <div style={{ display: 'flex', gap: 8, marginLeft: 'auto' }}>
      <button onClick={savePreset}>Save preset</button>
      <button onClick={loadPreset}>Load preset</button>
    </div>
  );
}

function StarCountInput() {
  const { starCount, setStarCount } = useAppState();
  return (
    <input type="range" min={500} max={15000} step={100} value={starCount} onChange={(e) => setStarCount(Number(e.target.value))} />
  );
}
function StarRadiusInput() {
  const { starRadius, setStarRadius } = useAppState();
  return (
    <input type="range" min={50} max={1000} step={10} value={starRadius} onChange={(e) => setStarRadius(Number(e.target.value))} />
  );
}
function StarDepthInput() {
  const { starDepth, setStarDepth } = useAppState();
  return (
    <input type="range" min={10} max={300} step={5} value={starDepth} onChange={(e) => setStarDepth(Number(e.target.value))} />
  );
}
function StarSpeedInput() {
  const { starSpeed, setStarSpeed } = useAppState();
  return (
    <input type="range" min={0} max={5} step={0.1} value={starSpeed} onChange={(e) => setStarSpeed(Number(e.target.value))} />
  );
}
function StarColorInput() {
  const { starColor, setStarColor } = useAppState();
  return (
    <input type="color" value={starColor} onChange={(e) => setStarColor(e.target.value)} />
  );
}
