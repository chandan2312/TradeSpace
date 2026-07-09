import { NextResponse } from "next/server";
import { getCols } from "@/lib/mongo";

export async function GET(req, { params }) {
  try {
    const { symbol } = params;
    const { settingsCol } = await getCols();
    
    // Fetch specific symbol notes
    let doc = await settingsCol.findOne({ type: "symbol_notes", symbol });
    
    // Fallback to global checklist if the symbol is brand new
    if (!doc) {
      const globalChecklist = await settingsCol.findOne({ type: "checklist" });
      return NextResponse.json({ 
        ok: true, 
        checklist: globalChecklist ? globalChecklist.items : [], 
        notes: "" 
      });
    }

    return NextResponse.json({ 
      ok: true, 
      checklist: doc.checklist || [], 
      notes: doc.notes || "" 
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function PUT(req, { params }) {
  try {
    const { symbol } = params;
    const body = await req.json();
    
    if (!Array.isArray(body.checklist)) {
      return NextResponse.json({ ok: false, error: "Missing checklist array" }, { status: 400 });
    }

    const { settingsCol } = await getCols();
    await settingsCol.updateOne(
      { type: "symbol_notes", symbol },
      { 
        $set: { 
          checklist: body.checklist, 
          notes: body.notes || "", 
          updatedAt: new Date() 
        } 
      },
      { upsert: true }
    );
    
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
