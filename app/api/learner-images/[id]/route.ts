/** Bytes for the profile that owns this image. A different profile gets nothing. No public URL. */
import { learnerImageResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	return learnerImageResponse(req, id);
}
