// API route: /api/autonomous/trades/[id] — Single trade management.

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
import { ObjectId } from "mongodb";
import { autonomousCols } from "../../../../../lib/autonomous/store.js";
import { closeActiveTrade, dismissStagedTrade, modifyTradeTarget } from "../../../../../lib/autonomous/engine.js";

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

export async function PATCH(req, { params }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    const res = await modifyTradeTarget(id, {
      targetRR: body.targetRR,
      tpPrice: body.tpPrice,
    });
    return NextResponse.json(res, { status: res.ok ? 200 : 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}

export async function POST(req, { params }) {
  try {
    const { id } = await params;
    const body = await req.json().catch(() => ({}));
    if (body.action === "close") {
      const res = await closeActiveTrade(id, body.reason || "Trader close via trade route", Boolean(body.closeSiblings));
      return NextResponse.json(res);
    }
    if (body.action === "modify_target" || body.action === "update_rr") {
      const res = await modifyTradeTarget(id, {
        targetRR: body.targetRR,
        tpPrice: body.tpPrice,
      });
      return NextResponse.json(res, { status: res.ok ? 200 : 400 });
    }
    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}
