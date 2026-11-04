import path from "node:path";
import { fileURLToPath } from "node:url";
import { mongooseAdapter } from "@payloadcms/db-mongodb";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { s3Storage } from "@payloadcms/storage-s3";
import { buildConfig } from "payload";
import { betterAuthPlugin } from "payload-auth/better-auth";
import { DemoFiles } from "./collections/DemoFiles.ts";
import { LearnerRecords } from "./collections/LearnerRecords.ts";
import { payloadAuthOptions } from "./lib/auth/options.ts";
import { readEnv } from "./lib/env.ts";

const env = readEnv();
const dirname = path.dirname(fileURLToPath(import.meta.url));

export default buildConfig({
	admin: {
		user: "users",
		importMap: { baseDir: path.resolve(dirname) },
	},
	routes: {
		admin: "/admin",
		api: "/api/payload",
	},
	collections: [DemoFiles, LearnerRecords],
	editor: lexicalEditor(),
	secret: env.PAYLOAD_SECRET,
	typescript: {
		outputFile: path.resolve(dirname, "payload-types.ts"),
	},
	db: mongooseAdapter({ url: env.MONGODB_URI }),
	plugins: [
		betterAuthPlugin(payloadAuthOptions),
		s3Storage({
			collections: {
				"demo-files": { prefix: "demo-files" },
			},
			bucket: env.S3_BUCKET,
			config: {
				credentials: {
					accessKeyId: env.S3_ACCESS_KEY_ID,
					secretAccessKey: env.S3_SECRET_ACCESS_KEY,
				},
				region: env.S3_REGION,
				endpoint: env.S3_ENDPOINT,
				forcePathStyle: true,
			},
		}),
	],
});
