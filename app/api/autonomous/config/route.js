// API route: /api/autonomous/config — Configuration management for Autonomous Brain Trader.

import { NextResponse } from "next/server";
import { getConfig, setConfig } from "../../../../lib/autonomous/store.js";
import { broadcast } from "../../../../lib/realtime.js";

export async function GET() {
  try {
    const config = await getConfig();
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const patch = await req.json();
    const config = await setConfig(patch);
    broadcast({ type: "autonomous_changed" });
    return NextResponse.json({ ok: true, config });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function PUT(req) {
  return POST(req);
}
