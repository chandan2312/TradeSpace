import { NextResponse } from "next/server";
import { getCols } from "@/lib/mongo";

export async function GET() {
  const { settingsCol } = await getCols();
  const doc = await settingsCol.findOne({ type: "checklist" });
  return NextResponse.json({ ok: true, checklist: doc ? doc.items : [] });
}

export async function PUT(req) {
  try {
    const body = await req.json();
    if (!Array.isArray(body.items)) {
      return NextResponse.json({ ok: false, error: "Missing items array" }, { status: 400 });
    }
    const { settingsCol } = await getCols();
    await settingsCol.updateOne(
      { type: "checklist" },
      { $set: { items: body.items, updatedAt: new Date() } },
      { upsert: true }
    );
    return NextResponse.json({ ok: true, checklist: body.items });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
