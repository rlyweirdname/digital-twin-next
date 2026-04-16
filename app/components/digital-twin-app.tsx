"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Application, SPEObject } from "@splinetool/runtime";

const Spline = dynamic(() => import("@splinetool/react-spline"), { ssr: false });

const SCENE_URL = "https://prod.spline.design/QPktwJZjaB8Do36x/scene.splinecode";
const WALL_NAME_FALLBACKS = new Set(["Cube 3", "Cube 4", "Cube 5", "Cube 6", "Cube 7", "Cube 8"]);

const WALL_HIDE_DOT_THRESHOLD = 0.24;
const WALL_SHOW_DOT_THRESHOLD = 0.12;
const WALL_HIDE_DISTANCE_THRESHOLD = 4.6;
const WALL_SHOW_DISTANCE_THRESHOLD = 5.4;
const WALL_RESTORE_DELAY_MS = 240;
const CUTAWAY_TICK_MS = 110;
const SIMULATION_TICK_MS = 1200;
const TEMP_MIN = 20;
const TEMP_MAX = 50;
const TEMP_ALERT_THRESHOLD = 40;
const AUTO_COOL_TARGET = 23;
const HUMIDITY_MIN = 30;
const HUMIDITY_MAX = 80;
const FAN_SPIN_AXIS_OVERRIDE: RotationAxis | null = "y";
const FAN_SPIN_MAX_SPEED = 8.6;
const FAN_SPIN_ACCEL = 7.5;
const FAN_SPIN_DECEL = 5.5;
const LIGHT_OFF_INTENSITY_FACTOR = 0.03;
const TV_ON_COLOR = "#68d4ff";
const TV_OFF_COLOR = "#0a0f14";

interface ApiState {
  current_temp: number;
  target_temp: number;
  humidity: number;
  fan_on: boolean;
  ac_on: boolean;
  mode: "auto" | "manual";
}

interface UiState {
  currentTemp: number;
  targetTemp: number;
  humidity: number;
  fanOn: boolean;
  acOn: boolean;
  acHeating: boolean;
  mode: "auto" | "manual";
  temperatureRising: boolean;
}

interface StatsResponse {
  avg_temp: number;
  max_temp: number;
  min_temp: number;
  avg_humidity: number | null;
  total_records: number;
  fan_on_time: number;
  ac_on_time: number;
}

interface LogEntry {
  id: number;
  timestamp: string;
  temperature: number;
  humidity: number | null;
  fan_on: boolean;
  ac_on: boolean;
  target_temp: number | null;
  mode: "auto" | "manual";
}

type RuntimeObject = SPEObject & { parentUuid?: string };

type RuntimeApp = Application & {
  _camera?: { position?: Vec3Like };
  camera?: { position?: Vec3Like };
  _scene?: { activeCamera?: { position?: Vec3Like } };
  controls?: { orbitControls?: OrbitControlsLike };
  _controls?: { orbitControls?: OrbitControlsLike };
  eventManager?: { controlsManager?: { orbitControls?: OrbitControlsLike } };
  _eventManager?: { controlsManager?: { orbitControls?: OrbitControlsLike } };
};

interface OrbitControlsLike {
  minPolarAngle?: number;
  maxPolarAngle?: number;
  getPolarAngle?: () => number;
  target?: Vec3Like;
  update?: () => void;
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

interface CutawayState {
  hidden: boolean;
  showCandidateSince: number;
}

type RotationAxis = "x" | "y" | "z";

interface FanBladeBinding {
  object: SPEObject;
  axis: RotationAxis;
  baseRotation: Vec3Like;
  spinAngle: number;
}

interface FanHousingBinding {
  object: SPEObject;
  baseRotation: Vec3Like;
}

interface LightBinding {
  object: SPEObject;
  baseIntensity: number;
}

interface TvBinding {
  object: SPEObject;
  baseColor: string;
  baseIntensity: number;
}

const DEFAULT_STATE: UiState = {
  currentTemp: 25,
  targetTemp: 25,
  humidity: 55,
  fanOn: false,
  acOn: false,
  acHeating: false,
  mode: "auto",
  temperatureRising: false,
};

function toUiState(payload: ApiState): UiState {
  return {
    currentTemp: payload.current_temp,
    targetTemp: payload.target_temp,
    humidity: payload.humidity,
    fanOn: payload.fan_on,
    acOn: payload.ac_on,
    acHeating: false,
    mode: payload.mode,
    temperatureRising: false,
  };
}

function toApiState(payload: UiState): ApiState {
  return {
    current_temp: payload.currentTemp,
    target_temp: payload.targetTemp,
    humidity: payload.humidity,
    fan_on: payload.fanOn,
    ac_on: payload.acOn,
    mode: payload.mode,
  };
}

function toNumber(value: unknown, fallback = 0): number {
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isFinite(candidate) ? candidate : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function formatTemp(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}°C` : "--";
}

function formatPercent(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(0)}%` : "--";
}

function formatLogTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    return "--:--";
  }

  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatMode(mode: "auto" | "manual"): string {
  return mode === "auto" ? "TỰ ĐỘNG" : "THỦ CÔNG";
}

const FAN_ON_TEMP = 30;
const AC_COOL_THRESHOLD = 34;
const AC_COOL_TARGET = 25;

function simulateStateTick(current: UiState): UiState {
  const next = { ...current };
  const diff = next.targetTemp - next.currentTemp;

  if (next.currentTemp >= TEMP_ALERT_THRESHOLD) {
    next.acOn = true;
    next.fanOn = true;
    next.acHeating = false;
    next.targetTemp = AUTO_COOL_TARGET;
    next.currentTemp += Math.max(-0.3, -0.15);
  } else if (next.currentTemp >= AC_COOL_THRESHOLD) {
    next.acOn = true;
    next.fanOn = true;
    next.acHeating = false;
    next.targetTemp = AC_COOL_TARGET;
    next.currentTemp += Math.max(-0.35, -0.2);
  } else if (next.mode === "auto") {
    if (diff > 0) {
      next.acOn = true;
      next.fanOn = next.currentTemp >= FAN_ON_TEMP;
      next.acHeating = true;
      if (next.fanOn) {
        next.currentTemp += Math.min(0.08, diff * 0.06);
      } else {
        next.currentTemp += Math.min(0.15, diff * 0.1);
      }
    } else if (diff < -0.4) {
      next.acOn = true;
      next.fanOn = true;
      next.acHeating = false;
      next.currentTemp += Math.max(-0.25, diff * 0.12);
    } else if (Math.abs(diff) < 0.1) {
      next.acOn = false;
      next.fanOn = false;
      next.currentTemp = clamp(
        next.currentTemp + (Math.random() - 0.5) * 0.01,
        next.targetTemp - 0.05,
        next.targetTemp + 0.05
      );
    } else {
      next.acOn = true;
      next.fanOn = true;
      next.acHeating = false;
      next.currentTemp += Math.sign(diff) * Math.min(Math.abs(diff) * 0.08, 0.08);
    }
  } else {
    if (next.acOn) {
      next.currentTemp += next.acHeating ? 0.12 : -0.16;
    } else if (next.fanOn) {
      next.currentTemp -= 0.07;
    } else {
      next.currentTemp += 0.06;
    }
  }

  next.currentTemp = clamp(next.currentTemp, TEMP_MIN, TEMP_MAX);
  next.humidity = clamp(
    56 - (next.acOn && !next.acHeating ? 10 : 0) + (Math.random() - 0.5) * 0.2,
    HUMIDITY_MIN,
    HUMIDITY_MAX,
  );

  return next;
}

function uniqueObjects(objects: SPEObject[]): SPEObject[] {
  const seen = new Set<string>();
  const result: SPEObject[] = [];

  objects.forEach((object) => {
    if (!object?.uuid || seen.has(object.uuid)) {
      return;
    }
    seen.add(object.uuid);
    result.push(object);
  });

  return result;
}

function getLineageNames(object: RuntimeObject, byUuid: Map<string, RuntimeObject>): string[] {
  const names: string[] = [];
  let current: RuntimeObject | undefined = object;
  let depth = 0;

  while (current && depth < 10) {
    if (current.name) {
      names.push(String(current.name));
    }
    if (!current.parentUuid) {
      break;
    }
    current = byUuid.get(current.parentUuid);
    depth += 1;
  }

  return names;
}

function isIntentionallyTransparentName(name: string): boolean {
  return /(glass|window|water|transparent|translucent|pane)/i.test(name);
}

function normalizeNonWallOpacity(allObjects: SPEObject[], wallUuids: Set<string>): void {
  allObjects.forEach((object) => {
    if (!object?.uuid || wallUuids.has(object.uuid)) {
      return;
    }

    if (isIntentionallyTransparentName(String(object.name || ""))) {
      return;
    }

    const material = object.material as { alpha?: number } | undefined;
    if (!material || typeof material.alpha !== "number") {
      return;
    }

    if (material.alpha < 0.98 || material.alpha > 1.02) {
      material.alpha = 1;
    }
  });
}

function getCameraPosition(app: RuntimeApp): Vec3Like | null {
  const direct = app._camera?.position || app.camera?.position;
  if (direct && Number.isFinite(direct.x) && Number.isFinite(direct.y) && Number.isFinite(direct.z)) {
    return direct;
  }

  const fromScene = app._scene?.activeCamera?.position;
  if (fromScene && Number.isFinite(fromScene.x) && Number.isFinite(fromScene.y) && Number.isFinite(fromScene.z)) {
    return fromScene;
  }

  return null;
}

function getOrbitControls(app: RuntimeApp): OrbitControlsLike | null {
  return (
    app.controls?.orbitControls
    || app._controls?.orbitControls
    || app.eventManager?.controlsManager?.orbitControls
    || app._eventManager?.controlsManager?.orbitControls
    || null
  );
}

function resolveWallObjects(app: Application): SPEObject[] {
  const allObjects = app.getAllObjects() as RuntimeObject[];
  if (!allObjects.length) {
    return [];
  }

  const isFurnitureLike = (name: string) =>
    /\b(tv|cabinet|plant|pot|table|chair|sofa|bed|lamp|light|fan|ac|screen|monitor|shelf|desk|door)\b/i.test(name);

  // Prefer deterministic wall cubes for this model and keep all matching instances.
  // Spline may expose multiple runtime objects with the same cube names across states.
  const deterministicWalls = uniqueObjects(
    allObjects.filter((object) => {
      const name = String(object.name || "").trim();
      return WALL_NAME_FALLBACKS.has(name) || /^cube\s*(3|4|5|6|7|8)\b/i.test(name);
    }),
  );
  if (deterministicWalls.length >= 4) {
    return deterministicWalls;
  }

  const byUuid = new Map<string, RuntimeObject>();
  allObjects.forEach((object) => {
    if (object.uuid) {
      byUuid.set(object.uuid, object);
    }
  });

  const picked: SPEObject[] = [];
  const wallGroups = allObjects.filter((object) => /\bwalls?\b/i.test(String(object.name || "")));

  const queue = [...wallGroups];
  const visited = new Set<string>();
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current?.uuid || visited.has(current.uuid)) {
      continue;
    }

    visited.add(current.uuid);
    picked.push(current);

    allObjects.forEach((candidate) => {
      if (!candidate?.uuid || !candidate.parentUuid || visited.has(candidate.uuid)) {
        return;
      }
      if (candidate.parentUuid === current.uuid) {
        queue.push(candidate);
      }
    });
  }

  allObjects.forEach((object) => {
    const name = String(object.name || "").trim();
    if (!name) {
      return;
    }

    if (isFurnitureLike(name)) {
      return;
    }

    if (/\bwalls?\b/i.test(name)) {
      picked.push(object);
      return;
    }

    let parent: RuntimeObject = object;
    for (let depth = 0; depth < 8; depth += 1) {
      if (!parent.parentUuid) {
        break;
      }
      const nextParent = byUuid.get(parent.parentUuid);
      if (!nextParent) {
        break;
      }

      const parentName = String(nextParent.name || "");
      if (/\bwalls?\b/i.test(parentName) && !isFurnitureLike(parentName)) {
        picked.push(object);
        break;
      }
      parent = nextParent;
    }
  });

  return uniqueObjects(picked);
}

function resolveAcTintTarget(app: Application): SPEObject | null {
  const byName = app.findObjectByName("Rectangle") || app.findObjectByName("rectangle");
  if (byName) {
    return byName;
  }

  const allObjects = app.getAllObjects();
  const exact = allObjects.find((object) => /^rectangle$/i.test(String(object?.name || "")));
  if (exact) {
    return exact;
  }

  const fuzzy = allObjects.find((object) => /rectangle/i.test(String(object?.name || "")));
  return fuzzy || null;
}

function resolveBladeSpinAxis(object: SPEObject): RotationAxis {
  const scaleX = Math.abs(toNumber(object.scale?.x, 1));
  const scaleY = Math.abs(toNumber(object.scale?.y, 1));
  const scaleZ = Math.abs(toNumber(object.scale?.z, 1));

  if (scaleX <= scaleY && scaleX <= scaleZ) {
    return "x";
  }
  if (scaleY <= scaleX && scaleY <= scaleZ) {
    return "y";
  }
  return "z";
}

function resolveDominantScaleAxis(object: SPEObject): RotationAxis {
  const scaleX = Math.abs(toNumber(object.scale?.x, 1));
  const scaleY = Math.abs(toNumber(object.scale?.y, 1));
  const scaleZ = Math.abs(toNumber(object.scale?.z, 1));

  if (scaleX >= scaleY && scaleX >= scaleZ) {
    return "x";
  }
  if (scaleY >= scaleX && scaleY >= scaleZ) {
    return "y";
  }
  return "z";
}

function resolveAxisFromBladePositions(blades: SPEObject[]): RotationAxis | null {
  if (blades.length < 2) {
    return null;
  }

  const positions = blades
    .map((blade) => blade.position)
    .filter((position): position is Vec3Like => !!position);
  if (positions.length < 2) {
    return null;
  }

  const mean = positions.reduce(
    (acc, position) => ({
      x: acc.x + toNumber(position.x, 0),
      y: acc.y + toNumber(position.y, 0),
      z: acc.z + toNumber(position.z, 0),
    }),
    { x: 0, y: 0, z: 0 },
  );
  const invCount = 1 / positions.length;
  mean.x *= invCount;
  mean.y *= invCount;
  mean.z *= invCount;

  const variance = positions.reduce(
    (acc, position) => {
      const dx = toNumber(position.x, 0) - mean.x;
      const dy = toNumber(position.y, 0) - mean.y;
      const dz = toNumber(position.z, 0) - mean.z;
      return {
        x: acc.x + dx * dx,
        y: acc.y + dy * dy,
        z: acc.z + dz * dz,
      };
    },
    { x: 0, y: 0, z: 0 },
  );

  if (variance.x <= variance.y && variance.x <= variance.z) {
    return "x";
  }
  if (variance.y <= variance.x && variance.y <= variance.z) {
    return "y";
  }
  return "z";
}

function resolveShaftAxis(app: Application): RotationAxis | null {
  const allObjects = app.getAllObjects();
  const shaft = allObjects.find((object) => {
    const name = String(object?.name || "");
    if (!name) {
      return false;
    }
    return /\bfan\b/i.test(name) && /\b(shaft|axle|hub|center|centre|motor)\b/i.test(name);
  });

  return shaft ? resolveDominantScaleAxis(shaft) : null;
}

function resolveFanBladeBindings(app: Application): FanBladeBinding[] {
  const allObjects = app.getAllObjects();
  const bladeCandidates = allObjects.filter((object) => {
    const name = String(object?.name || "");
    if (!name) {
      return false;
    }
    return /(fan[_\\s-]*blades?|blade|rotor|propeller)/i.test(name);
  });

  const uniqueBlades = uniqueObjects(bladeCandidates);
  const inferredAxis =
    FAN_SPIN_AXIS_OVERRIDE
    || resolveShaftAxis(app)
    || resolveAxisFromBladePositions(uniqueBlades);

  return uniqueBlades.map((object) => ({
    object,
    axis: inferredAxis || resolveBladeSpinAxis(object),
    baseRotation: {
      x: toNumber(object.rotation?.x, 0),
      y: toNumber(object.rotation?.y, 0),
      z: toNumber(object.rotation?.z, 0),
    },
    spinAngle: 0,
  }));
}

function resolveFanHousingBindings(app: Application, bladeUuids: Set<string>): FanHousingBinding[] {
  const allObjects = app.getAllObjects();
  const bodyObjects = allObjects.filter((object) => {
    if (!object?.uuid || bladeUuids.has(object.uuid)) {
      return false;
    }

    const name = String(object.name || "");
    if (!name) {
      return false;
    }

    return /\bfan\b/i.test(name) && !/(blade|rotor|propeller)/i.test(name);
  });

  return uniqueObjects(bodyObjects).map((object) => ({
    object,
    baseRotation: {
      x: toNumber(object.rotation?.x, 0),
      y: toNumber(object.rotation?.y, 0),
      z: toNumber(object.rotation?.z, 0),
    },
  }));
}

function resolveLightBindings(app: Application): LightBinding[] {
  const allObjects = app.getAllObjects();
  const lightObjects = allObjects.filter((object) => {
    const name = String(object?.name || "");
    if (!name) {
      return false;
    }
    return /(light|lamp|bulb|ceiling|chandelier|spot|led)/i.test(name);
  });

  return uniqueObjects(lightObjects).map((object) => ({
    object,
    baseIntensity: Math.max(0, toNumber(object.intensity, 1)),
  }));
}

function resolveTvBindings(app: Application): TvBinding[] {
  const allObjects = app.getAllObjects() as RuntimeObject[];
  const byUuid = new Map<string, RuntimeObject>();
  const childrenByParent = new Map<string, RuntimeObject[]>();
  allObjects.forEach((object) => {
    if (object.uuid) {
      byUuid.set(object.uuid, object);
    }
    if (object.parentUuid) {
      const list = childrenByParent.get(object.parentUuid) || [];
      list.push(object);
      childrenByParent.set(object.parentUuid, list);
    }
  });

  const isTvFurnitureName = (name: string) =>
    /\b(cabinet|stand|table|desk|shelf|drawer|console|rack|plant|pot|flower)\b/i.test(name);
  const hasTvHint = (name: string) => /\b(tv|television|monitor|display)\b/i.test(name);
  const isScreenLikeName = (name: string) => /\b(screen|panel|display|monitor|lcd|oled|led)\b/i.test(name);

  const collectDescendants = (root: RuntimeObject): RuntimeObject[] => {
    if (!root.uuid) {
      return [];
    }

    const result: RuntimeObject[] = [];
    const queue = [...(childrenByParent.get(root.uuid) || [])];
    const seen = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current?.uuid || seen.has(current.uuid)) {
        continue;
      }
      seen.add(current.uuid);
      result.push(current);
      const kids = childrenByParent.get(current.uuid) || [];
      kids.forEach((kid) => queue.push(kid));
    }

    return result;
  };

  const tvRoots = allObjects.filter((object) => {
    const name = String(object?.name || "");
    return !!name && hasTvHint(name) && !isTvFurnitureName(name);
  });

  const candidates: RuntimeObject[] = [];
  tvRoots.forEach((root) => {
    const descendants = collectDescendants(root);
    const screenDescendants = descendants.filter((candidate) => {
      const name = String(candidate?.name || "");
      return !!name && isScreenLikeName(name) && !isTvFurnitureName(name);
    });

    if (screenDescendants.length > 0) {
      candidates.push(...screenDescendants);
      return;
    }

    const nonFurnitureDescendants = descendants.filter((candidate) => {
      const name = String(candidate?.name || "");
      return !!name && !isTvFurnitureName(name);
    });
    candidates.push(...nonFurnitureDescendants);
    candidates.push(root);
  });

  const standaloneScreenNodes = allObjects.filter((object) => {
    const name = String(object?.name || "");
    if (!name || !isScreenLikeName(name) || isTvFurnitureName(name)) {
      return false;
    }
    const lineageNames = getLineageNames(object, byUuid);
    return lineageNames.some((lineageName) => hasTvHint(lineageName) && !isTvFurnitureName(lineageName));
  });
  candidates.push(...standaloneScreenNodes);

  const uniqueCandidates = uniqueObjects(candidates).filter((object) => {
    const name = String(object.name || "");
    return !!name && !isTvFurnitureName(name);
  });

  const meshTargets = uniqueCandidates.filter((object) => !!object.material);
  const finalTargets = meshTargets.length > 0 ? meshTargets : uniqueCandidates;

  return finalTargets.map((object) => ({
    object,
    baseColor: typeof object.color === "string" && object.color ? object.color : "#f2f6ff",
    baseIntensity: Math.max(0, toNumber(object.intensity, 1)),
  }));
}

export default function DigitalTwinApp() {
  const [state, setState] = useState<UiState>(DEFAULT_STATE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [recentLogs, setRecentLogs] = useState<LogEntry[]>([]);
  const [chartLogs, setChartLogs] = useState<LogEntry[]>([]);
  const [telemetryError, setTelemetryError] = useState("");
  const [telemetryMinimized, setTelemetryMinimized] = useState(false);
  const [lightOn, setLightOn] = useState(true);
  const [tvOn, setTvOn] = useState(true);

  const splineRef = useRef<Application | null>(null);
  const wallObjectsRef = useRef<SPEObject[]>([]);
  const roomCenterRef = useRef<Vec3Like | null>(null);
  const wallStateRef = useRef<Map<string, CutawayState>>(new Map());
  const wallScaleCacheRef = useRef<Map<string, Vec3Like>>(new Map());
  const acTintTargetRef = useRef<SPEObject | null>(null);
  const fanBladeBindingsRef = useRef<FanBladeBinding[]>([]);
  const fanHousingBindingsRef = useRef<FanHousingBinding[]>([]);
  const lightBindingsRef = useRef<LightBinding[]>([]);
  const tvBindingsRef = useRef<TvBinding[]>([]);
  const fanSpinSpeedRef = useRef(0);
  const lastFanFrameTimeRef = useRef<number | null>(null);
  const lockedPolarRef = useRef<number | null>(null);
  const lockedCameraYRef = useRef<number | null>(null);
  const lockedTargetYRef = useRef<number | null>(null);
  const stateRef = useRef<UiState>(DEFAULT_STATE);

  const computeRoomCenter = useCallback(() => {
    const walls = wallObjectsRef.current;
    if (!walls.length) {
      roomCenterRef.current = null;
      return;
    }

    let sumX = 0;
    let sumY = 0;
    let sumZ = 0;
    let count = 0;

    walls.forEach((wall) => {
      if (!wall?.position) {
        return;
      }

      const x = toNumber(wall.position.x, NaN);
      const y = toNumber(wall.position.y, NaN);
      const z = toNumber(wall.position.z, NaN);

      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
        return;
      }

      sumX += x;
      sumY += y;
      sumZ += z;
      count += 1;
    });

    roomCenterRef.current = count > 0 ? { x: sumX / count, y: sumY / count, z: sumZ / count } : null;
  }, []);

  const lockVerticalOrbit = useCallback(() => {
    const app = splineRef.current as RuntimeApp | null;
    if (!app) {
      return;
    }

    const controls = getOrbitControls(app);
    if (controls) {
      if (!Number.isFinite(lockedPolarRef.current)) {
        const measuredPolar = typeof controls.getPolarAngle === "function" ? controls.getPolarAngle() : null;
        if (Number.isFinite(measuredPolar)) {
          lockedPolarRef.current = toNumber(measuredPolar, 0);
        }
      }

      if (Number.isFinite(lockedPolarRef.current)) {
        const lockedPolar = toNumber(lockedPolarRef.current, 0);
        controls.minPolarAngle = lockedPolar;
        controls.maxPolarAngle = lockedPolar;
      }

      if (controls.target && Number.isFinite(controls.target.y)) {
        if (!Number.isFinite(lockedTargetYRef.current)) {
          lockedTargetYRef.current = controls.target.y;
        }
        controls.target.y = toNumber(lockedTargetYRef.current, controls.target.y);
      }
    }

    const cameraPosition = getCameraPosition(app);
    if (cameraPosition && Number.isFinite(cameraPosition.y)) {
      if (!Number.isFinite(lockedCameraYRef.current)) {
        lockedCameraYRef.current = cameraPosition.y;
      }

      if (Number.isFinite(lockedCameraYRef.current)) {
        cameraPosition.y = toNumber(lockedCameraYRef.current, cameraPosition.y);
      }
    }

    controls?.update?.();
  }, []);

  const updateFanMotion = useCallback((deltaSeconds: number) => {
    const safeDelta = Math.max(0, Math.min(0.05, deltaSeconds));
    if (safeDelta <= 0) {
      return;
    }

    // Keep fan body static.
    fanHousingBindingsRef.current.forEach((binding) => {
      const rotation = binding.object.rotation;
      if (!rotation) {
        return;
      }
      rotation.x = binding.baseRotation.x;
      rotation.y = binding.baseRotation.y;
      rotation.z = binding.baseRotation.z;
    });

    const targetSpeed = stateRef.current.fanOn ? FAN_SPIN_MAX_SPEED : 0;
    const blend = 1 - Math.exp(-(stateRef.current.fanOn ? FAN_SPIN_ACCEL : FAN_SPIN_DECEL) * safeDelta);
    fanSpinSpeedRef.current += (targetSpeed - fanSpinSpeedRef.current) * blend;

    const speed = fanSpinSpeedRef.current;
    if (Math.abs(speed) < 0.001) {
      fanSpinSpeedRef.current = 0;
      return;
    }

    fanBladeBindingsRef.current.forEach((binding) => {
      const rotation = binding.object.rotation;
      if (!rotation) {
        return;
      }

      binding.spinAngle += speed * safeDelta;
      rotation.x = binding.baseRotation.x;
      rotation.y = binding.baseRotation.y;
      rotation.z = binding.baseRotation.z;
      rotation[binding.axis] = binding.baseRotation[binding.axis] + binding.spinAngle;
    });
  }, []);

  const setWallVisible = useCallback((wall: SPEObject, shouldBeVisible: boolean) => {
    if (!wall) {
      return;
    }

    if (shouldBeVisible) {
      const cachedScale = wall.uuid ? wallScaleCacheRef.current.get(wall.uuid) : null;
      if (cachedScale && wall.scale) {
        wall.scale.x = cachedScale.x;
        wall.scale.y = cachedScale.y;
        wall.scale.z = cachedScale.z;
      }

      if (wall.uuid) {
        wallScaleCacheRef.current.delete(wall.uuid);
      }

      wall.show?.();
      wall.visible = true;

      return;
    }

    if (wall.uuid && wall.scale && !wallScaleCacheRef.current.has(wall.uuid)) {
      wallScaleCacheRef.current.set(wall.uuid, {
        x: toNumber(wall.scale.x, 1),
        y: toNumber(wall.scale.y, 1),
        z: toNumber(wall.scale.z, 1),
      });
    }

    wall.hide?.();
    wall.visible = false;

    if (wall.scale) {
      wall.scale.x = 0.0001;
      wall.scale.y = 0.0001;
      wall.scale.z = 0.0001;
    }
  }, []);

  const applyCutaway = useCallback(() => {
    const app = splineRef.current as RuntimeApp | null;
    const walls = wallObjectsRef.current;

    if (!app || walls.length === 0) {
      return;
    }

    lockVerticalOrbit();

    const cameraPosition = getCameraPosition(app);
    if (!cameraPosition) {
      return;
    }

    if (!roomCenterRef.current) {
      computeRoomCenter();
      if (!roomCenterRef.current) {
        return;
      }
    }

    const center = roomCenterRef.current;
    const camVecX = cameraPosition.x - center.x;
    const camVecY = cameraPosition.y - center.y;
    const camVecZ = cameraPosition.z - center.z;
    const camLength = Math.hypot(camVecX, camVecY, camVecZ) || 1;

    const now = performance.now();

    walls.forEach((wall) => {
      if (!wall?.position || !wall.uuid) {
        return;
      }

      const wallVecX = toNumber(wall.position.x, 0) - center.x;
      const wallVecY = toNumber(wall.position.y, 0) - center.y;
      const wallVecZ = toNumber(wall.position.z, 0) - center.z;
      const wallLength = Math.hypot(wallVecX, wallVecY, wallVecZ) || 1;

      const dot =
        (wallVecX / wallLength) * (camVecX / camLength) +
        (wallVecY / wallLength) * (camVecY / camLength) +
        (wallVecZ / wallLength) * (camVecZ / camLength);

      const distanceToCamera = Math.hypot(
        cameraPosition.x - toNumber(wall.position.x, 0),
        cameraPosition.y - toNumber(wall.position.y, 0),
        cameraPosition.z - toNumber(wall.position.z, 0),
      );

      const cutState = wallStateRef.current.get(wall.uuid) || {
        hidden: false,
        showCandidateSince: 0,
      };

      const shouldHide = dot > WALL_HIDE_DOT_THRESHOLD || distanceToCamera < WALL_HIDE_DISTANCE_THRESHOLD;
      const canShow = dot < WALL_SHOW_DOT_THRESHOLD && distanceToCamera > WALL_SHOW_DISTANCE_THRESHOLD;

      if (shouldHide) {
        cutState.hidden = true;
        cutState.showCandidateSince = 0;
      } else if (cutState.hidden) {
        if (canShow) {
          if (cutState.showCandidateSince === 0) {
            cutState.showCandidateSince = now;
          }
          if (now - cutState.showCandidateSince >= WALL_RESTORE_DELAY_MS) {
            cutState.hidden = false;
            cutState.showCandidateSince = 0;
          }
        } else {
          cutState.showCandidateSince = 0;
        }
      }

      wallStateRef.current.set(wall.uuid, cutState);
      setWallVisible(wall, !cutState.hidden);
    });
  }, [computeRoomCenter, lockVerticalOrbit, setWallVisible]);

  const applyAcTint = useCallback((acOn: boolean, acHeating: boolean) => {
    const target = acTintTargetRef.current;
    if (!target) {
      return;
    }

    try {
      if (acOn && acHeating) {
        (target as SPEObject & { color?: string }).color = "#ff9944";
      } else if (acOn && !acHeating) {
        (target as SPEObject & { color?: string }).color = "#21d9d0";
      } else {
        (target as SPEObject & { color?: string }).color = "#f3f6fb";
      }
    } catch {
      // Keep runtime stable even if this object type does not expose color.
    }

    const material = target.material as { alpha?: number } | undefined;
    if (material && typeof material.alpha === "number") {
      material.alpha = acOn ? 1 : 0.9;
    }
  }, []);

  const applyLightState = useCallback((nextLightOn: boolean) => {
    lightBindingsRef.current.forEach((binding) => {
      const base = Math.max(0, binding.baseIntensity);
      binding.object.intensity = nextLightOn ? base : base * LIGHT_OFF_INTENSITY_FACTOR;
    });
  }, []);

  const applyTvState = useCallback((nextTvOn: boolean) => {
    tvBindingsRef.current.forEach((binding) => {
      try {
        binding.object.color = nextTvOn ? TV_ON_COLOR : TV_OFF_COLOR;
      } catch {
        // Ignore unsupported color writes for non-mesh nodes.
      }

      if (typeof binding.object.intensity === "number") {
        binding.object.intensity = nextTvOn ? binding.baseIntensity : 0;
      }

      const material = binding.object.material as { alpha?: number } | undefined;
      if (material && typeof material.alpha === "number") {
        material.alpha = 1;
      }
    });
  }, []);

  const buildSplineBindings = useCallback((app: Application) => {
    const allObjects = app.getAllObjects();
    const walls = resolveWallObjects(app);
    const wallUuids = new Set(walls.map((wall) => wall.uuid));
    allObjects.forEach((object) => {
      if (!object?.uuid || wallUuids.has(object.uuid)) {
        return;
      }

      const cachedScale = wallScaleCacheRef.current.get(object.uuid);
      if (cachedScale && object.scale) {
        object.scale.x = cachedScale.x;
        object.scale.y = cachedScale.y;
        object.scale.z = cachedScale.z;
        wallScaleCacheRef.current.delete(object.uuid);
      }

      if (!object.visible) {
        object.show?.();
        object.visible = true;
      }
    });
    normalizeNonWallOpacity(allObjects, wallUuids);

    const fanBladeBindings = resolveFanBladeBindings(app);
    const bladeUuids = new Set(fanBladeBindings.map((binding) => binding.object.uuid));
    const fanHousingBindings = resolveFanHousingBindings(app, bladeUuids);
    const lightBindings = resolveLightBindings(app);
    const tvBindings = resolveTvBindings(app);

    // Recover any objects that were previously dimmed by old TV binding logic.
    tvBindingsRef.current.forEach((binding) => {
      try {
        binding.object.color = binding.baseColor;
      } catch {
        // Ignore unsupported color writes.
      }
      if (typeof binding.object.intensity === "number") {
        binding.object.intensity = binding.baseIntensity;
      }
      const material = binding.object.material as { alpha?: number } | undefined;
      if (material && typeof material.alpha === "number") {
        material.alpha = 1;
      }
    });

    wallObjectsRef.current = walls;
    fanBladeBindingsRef.current = fanBladeBindings;
    fanHousingBindingsRef.current = fanHousingBindings;
    lightBindingsRef.current = lightBindings;
    tvBindingsRef.current = tvBindings;
    wallStateRef.current.clear();
    fanSpinSpeedRef.current = 0;
    lastFanFrameTimeRef.current = null;

    computeRoomCenter();
    acTintTargetRef.current = resolveAcTintTarget(app);
    applyLightState(lightOn);
    applyTvState(tvOn);

    console.log("Spline bindings built", {
      wallObjects: walls.map((wall) => wall.name || wall.uuid),
      fanBlades: fanBladeBindings.map(
        (binding) => `${binding.object.name || binding.object.uuid} [axis=${binding.axis}]`,
      ),
      fanBody: fanHousingBindings.map((binding) => binding.object.name || binding.object.uuid),
      lights: lightBindings.map((binding) => binding.object.name || binding.object.uuid),
      tvTargets: tvBindings.map((binding) => binding.object.name || binding.object.uuid),
      acTintTarget: acTintTargetRef.current?.name || acTintTargetRef.current?.uuid || null,
      totalObjects: allObjects.length,
    });
  }, [applyLightState, applyTvState, computeRoomCenter, lightOn, tvOn]);

  const sendLogEntry = useCallback(async (snapshot: UiState) => {
    try {
      await fetch("/api/logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          temperature: snapshot.currentTemp,
          humidity: snapshot.humidity,
          fan_on: snapshot.fanOn,
          ac_on: snapshot.acOn,
          target_temp: snapshot.targetTemp,
          mode: snapshot.mode,
        }),
      });
    } catch {
      // Keep UI responsive when telemetry logging fails.
    }
  }, []);

  const refreshTelemetry = useCallback(async () => {
    try {
      const [statsResponse, logsResponse] = await Promise.all([
        fetch("/api/logs/stats?hours=24", { cache: "no-store" }),
        fetch("/api/logs?limit=120", { cache: "no-store" }),
      ]);

      if (!statsResponse.ok || !logsResponse.ok) {
        throw new Error("Telemetry request failed");
      }

      const statsPayload = (await statsResponse.json()) as StatsResponse;
      const logsPayload = (await logsResponse.json()) as LogEntry[];
      const safeLogs = Array.isArray(logsPayload) ? logsPayload : [];
      setStats(statsPayload);
      setChartLogs(safeLogs);
      setRecentLogs(safeLogs.slice(0, 8));
      setTelemetryError("");
    } catch {
      setTelemetryError("Không tải được dữ liệu thống kê");
    }
  }, []);

  const saveState = useCallback(async (nextState: UiState) => {
    setBusy(true);
    setError("");
    setState(nextState);

    try {
      const response = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toApiState(nextState)),
      });

      if (!response.ok) {
        throw new Error("Failed to save state");
      }

      const payload = (await response.json()) as ApiState;
      const savedState = toUiState(payload);
      setState(savedState);
      await sendLogEntry(savedState);
      await refreshTelemetry();
    } catch {
      setError("Lưu API thất bại, giữ trạng thái cục bộ");
    } finally {
      setBusy(false);
    }
  }, [refreshTelemetry, sendLogEntry]);

  const resetSystem = useCallback(async () => {
    setBusy(true);
    setError("");

    try {
      const resetResponse = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toApiState(DEFAULT_STATE)),
      });

      if (!resetResponse.ok) {
        throw new Error("Failed to reset state");
      }

      await fetch("/api/logs", { method: "DELETE" });

      const payload = (await resetResponse.json()) as ApiState;
      const resetState = toUiState(payload);
      setState(resetState);
      await refreshTelemetry();
    } catch {
      setError("Đặt lại thất bại, vui lòng thử lại");
    } finally {
      setBusy(false);
    }
  }, [refreshTelemetry]);

  useEffect(() => {
    const loadState = async () => {
      try {
        const response = await fetch("/api/state", { cache: "no-store" });
        if (!response.ok) {
          throw new Error("Failed to load state");
        }

        const payload = (await response.json()) as ApiState;
        setState(toUiState(payload));
      } catch {
        setError("Không đọc được API, đang dùng dữ liệu mặc định");
      }
    };

    void loadState();
    void refreshTelemetry();
  }, [refreshTelemetry]);

  useEffect(() => {
    const app = splineRef.current;
    if (!app) {
      return;
    }

    if (typeof app.getVariables === "function" && typeof app.setVariables === "function") {
      const vars = app.getVariables() || {};
      const updates: Record<string, boolean | number> = {};

      const candidates: Array<[string, boolean | number]> = [
        ["ac_on", state.acOn],
        ["acOn", state.acOn],
        ["temperature", state.currentTemp],
        ["target_temp", state.targetTemp],
        ["targetTemp", state.targetTemp],
      ];

      candidates.forEach(([name, value]) => {
        if (Object.prototype.hasOwnProperty.call(vars, name)) {
          updates[name] = value;
        }
      });

      if (Object.keys(updates).length > 0) {
        app.setVariables(updates);
      }
    }

    applyAcTint(state.acOn, state.acHeating);
  }, [applyAcTint, state.acOn, state.acHeating]);

  useEffect(() => {
    applyLightState(lightOn);
  }, [applyLightState, lightOn]);

  useEffect(() => {
    applyTvState(tvOn);
  }, [applyTvState, tvOn]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setState((prev) => simulateStateTick(prev));
    }, SIMULATION_TICK_MS);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    let frame = 0;

    const tick = (now: number) => {
      const lastTime = lastFanFrameTimeRef.current;
      const deltaSeconds = lastTime === null ? 0 : (now - lastTime) / 1000;
      lastFanFrameTimeRef.current = now;

      lockVerticalOrbit();
      updateFanMotion(deltaSeconds);
      frame = window.requestAnimationFrame(tick);
    };

    frame = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(frame);
      lastFanFrameTimeRef.current = null;
    };
  }, [lockVerticalOrbit, updateFanMotion]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      applyCutaway();
    }, CUTAWAY_TICK_MS);

    return () => window.clearInterval(timer);
  }, [applyCutaway]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void sendLogEntry(stateRef.current);
      void refreshTelemetry();
    }, 45000);

    return () => window.clearInterval(timer);
  }, [refreshTelemetry, sendLogEntry]);

  const chartModel = useMemo(() => {
    const chronological = [...chartLogs]
      .filter((log) => Number.isFinite(log.temperature))
      .sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp));

    if (chronological.length < 2) {
      return null;
    }

    const values = chronological.map((log) => log.temperature);
    const minTemp = Math.min(...values);
    const maxTemp = Math.max(...values);
    const range = Math.max(maxTemp - minTemp, 0.5);
    const minY = minTemp - 0.15 * range;
    const maxY = maxTemp + 0.15 * range;
    const width = 100;
    const height = 36;

    const path = chronological
      .map((log, index) => {
        const x = chronological.length === 1 ? 0 : (index / (chronological.length - 1)) * width;
        const y = height - ((log.temperature - minY) / (maxY - minY)) * height;
        return `${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

    const targetY = height - ((state.targetTemp - minY) / (maxY - minY)) * height;
    const firstLabel = formatLogTime(chronological[0].timestamp);
    const lastLabel = formatLogTime(chronological[chronological.length - 1].timestamp);

    return {
      path,
      targetY: clamp(targetY, 0, height),
      firstLabel,
      lastLabel,
      samples: chronological.length,
    };
  }, [chartLogs, state.targetTemp]);

  const modeLabel = useMemo(() => (state.mode === "auto" ? "Chế độ tự động" : "Chế độ thủ công"), [state.mode]);

  return (
    <main className="dt-shell">
      <section className="dt-panel dt-panel-left">
        <div className="dt-head">
          <p className="dt-eyebrow">Bản sao số thời gian thực</p>
          <h1 className="dt-title">Điều khiển phòng thông minh</h1>
          <p className="dt-subtitle">Đặt nhiệt độ mục tiêu, điều khiển thủ công và theo dõi mô hình 3D trực tiếp.</p>
        </div>

        <div className="dt-temp-card">
          <span className="dt-temp-label">Nhiệt độ hiện tại</span>
          <strong className="dt-temp-value">{state.currentTemp.toFixed(1)}&deg;C</strong>
          <div className="dt-chip-row">
            <span className="dt-chip">{modeLabel}</span>
            <span className="dt-chip">Mục tiêu {state.targetTemp.toFixed(1)}&deg;C</span>
          </div>
        </div>

        <div className="dt-grid">
          <div>
            <span>Độ ẩm</span>
            <strong>{state.humidity.toFixed(0)}%</strong>
          </div>
          <div>
            <span>Quạt</span>
            <strong>{state.fanOn ? "BẬT" : "TẮT"}</strong>
          </div>
          <div>
            <span>Điều hòa</span>
            <strong>{state.acOn ? "BẬT" : "TẮT"}</strong>
          </div>
          <div>
            <span>Nhiệt độ TB 24h</span>
            <strong>{formatTemp(stats?.avg_temp)}</strong>
          </div>
        </div>

        <div className="dt-control-card">
          <label className="dt-range-label" htmlFor="target-range">
            Đặt nhiệt độ mục tiêu
          </label>
          <input
            id="target-range"
            type="range"
            min={20}
            max={50}
            step={0.5}
            value={state.targetTemp}
            onChange={(event) => {
              const targetTemp = Number(event.target.value);
              void saveState({ ...state, targetTemp });
            }}
          />

          <div className="dt-actions">
            <button
              type="button"
              className={state.mode === "auto" ? "active" : ""}
              onClick={() => void saveState({ ...state, mode: "auto" })}
            >
              Tự động
            </button>
            <button
              type="button"
              className={state.mode === "manual" ? "active" : ""}
              onClick={() => void saveState({ ...state, mode: "manual" })}
            >
              Thủ công
            </button>
            <button
              type="button"
              disabled={state.mode !== "manual"}
              className={state.fanOn ? "active" : ""}
              onClick={() => void saveState({ ...state, fanOn: !state.fanOn })}
            >
              Quạt
            </button>
            <button
              type="button"
              disabled={state.mode !== "manual"}
              className={state.acOn ? "active" : ""}
              onClick={() => void saveState({ ...state, acOn: !state.acOn })}
            >
              Điều hòa
            </button>
          </div>
          <div className="dt-actions dt-actions-secondary">
            <button
              type="button"
              className={lightOn ? "active" : ""}
              onClick={() => setLightOn((prev) => !prev)}
            >
              Đèn {lightOn ? "BẬT" : "TẮT"}
            </button>
            <button
              type="button"
              className={tvOn ? "active" : ""}
              onClick={() => setTvOn((prev) => !prev)}
            >
              TV {tvOn ? "BẬT" : "TẮT"}
            </button>
          </div>
          <button
            type="button"
            className="dt-reset-btn"
            onClick={() => void resetSystem()}
            disabled={busy}
          >
            Đặt lại hệ thống
          </button>
        </div>

        <div className="dt-control-card dt-chart-card">
          <div className="dt-chart-head">
            <span>Biểu đồ nhiệt độ (24h)</span>
            <strong>{chartModel ? `${chartModel.samples} mẫu` : "Chưa có dữ liệu"}</strong>
          </div>
          <div className="dt-chart-shell">
            {chartModel ? (
              <svg viewBox="0 0 100 36" preserveAspectRatio="none" aria-label="Temperature trend chart">
                <line x1="0" y1={chartModel.targetY} x2="100" y2={chartModel.targetY} className="dt-chart-target" />
                <polyline points={chartModel.path} className="dt-chart-line" />
              </svg>
            ) : (
              <p className="dt-chart-empty">Đang chờ dữ liệu...</p>
            )}
          </div>
          {chartModel ? (
            <div className="dt-chart-foot">
              <span>{chartModel.firstLabel}</span>
              <span>Mục tiêu {state.targetTemp.toFixed(1)}°C</span>
              <span>{chartModel.lastLabel}</span>
            </div>
          ) : null}
        </div>

        {busy ? <p className="dt-note">Đang lưu...</p> : null}
        {error ? <p className="dt-note dt-note-error">{error}</p> : null}
      </section>

      <section className="dt-panel dt-scene-wrap">
        <Spline
          scene={SCENE_URL}
          onLoad={(app) => {
            splineRef.current = app;
            buildSplineBindings(app);
            lockVerticalOrbit();
            applyAcTint(state.acOn, state.acHeating);
            applyCutaway();
          }}
        />
        <aside className={`dt-scene-right${telemetryMinimized ? " is-minimized" : ""}`}>
          <div className="dt-scene-right-head">
            <p className="dt-scene-right-title">Thống kê 24h</p>
            <button
              type="button"
              className="dt-scene-right-toggle"
              onClick={() => setTelemetryMinimized((prev) => !prev)}
              aria-expanded={!telemetryMinimized}
            >
              {telemetryMinimized ? "Mở rộng" : "Thu gọn"}
            </button>
          </div>

          {telemetryMinimized ? (
            <p className="dt-scene-right-collapsed">
              TB {formatTemp(stats?.avg_temp)} | Bản ghi {stats?.total_records ?? 0}
            </p>
          ) : (
            <>
              <div className="dt-scene-right-metrics">
                <div className="dt-scene-right-row">
                  <span>Nhiệt độ TB</span>
                  <strong>{formatTemp(stats?.avg_temp)}</strong>
                </div>
                <div className="dt-scene-right-row">
                  <span>Cao / Thấp</span>
                  <strong>{formatTemp(stats?.max_temp)} / {formatTemp(stats?.min_temp)}</strong>
                </div>
                <div className="dt-scene-right-row">
                  <span>Độ ẩm TB</span>
                  <strong>{formatPercent(stats?.avg_humidity ?? null)}</strong>
                </div>
                <div className="dt-scene-right-row">
                  <span>Bản ghi</span>
                  <strong>{stats?.total_records ?? 0}</strong>
                </div>
                <div className="dt-scene-right-row">
                  <span>Quạt / Điều hòa hoạt động</span>
                  <strong>{stats?.fan_on_time ?? 0} / {stats?.ac_on_time ?? 0}</strong>
                </div>
              </div>

              <p className="dt-scene-right-subtitle">Nhật ký gần đây</p>
              <ul className="dt-log-list">
                {recentLogs.length === 0 ? (
                  <li className="dt-log-empty">Chưa có dữ liệu thống kê.</li>
                ) : (
                  recentLogs.map((log) => (
                    <li key={log.id} className="dt-log-row">
                      <span>{formatLogTime(log.timestamp)}</span>
                      <span>{formatTemp(log.temperature)}</span>
                      <span>{formatPercent(log.humidity)}</span>
                      <span>{formatMode(log.mode)}</span>
                    </li>
                  ))
                )}
              </ul>
              {telemetryError ? <p className="dt-scene-right-error">{telemetryError}</p> : null}
            </>
          )}
        </aside>
      </section>
    </main>
  );
}
