import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { getCols } from "@/lib/mongo";

export async function DELETE(req, context) {
  const params = await context.params;
  const id = params.id;
  try {
    const { layoutsCol } = await getCols();
    await layoutsCol.deleteOne({ _id: new ObjectId(id) });
    const layouts = await layoutsCol.find({}).sort({ createdAt: 1 }).toArray();
    return NextResponse.json({ ok: true, layouts });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
