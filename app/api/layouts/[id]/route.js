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

export async function PATCH(req, context) {
  const params = await context.params;
  const id = params.id;
  try {
    const body = await req.json();
    const { layoutsCol } = await getCols();
    
    const updateFields = {};
    if (body.name) updateFields.name = body.name;
    if (body.layoutMode) updateFields.layoutMode = body.layoutMode;
    if (body.panes) updateFields.panes = body.panes;
    if (body.gridFractions) updateFields.gridFractions = body.gridFractions;
    if (body.syncOpts) updateFields.syncOpts = body.syncOpts;
    if (body.drawings) updateFields.drawings = body.drawings;
    
    await layoutsCol.updateOne({ _id: new ObjectId(id) }, { $set: updateFields });
    
    const layouts = await layoutsCol.find({}).sort({ createdAt: 1 }).toArray();
    return NextResponse.json({ ok: true, layouts });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
