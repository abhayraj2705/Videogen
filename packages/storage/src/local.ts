import fs from "node:fs/promises";
import path from "node:path";
import type { Bucket, StorageClient } from "./types.js";

/**
 * Filesystem-backed storage for local dev — R2/MinIO are both S3-API services
 * that need either a cloud account or a working Docker image, and neither is
 * needed to develop or verify the crawl/extract/plan stages. Swap to
 * `createS3StorageClient` (same interface) once assets actually need to be
 * servable to a browser (Phase 4+ rendering, Phase 5 UI).
 */
export function createLocalStorageClient(rootDir: string): StorageClient {
  const resolvedRoot = path.resolve(rootDir);

  function filePath(bucket: Bucket, key: string): string {
    const resolved = path.resolve(resolvedRoot, bucket, key);
    if (!resolved.startsWith(resolvedRoot)) {
      throw new Error(`Refusing to write outside storage root: ${bucket}/${key}`);
    }
    return resolved;
  }

  return {
    async putObject(bucket, key, body) {
      const dest = filePath(bucket, key);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, body);
    },
    async getObject(bucket, key) {
      return fs.readFile(filePath(bucket, key));
    },
    async presignUpload(bucket, key) {
      // No real signing in local mode — this is a file:// reference the worker
      // resolves directly rather than actually uploading over HTTP.
      return `file://${filePath(bucket, key)}`;
    },
    async presignDownload(bucket, key) {
      return `file://${filePath(bucket, key)}`;
    },
  };
}
