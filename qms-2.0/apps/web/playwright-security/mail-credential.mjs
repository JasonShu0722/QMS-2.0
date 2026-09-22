export function mailCredential(text) {
  const token = text.split(/\r?\n/).find((line) => /^[A-Za-z0-9_-]{43}$/.test(line));
  if (!token) throw new Error('Expected a real one-time mail credential');
  return token;
}
