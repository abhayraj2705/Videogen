export type Bucket = "assets" | "renders";

export interface StorageClient {
  putObject(bucket: Bucket, key: string, body: Buffer, contentType: string): Promise<void>;
  getObject(bucket: Bucket, key: string): Promise<Buffer>;
  presignUpload(bucket: Bucket, key: string, contentType: string, expiresInSec?: number): Promise<string>;
  presignDownload(bucket: Bucket, key: string, expiresInSec?: number): Promise<string>;
}
