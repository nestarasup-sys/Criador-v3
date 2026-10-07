import { relative, resolve, sep, win32 } from "node:path";

export function safeId(value) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(value ?? "")) throw new Error("Identificador inválido");
  return value;
}

function looksLikeWindowsAbsolute(value) {
  return /^[a-zA-Z]:[\\/]/.test(String(value ?? ""));
}

function insideWith(pathApi, parent, target) {
  const parentPath = pathApi.resolve(parent);
  const targetPath = pathApi.resolve(target);
  const rel = pathApi.relative(parentPath, targetPath);
  return rel === "" || (!rel.startsWith(".." + pathApi.sep) && rel !== ".." && !pathApi.isAbsolute(rel));
}

export function inside(parent, target) {
  if (looksLikeWindowsAbsolute(parent) || looksLikeWindowsAbsolute(target)) {
    if (!looksLikeWindowsAbsolute(parent) || !looksLikeWindowsAbsolute(target)) return false;
    return insideWith(win32, parent, target);
  }
  return insideWith({ resolve, relative, sep, isAbsolute: (value) => resolve(value) === value }, parent, target);
}
