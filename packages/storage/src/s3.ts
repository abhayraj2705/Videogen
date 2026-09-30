import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Bucket, StorageClient } from "./types.js";

export interface S3StorageOptions {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketNames: Record<Bucket, string>;
}

/** R2 is S3-API-compatible, so this one client works against R2 in prod and MinIO in dev. */
export function createS3StorageClient(opts: S3StorageOptions): StorageClient {
  const client = new S3Client({
    region: "auto",
    endpoint: opts.endpoint,
    credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    forcePathStyle: true, // required by MinIO; harmless against R2
  });

  return {
    async putObject(bucket, key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: opts.bucketNames[bucket], Key: key, Body: body, ContentType: contentType }));
    },
    async getObject(bucket, key) {
      const res = await client.send(new GetObjectCommand({ Bucket: opts.bucketNames[bucket], Key: key }));
      const bytes = await res.Body?.transformToByteArray();
      if (!bytes) throw new Error(`Empty object: ${bucket}/${key}`);
      return Buffer.from(bytes);
    },
    presignUpload(bucket, key, contentType, expiresInSec = 300) {
      const cmd = new PutObjectCommand({ Bucket: opts.bucketNames[bucket], Key: key, ContentType: contentType });
      return getSignedUrl(client, cmd, { expiresIn: expiresInSec });
    },
    presignDownload(bucket, key, expiresInSec = 300) {
      const cmd = new GetObjectCommand({ Bucket: opts.bucketNames[bucket], Key: key });
      return getSignedUrl(client, cmd, { expiresIn: expiresInSec });
    },
  };
}
