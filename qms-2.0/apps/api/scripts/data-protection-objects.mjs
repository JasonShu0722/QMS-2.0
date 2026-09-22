export function assertReferences(references, objects) {
  const versions = new Map(objects.map((object) => [JSON.stringify([object.key, object.versionId]), object]));
  if (versions.size !== objects.length) throw new Error('DATABASE_OBJECT_MISMATCH');
  for (const reference of references) {
    if (!reference.object_version_id) {
      if (reference.status === 'AVAILABLE' || reference.upload_completed_at) throw new Error('DATABASE_OBJECT_MISMATCH');
      continue;
    }
    const object = versions.get(JSON.stringify([reference.object_key, reference.object_version_id]));
    if (!object) throw new Error('DATABASE_OBJECT_MISMATCH');
    const size = Buffer.from(object.body, 'base64').length;
    if (reference.verified_sha256 && object.sha256 !== reference.verified_sha256) throw new Error('DATABASE_OBJECT_MISMATCH');
    if (reference.verified_size_bytes !== null && reference.verified_size_bytes !== undefined && size !== Number(reference.verified_size_bytes)) throw new Error('DATABASE_OBJECT_MISMATCH');
    if (reference.status === 'AVAILABLE' && (reference.scan_status !== 'CLEAN' || !reference.verified_sha256 || reference.verified_size_bytes == null || reference.sha256 !== reference.verified_sha256 || size !== Number(reference.size_bytes))) throw new Error('DATABASE_OBJECT_MISMATCH');
  }
}

export function restoredReferences(references, objects) {
  const versions = new Map(objects.map((object) => [JSON.stringify([object.key, object.versionId]), object.restoredVersion]));
  return references.map((reference) => {
    if (!reference.object_version_id) return { ...reference };
    const version = versions.get(JSON.stringify([reference.object_key, reference.object_version_id]));
    if (!version) throw new Error('RESTORED_VERSION_MISSING');
    return { ...reference, object_version_id: version };
  });
}
