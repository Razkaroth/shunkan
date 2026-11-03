import config from "../payload.config.ts";
import { seedDiscordSuperAdmin } from "../lib/auth/seed-super-admin.ts";
import { getPayload } from "payload";

const payload = await getPayload({ config });
await seedDiscordSuperAdmin(payload);
process.exit(0);
