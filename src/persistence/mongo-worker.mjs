/**
 * One Mongo connection for the synchronous store ports.
 * Replies are posted on the MessageChannel, then the shared flag is set.
 * The main thread can block in Atomics.wait without missing the reply.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { workerData } from "node:worker_threads";

const { MongoClient } = createRequire(path.join(process.cwd(), "node_modules/mongoose/package.json"))("mongodb");

const { uri, collection, sab, port } = workerData;
const flag = new Int32Array(sab);
let records;

function wake(message) {
	port.postMessage(message);
	Atomics.store(flag, 0, 1);
	Atomics.notify(flag, 0);
}

function prefixBounds(prefix) {
	const end = prefix.slice(0, -1) + String.fromCharCode(prefix.charCodeAt(prefix.length - 1) + 1);
	return { path: { $gte: prefix, $lt: end } };
}

function childPrefix(dirPath) {
	return dirPath.endsWith("/") ? dirPath : `${dirPath}/`;
}

port.on("message", (message) => {
	void handle(message);
});

try {
	const client = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
	await client.connect();
	records = client.db().collection(collection);
	await records.createIndex({ path: 1 }, { unique: true });
	wake({ ready: true });
} catch (error) {
	wake({ ready: false, error: error instanceof Error ? error.message : String(error) });
}

async function handle(message) {
	const reply = { id: message.id };
	try {
		reply.ok = true;
		reply.result = await run(message.op, message.args ?? {});
	} catch (error) {
		reply.ok = false;
		reply.error = error instanceof Error ? error.message : String(error);
	}
	wake(reply);
}

async function run(op, args) {
	if (!records) throw new Error("Database is not connected");
	if (op === "get") {
		const doc = await records.findOne({ path: args.path }, { projection: { body: 1, updatedAt: 1 } });
		if (!doc) return null;
		const updatedAt = doc.updatedAt ? new Date(doc.updatedAt).getTime() : Date.now();
		return { body: typeof doc.body === "string" ? doc.body : "", updatedAt };
	}
	if (op === "put") {
		const prev = await records.findOne({ path: args.path }, { projection: { updatedAt: 1 } });
		let updatedAt = new Date();
		if (prev?.updatedAt && updatedAt.getTime() <= new Date(prev.updatedAt).getTime()) {
			updatedAt = new Date(new Date(prev.updatedAt).getTime() + 1);
		}
		await records.updateOne(
			{ path: args.path },
			{
				$set: { path: args.path, kind: args.kind, body: args.body, updatedAt },
				$setOnInsert: { createdAt: updatedAt },
			},
			{ upsert: true },
		);
		return { updatedAt: updatedAt.getTime() };
	}
	if (op === "del") return (await records.deleteOne({ path: args.path })).deletedCount;
	if (op === "delPrefix") {
		const exact = await records.deleteOne({ path: args.path });
		const children = await records.deleteMany(prefixBounds(childPrefix(args.path)));
		return exact.deletedCount + children.deletedCount;
	}
	if (op === "exists") {
		if (await records.findOne({ path: args.path }, { projection: { _id: 1 } })) return true;
		return Boolean(await records.findOne(prefixBounds(childPrefix(args.path)), { projection: { _id: 1 } }));
	}
	if (op === "list") {
		const prefix = childPrefix(args.path);
		const docs = await records.find(prefixBounds(prefix), { projection: { path: 1 } }).toArray();
		const names = new Map();
		for (const doc of docs) {
			const rest = String(doc.path).slice(prefix.length);
			if (!rest) continue;
			const [name, ...more] = rest.split("/");
			const dir = more.length > 0;
			const prev = names.get(name);
			if (!prev) names.set(name, { name, dir, file: !dir });
			else if (dir) prev.dir = true;
		}
		return [...names.values()];
	}
	if (op === "move") {
		const exact = await records.findOne({ path: args.from }, { projection: { _id: 1 } });
		if (exact) await records.updateOne({ _id: exact._id }, { $set: { path: args.to, updatedAt: new Date() } });
		const prefix = childPrefix(args.from);
		const docs = await records.find(prefixBounds(prefix), { projection: { path: 1 } }).toArray();
		const dest = args.to.endsWith("/") ? args.to.slice(0, -1) : args.to;
		for (const doc of docs) {
			const next = `${dest}/${String(doc.path).slice(prefix.length)}`;
			await records.updateOne({ _id: doc._id }, { $set: { path: next, updatedAt: new Date() } });
		}
		return (exact ? 1 : 0) + docs.length;
	}
	if (op === "drop") {
		await records.deleteMany({});
		return true;
	}
	throw new Error(`Unknown database operation: ${op}`);
}
