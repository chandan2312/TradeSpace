// API route: /api/autonomous/trades/[id] — Single trade management.

import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { autonomousCols } from "../../../../../lib/autonomous/store.js";
import { closeActiveTrade, dismissStagedTrade } from "../../../../../lib/autonomous/engine.js";

const oid = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);

export async function GET(req, { params }) {
  try {
    const { id } = await params;
    const { tradesCol } = await autonomousCols();
    const trade = await tradesCol.findOne({ _id: oid(id) });
    if (!trade) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true, trade });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function DELETE(req, { params }) {
  try {
    const { id } = await params;
    const res = await dismissStagedTrade(id);
    return NextResponse.json(res);
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (body.action === "close") {
      const res = await closeActiveTrade(id, body.reason || "Trader close via trade route");
      return NextResponse.json(res);
    }
    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
