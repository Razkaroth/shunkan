/**
 * Edit or delete one profile. Everyone edits their own name, color, PIN,
 * and language; the admin edits anyone and deletes members.
 */
import { deleteProfile, updateProfile, usersErrorResponse } from "@/src/server";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const body = (await req.json().catch(() => ({}))) as { name?: unknown; color?: unknown; pin?: unknown; language?: unknown; stripeCustomerId?: unknown };
	try {
		return Response.json({ profile: updateProfile(req, id, body) });
	} catch (err) {
		return usersErrorResponse(err);
	}
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	try {
		deleteProfile(req, id);
		return Response.json({ ok: true });
	} catch (err) {
		return usersErrorResponse(err);
	}
}
