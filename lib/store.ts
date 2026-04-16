import fs from "node:fs";
import path from "node:path";

export type Mode = "auto" | "manual";

export interface SystemState {
  current_temp: number;
  target_temp: number;
  humidity: number;
  fan_on: boolean;
  ac_on: boolean;
  mode: Mode;
}

export interface LogCreate {
  temperature: number;
  humidity?: number | null;
  fan_on: boolean;
  ac_on: boolean;
  target_temp?: number | null;
  mode: Mode;
}

export interface LogEntry {
  id: number;
  timestamp: string;
  temperature: number;
  humidity?: number | null;
  fan_on: boolean;
  ac_on: boolean;
  target_temp?: number | null;
  mode: Mode;
}

export interface StatsResponse {
  avg_temp: number;
  max_temp: number;
  min_temp: number;
  avg_humidity: number | null;
  total_records: number;
  fan_on_time: number;
  ac_on_time: number;
}

interface StoreData {
  state: SystemState;
  logs: LogEntry[];
  next_id: number;
}

const DATA_DIR = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "digital_twin.json");

const DEFAULT_STATE: SystemState = {
  current_temp: 28,
  target_temp: 28,
  humidity: 55,
  fan_on: false,
  ac_on: false,
  mode: "auto",
};

const DEFAULT_STORE: StoreData = {
  state: DEFAULT_STATE,
  logs: [],
  next_id: 1,
};

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function ensureStore(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(DEFAULT_STORE, null, 2), "utf8");
  }
}

function readStore(): StoreData {
  ensureStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as StoreData;
    if (!parsed || !parsed.state || !Array.isArray(parsed.logs)) {
      return { ...DEFAULT_STORE };
    }
    return {
      state: parsed.state,
      logs: parsed.logs,
      next_id: typeof parsed.next_id === "number" ? parsed.next_id : parsed.logs.length + 1,
    };
  } catch {
    return { ...DEFAULT_STORE };
  }
}

function writeStore(store: StoreData): void {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

export function getState(): SystemState {
  return readStore().state;
}

export function updateState(nextState: SystemState): SystemState {
  const store = readStore();
  store.state = nextState;
  writeStore(store);
  return nextState;
}

export function createLog(input: LogCreate): LogEntry {
  const store = readStore();
  const entry: LogEntry = {
    id: store.next_id,
    timestamp: new Date().toISOString(),
    temperature: round2(input.temperature),
    humidity: input.humidity ?? null,
    fan_on: input.fan_on,
    ac_on: input.ac_on,
    target_temp: input.target_temp ?? null,
    mode: input.mode,
  };

  store.logs.push(entry);
  store.next_id += 1;
  store.state = {
    current_temp: round2(input.temperature),
    target_temp: round2(input.target_temp ?? store.state.target_temp),
    humidity: round2(input.humidity ?? store.state.humidity),
    fan_on: input.fan_on,
    ac_on: input.ac_on,
    mode: input.mode,
  };
  writeStore(store);
  return entry;
}

export function listLogs(params: {
  limit: number;
  offset: number;
  start_time?: Date;
  end_time?: Date;
}): LogEntry[] {
  const { limit, offset, start_time, end_time } = params;
  const store = readStore();

  const filtered = store.logs
    .filter((log) => {
      const timestamp = new Date(log.timestamp);
      if (start_time && timestamp < start_time) return false;
      if (end_time && timestamp > end_time) return false;
      return true;
    })
    .sort((a, b) => +new Date(b.timestamp) - +new Date(a.timestamp));

  return filtered.slice(offset, offset + limit);
}

export function clearLogs(): void {
  const store = readStore();
  store.logs = [];
  writeStore(store);
}

export function getStats(hours: number): StatsResponse {
  const store = readStore();
  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const filtered = store.logs.filter((entry) => +new Date(entry.timestamp) >= cutoff);

  if (!filtered.length) {
    return {
      avg_temp: 0,
      max_temp: 0,
      min_temp: 0,
      avg_humidity: null,
      total_records: 0,
      fan_on_time: 0,
      ac_on_time: 0,
    };
  }

  const temperatures = filtered.map((entry) => entry.temperature);
  const humiditySamples = filtered
    .map((entry) => entry.humidity)
    .filter((value): value is number => typeof value === "number");

  const avgTemp =
    temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length;
  const avgHumidity = humiditySamples.length
    ? humiditySamples.reduce((sum, value) => sum + value, 0) / humiditySamples.length
    : null;

  return {
    avg_temp: round2(avgTemp),
    max_temp: round2(Math.max(...temperatures)),
    min_temp: round2(Math.min(...temperatures)),
    avg_humidity: avgHumidity === null ? null : round2(avgHumidity),
    total_records: filtered.length,
    fan_on_time: filtered.filter((entry) => entry.fan_on).length,
    ac_on_time: filtered.filter((entry) => entry.ac_on).length,
  };
}
