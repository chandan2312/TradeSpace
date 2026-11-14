import { NextResponse } from "next/server";
import { getCols } from "@/lib/mongo";

export const dynamic = "force-dynamic";

const g = globalThis;
if (!g._tsLayoutsInFlight) g._tsLayoutsInFlight = null;
let cachedLayouts = null;
let cachedLayoutsAt = 0;
const LAYOUTS_CACHE_MS = 3000;

export async function GET() {
  const now = Date.now();
  if (cachedLayouts && now - cachedLayoutsAt < LAYOUTS_CACHE_MS) {
    return NextResponse.json({ ok: true, layouts: cachedLayouts });
  }

  if (g._tsLayoutsInFlight) {
    try {
      const layouts = await g._tsLayoutsInFlight;
      return NextResponse.json({ ok: true, layouts });
    } catch (err) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
    }
  }

  g._tsLayoutsInFlight = (async () => {
    try {
      const { layoutsCol } = await getCols();
      const layouts = await layoutsCol.find({}).sort({ createdAt: 1 }).toArray();
      cachedLayouts = layouts;
      cachedLayoutsAt = Date.now();
      return layouts;
    } finally {
      g._tsLayoutsInFlight = null;
    }
  })();

  try {
    const layouts = await g._tsLayoutsInFlight;
    return NextResponse.json({ ok: true, layouts });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    cachedLayouts = null;
    cachedLayoutsAt = 0;
    const body = await req.json();
    if (!body.name || !body.layoutMode || !body.panes) {
      return NextResponse.json({ ok: false, error: "Missing layout details" }, { status: 400 });
    }
    const { layoutsCol } = await getCols();
    const doc = {
      name: body.name,
      layoutMode: body.layoutMode,
      panes: body.panes,
      gridFractions: body.gridFractions,
      syncOpts: body.syncOpts || { symbol: false, tf: false, time: false, crosshair: false },
      drawings: body.drawings || "{}",
      createdAt: new Date(),
    };
    await layoutsCol.updateOne({ name: body.name }, { $set: doc }, { upsert: true });
    const layouts = await layoutsCol.find({}).sort({ createdAt: 1 }).toArray();
    return NextResponse.json({ ok: true, layouts });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    cachedLayouts = null;
    cachedLayoutsAt = 0;
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const name = searchParams.get("name");
    const { layoutsCol } = await getCols();
    
    if (id) {
      const { ObjectId } = require("mongodb");
      await layoutsCol.deleteOne({ _id: new ObjectId(id) });
    } else if (name) {
      await layoutsCol.deleteOne({ name });
    }
    
    const layouts = await layoutsCol.find({}).sort({ createdAt: 1 }).toArray();
    return NextResponse.json({ ok: true, layouts });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
