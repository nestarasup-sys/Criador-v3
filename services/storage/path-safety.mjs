import { resolve, sep } from "node:path";

export function safeId(value) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(value ?? "")) throw new Error("Identificador inválido");
  return value;
}

export function inside(parent, target) {
  const parentPath = resolve(parent) + sep;
  return resolve(target).startsWith(parentPath);
}
