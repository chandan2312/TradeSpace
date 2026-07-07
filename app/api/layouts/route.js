import { NextResponse } from "next/server";
import { getCols } from "@/lib/mongo";

export async function GET() {
  const { layoutsCol } = await getCols();
  const layouts = await layoutsCol.find({}).sort({ createdAt: 1 }).toArray();
  return NextResponse.json({ ok: true, layouts });
}

export async function POST(req) {
  try {
    const body = await req.json();
    if (!body.name || !body.layoutMode || !body.panes) {
      return NextResponse.json({ ok: false, error: "Missing layout details" }, { status: 400 });
    }
    const { layoutsCol } = await getCols();
    const doc = {
      name: body.name,
      layoutMode: body.layoutMode,
      panes: body.panes,
      syncOpts: body.syncOpts || { symbol: false, tf: false, time: false, crosshair: false },
      createdAt: new Date(),
    };
    await layoutsCol.insertOne(doc);
    const layouts = await layoutsCol.find({}).sort({ createdAt: 1 }).toArray();
    return NextResponse.json({ ok: true, layouts });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
