export function resolveByteRange(header, fileSize) {
  if (typeof header !== "string") return null;
  const match = header.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const suffixLength = !match[1] && match[2] ? Number(match[2]) : 0;
  const start = match[1] ? Number(match[1]) : Math.max(0, fileSize - suffixLength);
  const requestedEnd = match[1] && match[2] ? Number(match[2]) : fileSize - 1;
  if (!Number.isInteger(start) || !Number.isInteger(requestedEnd) || start < 0 || start >= fileSize || requestedEnd < start) {
    return { invalid: true };
  }
  return { start, end: Math.min(requestedEnd, fileSize - 1) };
}
