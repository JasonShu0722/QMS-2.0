import assert from 'node:assert/strict';

function normalize(path) {
  return path.startsWith('qms-2.0/') ? path.slice('qms-2.0/'.length) : path;
}

export function linkedMaintenance(paths, register) {
  assert.ok(register && Array.isArray(register.items), '维护台账必须包含 items');
  const changed = [...new Set(paths)].map(normalize);
  return register.items
    .filter((item) => item.status === 'open')
    .map((item) => {
      const sources = item.sources.map((source) => normalize(source.path));
      const matchedPaths = changed.filter((path) => sources.some((source) => path === source));
      return matchedPaths.length > 0 ? {
        id: item.id,
        status: item.status,
        owner: item.owner,
        reviewDue: item.reviewDue,
        nextAction: item.nextAction,
        matchedPaths,
      } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.id.localeCompare(b.id));
}
