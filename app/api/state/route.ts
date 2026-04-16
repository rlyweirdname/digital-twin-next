import { NextResponse } from "next/server";
import { getState, type Mode, type SystemState, updateState } from "@/lib/store";

export const runtime = "nodejs";

function isValidMode(value: unknown): value is Mode {
  return value === "auto" || value === "manual";
}

function isValidNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isSystemState(value: unknown): value is SystemState {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    isValidNumber(payload.current_temp) &&
    isValidNumber(payload.target_temp) &&
    isValidNumber(payload.humidity) &&
    typeof payload.fan_on === "boolean" &&
    typeof payload.ac_on === "boolean" &&
    isValidMode(payload.mode)
  );
}

export async function GET() {
  return NextResponse.json(getState());
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    if (!isSystemState(body)) {
      return NextResponse.json({ error: "Invalid state payload" }, { status: 400 });
    }

    const nextState = updateState(body);
    return NextResponse.json(nextState);
  } catch {
    return NextResponse.json({ error: "Failed to parse request body" }, { status: 400 });
  }
}
