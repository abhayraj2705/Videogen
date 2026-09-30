import type { ServerEnv } from "@sitereel/shared";
import type { StorageClient } from "./types.js";
import { createLocalStorageClient } from "./local.js";
import { createS3StorageClient } from "./s3.js";

export * from "./types.js";
export { createLocalStorageClient } from "./local.js";
export { createS3StorageClient } from "./s3.js";

export function createStorageClientFromEnv(env: ServerEnv): StorageClient {
  if (env.STORAGE_DRIVER === "local") {
    return createLocalStorageClient(env.STORAGE_LOCAL_DIR);
  }
  if (!env.R2_ENDPOINT || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_ASSETS || !env.R2_BUCKET_RENDERS) {
    throw new Error("STORAGE_DRIVER=s3 requires R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_ASSETS, R2_BUCKET_RENDERS");
  }
  return createS3StorageClient({
    endpoint: env.R2_ENDPOINT,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucketNames: { assets: env.R2_BUCKET_ASSETS, renders: env.R2_BUCKET_RENDERS },
  });
}
