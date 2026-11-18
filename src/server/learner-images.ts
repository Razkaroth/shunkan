/**
 * Browser image uploads land in the private `learner-images` collection.
 * The product route is the only reader, and only for the profile that owns the bytes.
 */
import * as fs from "node:fs";
import path from "node:path";
import { learnerImageDir } from "../../collections/LearnerImages.ts";
import { requestProfile, UsersError } from "./users.ts";

const MIME = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const MAX_BYTES = 6_000_000;

export interface StoredLearnerImage {
	id: string;
	profileId: string;
	mimeType: string;
	bytes: Buffer;
}

interface ImageStore {
	save(image: { profileId: string; mimeType: string; bytes: Buffer }): Promise<StoredLearnerImage>;
	read(id: string): Promise<StoredLearnerImage | null>;
}

const memory = new Map<string, StoredLearnerImage>();
let sequence = 0;

const memoryStore: ImageStore = {
	async save(image) {
		const id = `img_${++sequence}`;
		const stored = { id, ...image };
		memory.set(id, stored);
		return stored;
	},
	async read(id) {
		return memory.get(id) ?? null;
	},
};

const payloadStore: ImageStore = {
	async save(image) {
		const { getPayload } = await import("payload");
		const { default: config } = await import("../../payload.config.ts");
		const payload = await getPayload({ config });
		const doc = await payload.create({
			collection: "learner-images",
			data: { profileId: image.profileId },
			file: {
				data: image.bytes,
				mimetype: image.mimeType,
				name: "learner-image",
				size: image.bytes.length,
			},
			overrideAccess: true,
		});
		return { id: String(doc.id), profileId: image.profileId, mimeType: image.mimeType, bytes: image.bytes };
	},
	async read(id) {
		const { getPayload } = await import("payload");
		const { default: config } = await import("../../payload.config.ts");
		const payload = await getPayload({ config });
		const doc = await payload.findByID({ collection: "learner-images", id, overrideAccess: true, disableErrors: true });
		if (!doc || typeof doc.profileId !== "string" || typeof doc.filename !== "string" || typeof doc.mimeType !== "string") return null;
		const filename = path.basename(doc.filename);
		const bytes = fs.readFileSync(path.join(learnerImageDir(), filename));
		return { id: String(doc.id), profileId: doc.profileId, mimeType: doc.mimeType, bytes };
	},
};

let store: ImageStore = payloadStore;

/** Tests keep the bytes in memory. Production uses the Payload collection. */
export function configureLearnerImageStore(next: ImageStore | "memory" | "payload"): void {
	if (next === "memory") store = memoryStore;
	else if (next === "payload") store = payloadStore;
	else store = next;
}

export function resetLearnerImageStore(): void {
	memory.clear();
	sequence = 0;
	store = payloadStore;
}

function decodeImage(data: unknown, mimeType: unknown): { bytes: Buffer; mimeType: string } {
	if (typeof mimeType !== "string" || !MIME.has(mimeType)) throw new UsersError(400, "Use a png, jpeg, gif, or webp image.");
	if (typeof data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw new UsersError(400, "The image data is not valid.");
	const bytes = Buffer.from(data, "base64");
	if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new UsersError(400, "The image data is not valid.");
	return { bytes, mimeType };
}

export async function saveLearnerImage(profileId: string, data: unknown, mimeType: unknown): Promise<string> {
	const image = decodeImage(data, mimeType);
	const stored = await store.save({ profileId, mimeType: image.mimeType, bytes: image.bytes });
	return stored.id;
}

/** Bytes for this profile only. A different profile gets nothing. */
export async function readLearnerImage(profileId: string, id: string): Promise<StoredLearnerImage | null> {
	if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return null;
	const image = await store.read(id);
	if (!image || image.profileId !== profileId) return null;
	return image;
}

export async function saveLearnerImageResponse(req: Request, body: { data?: unknown; mimeType?: unknown }): Promise<Response> {
	const profile = requestProfile(req);
	if (!profile) throw new UsersError(401, "Choose a profile first.");
	const id = await saveLearnerImage(profile.id, body.data, body.mimeType);
	return Response.json({ id }, { status: 201 });
}

export async function learnerImageResponse(req: Request, id: string): Promise<Response> {
	const profile = requestProfile(req);
	if (!profile) return new Response(null, { status: 401 });
	const image = await readLearnerImage(profile.id, id);
	if (!image) return new Response(null, { status: 404 });
	return new Response(new Uint8Array(image.bytes), {
		headers: {
			"content-type": image.mimeType,
			"cache-control": "private, no-store",
			"x-content-type-options": "nosniff",
		},
	});
}
