import { NextResponse } from "next/server";
import { clearLogs, createLog, listLogs, type LogCreate, type Mode } from "@/lib/store";

export const runtime = "nodejs";

function isValidMode(value: unknown): value is Mode {
  return value === "auto" || value === "manual";
}

function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function toOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (!isValidNumber(value)) {
    return null;
  }
  return value;
}

function isLogPayload(value: unknown): value is LogCreate {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    isValidNumber(payload.temperature) &&
    payload.temperature >= 0 &&
    payload.temperature <= 100 &&
    (payload.humidity === undefined ||
      payload.humidity === null ||
      (isValidNumber(payload.humidity) && payload.humidity >= 0 && payload.humidity <= 100)) &&
    typeof payload.fan_on === "boolean" &&
    typeof payload.ac_on === "boolean" &&
    (payload.target_temp === undefined ||
      payload.target_temp === null ||
      (isValidNumber(payload.target_temp) &&
        payload.target_temp >= 0 &&
        payload.target_temp <= 100)) &&
    isValidMode(payload.mode)
  );
}

function parseDateParam(value: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  return parsed;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number.parseInt(url.searchParams.get("limit") ?? "100", 10);
  const offset = Number.parseInt(url.searchParams.get("offset") ?? "0", 10);
  const startTimeRaw = url.searchParams.get("start_time");
  const endTimeRaw = url.searchParams.get("end_time");

  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    return NextResponse.json({ error: "limit must be an integer between 1 and 1000" }, { status: 400 });
  }

  if (!Number.isInteger(offset) || offset < 0) {
    return NextResponse.json({ error: "offset must be an integer >= 0" }, { status: 400 });
  }

  const startTime = parseDateParam(startTimeRaw);
  const endTime = parseDateParam(endTimeRaw);

  if (startTimeRaw && !startTime) {
    return NextResponse.json({ error: "start_time must be a valid datetime" }, { status: 400 });
  }

  if (endTimeRaw && !endTime) {
    return NextResponse.json({ error: "end_time must be a valid datetime" }, { status: 400 });
  }

  const logs = listLogs({
    limit,
    offset,
    start_time: startTime,
    end_time: endTime,
  });

  return NextResponse.json(logs);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (!isLogPayload(body)) {
      return NextResponse.json({ error: "Invalid log payload" }, { status: 400 });
    }

    const log = createLog({
      temperature: body.temperature,
      humidity: toOptionalNumber(body.humidity),
      fan_on: body.fan_on,
      ac_on: body.ac_on,
      target_temp: toOptionalNumber(body.target_temp),
      mode: body.mode,
    });

    return NextResponse.json(log, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Failed to parse request body" }, { status: 400 });
  }
}

export async function DELETE() {
  clearLogs();
  return NextResponse.json({ message: "All logs cleared" });
}
