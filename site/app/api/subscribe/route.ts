import { NextRequest, NextResponse } from "next/server";

const API_URL = process.env.LEADS_API_URL || "http://leads-api:3400";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const res = await fetch(`${API_URL}/subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ error: "upstream error" }, { status: 502 });
  }
}
