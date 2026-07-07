import { NextResponse } from "next/server";
import { ObjectId } from "mongodb";

export const json = (body, status = 200) =>
  NextResponse.json(body, { status });

// Safe ObjectId parse — malformed ids become null instead of throwing a 500.
export const oid = (id) => (ObjectId.isValid(id) ? new ObjectId(id) : null);
