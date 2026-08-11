import JSZip from "jszip";

/** Catálogo normalizado para personagens exportados pelo Criador de Personagens. */
export type EditorImportedAsset = {
  relativePath: string;
  expressionKey?: string;
  role: "frame" | "preview" | "base" | "unknown";
  bytes: number;
};

export type EditorImportedPose = {
  id: string;
  label: string;
  expressions: string[];
  assets: EditorImportedAsset[];
};

export type EditorImportedCharacter = {
  id: string;
  name: string;
  model?: string;
  gender?: string;
  expressions: string[];
  poses: EditorImportedPose[];
  assets: EditorImportedAsset[];
  manifest?: Record<string, unknown>;
  warnings: string[];
  /** Permite ao próximo estágio extrair somente o arquivo necessário. */
  readFile(relativePath: string): Promise<Blob>;
};

export type EditorCatalogImportResult = {
  character: EditorImportedCharacter;
  fileCount: number;
  warnings: string[];
};

const MAX_FILES = 2_000;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

function safePath(value: string) {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === ".." || part.includes("\0"))) return null;
  return parts.join("/");
}

function extension(path: string) {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

function expressionKey(fileName: string) {
  const stem = fileName.replace(/\.[^.]+$/, "");
  return stem.trim().toLowerCase().replace(/[\s-]+/g, "_").replace(/_+/g, "_");
}

function roleFor(path: string): EditorImportedAsset["role"] {
  const name = path.split("/").pop()?.toLowerCase() ?? "";
  if (name === "preview.png" || name === "preview.jpg" || name === "preview.jpeg") return "preview";
  if (name.includes("personagem_sem_rosto") || path.split("/").includes("base")) return "base";
  if (IMAGE_EXTENSIONS.has(extension(name))) return "frame";
  return "unknown";
}

function poseFromPath(path: string) {
  const match = path.match(/(?:^|\/)pose[ _-]*(\d+)(?:\/|$)/i);
  return match ? `pose-${Number(match[1])}` : "default";
}

function poseLabel(id: string) {
  if (id === "default") return "Padrão";
  return id.replace("pose-", "POSE ");
}

function jsonManifest(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

async function asZip(input: Blob | ArrayBuffer | Uint8Array) {
  if (input instanceof Blob) return JSZip.loadAsync(await input.arrayBuffer());
  return JSZip.loadAsync(input);
}

/**
 * Lê um ZIP do exportador do Criador sem gravar arquivos no disco.
 * O resultado é deliberadamente somente leitura; o staging local será a Fase 3.
 */
export async function importCharacterZip(input: Blob | ArrayBuffer | Uint8Array): Promise<EditorCatalogImportResult> {
  const zip = await asZip(input);
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (!entries.length) throw new Error("O ZIP não contém arquivos.");
  if (entries.length > MAX_FILES) throw new Error(`O ZIP excede o limite seguro de ${MAX_FILES} arquivos.`);

  const safeEntries = entries.map((entry) => ({ entry, path: safePath(entry.name) })).filter((item): item is { entry: JSZip.JSZipObject; path: string } => Boolean(item.path));
  if (safeEntries.length !== entries.length) throw new Error("O ZIP contém caminhos inválidos ou tentativa de sair da pasta.");

  const manifestItem = safeEntries.find((item) => item.path.toLowerCase().endsWith("/manifest.json") || item.path.toLowerCase() === "manifest.json");
  const variantsManifestItem = safeEntries.find((item) => item.path.toLowerCase().endsWith("/variants-manifest.json") || item.path.toLowerCase() === "variants-manifest.json");
  let manifest: Record<string, unknown> | undefined;
  const warnings: string[] = [];
  if (manifestItem) {
    try { manifest = jsonManifest(JSON.parse(await manifestItem.entry.async("string"))); }
    catch { warnings.push("manifest.json existe, mas não pôde ser lido; o catálogo foi inferido pelos arquivos."); }
  } else warnings.push("manifest.json não encontrado; expressões e nome foram inferidos pelos nomes dos arquivos.");
  if (variantsManifestItem) warnings.push("variants-manifest.json detectado; as subpastas POSE foram agrupadas no mesmo personagem.");

  const rootPrefix = manifestItem ? manifestItem.path.slice(0, manifestItem.path.lastIndexOf("/") + 1) : "";
  const files = safeEntries
    .filter(({ path }) => path.startsWith(rootPrefix))
    .map(({ entry, path }) => {
      const relativePath = path.slice(rootPrefix.length);
      return { entry, relativePath, asset: { relativePath, expressionKey: IMAGE_EXTENSIONS.has(extension(relativePath)) ? expressionKey(relativePath.split("/").pop() ?? relativePath) : undefined, role: roleFor(relativePath), bytes: 0 } as EditorImportedAsset };
    })
    .filter(({ asset }) => asset.role !== "unknown");

  const expressionsFromManifest = Array.isArray(manifest?.expressions) ? manifest.expressions.filter((item): item is string => typeof item === "string") : [];
  const poseMap = new Map<string, EditorImportedPose>();
  const defaultAssets: EditorImportedAsset[] = [];
  for (const file of files) {
    const poseId = poseFromPath(file.relativePath);
    if (poseId === "default") defaultAssets.push(file.asset);
    else {
      const pose = poseMap.get(poseId) ?? { id: poseId, label: poseLabel(poseId), expressions: [], assets: [] };
      pose.assets.push(file.asset);
      if (file.asset.expressionKey && file.asset.role === "frame" && !pose.expressions.includes(file.asset.expressionKey)) pose.expressions.push(file.asset.expressionKey);
      poseMap.set(poseId, pose);
    }
  }
  const inferredExpressions = defaultAssets.filter((asset) => asset.role === "frame" && asset.expressionKey).map((asset) => asset.expressionKey as string);
  const expressions = [...new Set(expressionsFromManifest.length ? expressionsFromManifest : inferredExpressions)];
  for (const pose of poseMap.values()) if (!pose.expressions.length) pose.expressions = expressions.slice();
  const characterManifest = jsonManifest(manifest?.character);
  const name = typeof characterManifest?.name === "string" ? characterManifest.name : (rootPrefix.split("/").filter(Boolean).pop() || "Personagem importado");
  const id = typeof characterManifest?.id === "string" && characterManifest.id ? characterManifest.id : `imported-${crypto.randomUUID()}`;
  const character: EditorImportedCharacter = {
    id, name,
    ...(typeof characterManifest?.model === "string" ? { model: characterManifest.model } : {}),
    ...(typeof characterManifest?.gender === "string" ? { gender: characterManifest.gender } : {}),
    expressions, poses: [{ id: "default", label: "Padrão", expressions, assets: defaultAssets }, ...poseMap.values()],
    assets: files.map((file) => file.asset), manifest, warnings,
    readFile: async (relativePath) => {
      const normalized = safePath(relativePath);
      if (!normalized) throw new Error("Caminho de asset inválido.");
      const file = files.find((item) => item.relativePath === normalized);
      if (!file) throw new Error(`Asset não encontrado no ZIP: ${relativePath}`);
      return file.entry.async("blob");
    },
  };
  return { character, fileCount: safeEntries.length, warnings };
}
