import { NextResponse } from "next/server";
import { getStats } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const hoursParam = url.searchParams.get("hours");
  const hours = hoursParam ? Number.parseInt(hoursParam, 10) : 24;

  if (!Number.isInteger(hours) || hours < 1 || hours > 168) {
    return NextResponse.json(
      { error: "hours must be an integer between 1 and 168" },
      { status: 400 },
    );
  }

  return NextResponse.json(getStats(hours));
}
