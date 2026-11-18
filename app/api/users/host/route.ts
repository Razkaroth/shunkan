/** The admin's install-wide switches: PUT {restrictedSignups}. */
import { loginRedirect, requestAccountId, requestProfile, setRestrictedSignups, usersErrorResponse, usersSnapshot } from "@/src/server";

export const dynamic = "force-dynamic";

export async function PUT(req: Request) {
	const accountId = await requestAccountId(req);
	if (!accountId) return loginRedirect(req);
	const caller = requestProfile(req);
	if (!caller || caller.ownerId !== accountId) {
		return Response.json({ error: caller ? "That profile belongs to another account." : "Choose a profile first." }, { status: caller ? 403 : 401 });
	}
	const body = (await req.json().catch(() => ({}))) as { restrictedSignups?: unknown };
	try {
		setRestrictedSignups(req, body.restrictedSignups);
		return Response.json({ host: usersSnapshot(req, accountId).host });
	} catch (err) {
		return usersErrorResponse(err);
	}
}
