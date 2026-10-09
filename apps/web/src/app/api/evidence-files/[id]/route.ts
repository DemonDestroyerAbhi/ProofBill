import { NextResponse, type NextRequest } from "next/server";
import { getEvidenceFile } from "@proofbill/services";
import { currentUser } from "@/lib/session";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  const f = await getEvidenceFile(id, { userId: user?.id, portalToken: req.nextUrl.searchParams.get("t") });
  if (!f) return NextResponse.json({ error: "not found" }, { status: 404 });
  const inline = /^(image\/|application\/pdf|text\/plain)/.test(f.mime);
  return new NextResponse(new Uint8Array(f.bytes), {
    headers: {
      "Content-Type": f.mime,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${f.name.replace(/"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
      "Cache-Control": "private, max-age=300",
    },
  });
}
