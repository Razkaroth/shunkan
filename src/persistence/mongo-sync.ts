/**
 * Synchronous Mongo access for the store ports.
 * One worker owns the driver; the caller blocks until that round trip finishes,
 * so a read/modify/write in the same turn cannot interleave.
 */
import path from "node:path";
import { MessageChannel, Worker, receiveMessageOnPort, type MessagePort } from "node:worker_threads";

const COLLECTION = "learner-records";

interface WorkerState {
	uri: string;
	worker: Worker;
	port: MessagePort;
	flag: Int32Array;
}

interface Reply {
	ready?: boolean;
	ok?: boolean;
	result?: unknown;
	error?: string;
}

const globalState = globalThis as typeof globalThis & { __lhRecordWorker?: WorkerState };

function workerFile(): string {
	return path.join(process.cwd(), "src/persistence/mongo-worker.mjs");
}

function boot(uri: string): WorkerState {
	const { port1, port2 } = new MessageChannel();
	const sab = new SharedArrayBuffer(4);
	const flag = new Int32Array(sab);
	const worker = new Worker(workerFile(), {
		workerData: { uri, collection: COLLECTION, sab, port: port2 },
		transferList: [port2],
	});
	const status = Atomics.wait(flag, 0, 0, 20_000);
	if (status === "timed-out") throw new Error("Database worker timed out during startup");
	const ready = receiveMessageOnPort(port1)?.message as Reply | undefined;
	if (!ready?.ready) throw new Error(ready?.error ?? "Database worker failed to start");
	return { uri, worker, port: port1, flag };
}

function state(): WorkerState {
	const uri = process.env.MONGODB_URI;
	if (!uri) throw new Error("MONGODB_URI is required to store learner records");
	const current = globalState.__lhRecordWorker;
	if (current && current.uri === uri) return current;
	if (current) void current.worker.terminate();
	const next = boot(uri);
	globalState.__lhRecordWorker = next;
	return next;
}

function call<T>(op: string, args: Record<string, unknown>): T {
	const current = state();
	Atomics.store(current.flag, 0, 0);
	current.port.postMessage({ op, args });
	const status = Atomics.wait(current.flag, 0, 0, 20_000);
	if (status === "timed-out") throw new Error(`Database operation timed out: ${op}`);
	const reply = receiveMessageOnPort(current.port)?.message as Reply | undefined;
	if (!reply?.ok) throw new Error(reply?.error ?? `Database operation failed: ${op}`);
	return reply.result as T;
}

export interface StoredRecord {
	body: string;
	updatedAt: number;
}

export function recordGet(recordPath: string): StoredRecord | null {
	return call<StoredRecord | null>("get", { path: recordPath });
}

export function recordPut(recordPath: string, body: string, kind: string): void {
	call("put", { path: recordPath, body, kind });
}

export function recordDel(recordPath: string): number {
	return call<number>("del", { path: recordPath });
}

export function recordDelPrefix(recordPath: string): number {
	return call<number>("delPrefix", { path: recordPath });
}

export function recordExists(recordPath: string): boolean {
	return call<boolean>("exists", { path: recordPath });
}

export function recordList(dirPath: string): Array<{ name: string; dir: boolean; file: boolean }> {
	return call("list", { path: dirPath });
}

export function recordMove(from: string, to: string): number {
	return call<number>("move", { from, to });
}

/** Test hook: empty the learner-records collection and stop the worker. */
export function resetRecordStoreForTests(): void {
	if (process.env.NODE_ENV !== "test") throw new Error("Record reset is test-only");
	const current = globalState.__lhRecordWorker;
	if (!current) return;
	try {
		call("drop", {});
	} finally {
		void current.worker.terminate();
		delete globalState.__lhRecordWorker;
	}
}
