import assert from 'node:assert/strict';
import {
  CreateBucketCommand,
  GetBucketVersioningCommand,
  HeadBucketCommand,
  PutBucketVersioningCommand,
  S3Client,
} from '@aws-sdk/client-s3';

for (const name of [
  'QMS_OBJECT_STORAGE_ENDPOINT',
  'QMS_OBJECT_STORAGE_BUCKET',
  'QMS_OBJECT_STORAGE_ACCESS_KEY',
  'QMS_OBJECT_STORAGE_SECRET_KEY',
]) {
  assert.ok(process.env[name]?.trim(), `${name} is required`);
}

const bucket = process.env.QMS_OBJECT_STORAGE_BUCKET;
const client = new S3Client({
  endpoint: process.env.QMS_OBJECT_STORAGE_ENDPOINT,
  region: process.env.QMS_OBJECT_STORAGE_REGION ?? 'us-east-1',
  forcePathStyle: true,
  maxAttempts: 1,
  credentials: {
    accessKeyId: process.env.QMS_OBJECT_STORAGE_ACCESS_KEY,
    secretAccessKey: process.env.QMS_OBJECT_STORAGE_SECRET_KEY,
  },
});

try {
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch (error) {
    if (error?.$metadata?.httpStatusCode !== 404) throw error;
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  await client.send(new PutBucketVersioningCommand({ Bucket: bucket, VersioningConfiguration: { Status: 'Enabled' } }));
  const versioning = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
  assert.equal(versioning.Status, 'Enabled', 'Object storage bucket versioning must be enabled');
} finally {
  client.destroy();
}
