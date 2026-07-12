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
