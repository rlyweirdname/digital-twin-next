import { NextResponse } from "next/server";
import { getState, updateState } from "@/lib/store";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(getState());
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    
    const nextState = {
      current_temp: Number(body.current_temp) || 28,
      target_temp: Number(body.target_temp) || 28,
      humidity: Number(body.humidity) || 55,
      fan_on: Boolean(body.fan_on),
      ac_on: Boolean(body.ac_on),
      mode: body.mode === "auto" || body.mode === "manual" ? body.mode : "auto",
    };

    const result = updateState(nextState);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: "Failed", detail: String(err) }, { status: 400 });
  }
}
