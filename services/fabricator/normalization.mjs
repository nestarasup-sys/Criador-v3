export function normalizeFabricatorChroma(value) {
  if (!value || typeof value !== "object") return undefined;
  const number = (candidate, fallback, minimum, maximum) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
  };
  const manualSeeds = Array.isArray(value.manualSeeds)
    ? value.manualSeeds.slice(0, 128).map((seed) => ({
      side: seed?.side === "right" ? "right" : "left",
      x: number(seed?.x, 0, 0, 1),
      y: number(seed?.y, 0, 0, 1),
    }))
    : [];
  return {
    strength: number(value.strength, 72, 0, 100),
    tolerance: number(value.tolerance, 32, 2, 100),
    softness: number(value.softness, 18, 0, 80),
    ...(manualSeeds.length > 0 ? { manualSeeds } : {}),
  };
}

export function normalizeFabricatorGrid(value) {
  return value === "5x8" || value === "7x3" ? value : undefined;
}

export function normalizeFabricatorPlacement(value) {
  if (!value || typeof value !== "object") return undefined;
  const number = (candidate, fallback, minimum, maximum) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
  };
  const normalizeSingle = (placement) => ({
    x: number(placement?.x, 500, 0, 1000),
    y: number(placement?.y, 500, 0, 1000),
    scale: number(placement?.scale, 1, .35, 12),
    scaleX: number(placement?.scaleX, 1, .5, 6.8),
    scaleY: number(placement?.scaleY, 1, .5, 6.8),
    rotation: number(placement?.rotation, 0, -80, 80),
    gap: number(placement?.gap, 0, 0, 1040),
  });
  if (value.left && typeof value.left === "object" && value.right && typeof value.right === "object") {
    return { left: { ...normalizeSingle(value.left), gap: 0 }, right: { ...normalizeSingle(value.right), gap: 0 } };
  }
  return normalizeSingle(value);
}

function normalizeFabricatorTransform(value) {
  if (!value || typeof value !== "object") return undefined;
  const number = (candidate, fallback, minimum, maximum) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
  };
  return {
    scaleX: number(value.scaleX, 1, .35, 4),
    scaleY: number(value.scaleY, 1, .35, 4),
    rotation: number(value.rotation, 0, -80, 80),
    x: number(value.x, 0, -500, 500),
    y: number(value.y, 0, -500, 500),
  };
}

function normalizeFabricatorVariation(value) {
  if (!value || typeof value !== "object") return undefined;
  const left = normalizeFabricatorTransform(value.left);
  const right = normalizeFabricatorTransform(value.right);
  return left && right ? { left, right } : undefined;
}

export function normalizeFabricatorPresets(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [key, preset] of Object.entries(value).slice(0, 64)) {
    if (!/^[a-z0-9_-]{1,80}$/i.test(key) || !preset || typeof preset !== "object") continue;
    const eyes = normalizeFabricatorVariation(preset.eyes);
    const eyebrows = normalizeFabricatorVariation(preset.eyebrows);
    const mouth = normalizeFabricatorTransform(preset.mouth);
    const templateScaleX = Number(preset.templateScaleX);
    const effectPlacements = Object.fromEntries(["blush", "shadow", "manpu"].map((effect) => [effect, normalizeFabricatorPlacement(preset.effectPlacements?.[effect]) ?? { x: effect === "blush" ? 500 : effect === "shadow" ? 500 : 500, y: effect === "blush" ? 520 : effect === "shadow" ? 420 : 360, scale: 1, scaleX: 1, scaleY: 1, rotation: 0, gap: 0 }]));
    const effects = Object.fromEntries(["blush", "shadow", "manpu"].map((effect) => [effect, normalizeFabricatorTransform(preset.effects?.[effect]) ?? { scaleX: 1, scaleY: 1, rotation: 0, x: 0, y: 0 }]));
    const enabledEffects = Object.fromEntries(["blush", "shadow", "manpu"].map((effect) => [effect, preset.enabledEffects?.[effect] !== false]));
    const effectAssets = Object.fromEntries(["blush", "shadow", "manpu"].map((effect) => [effect, typeof preset.effectAssets?.[effect] === "string" ? preset.effectAssets[effect] : null]));
    const effectSettings = Object.fromEntries(["blush", "shadow", "manpu"].map((effect) => {
      const source = preset.effectSettings?.[effect];
      const opacity = Number(source?.opacity);
      const coverage = Number(source?.verticalCoverage);
      const softness = Number(source?.softness);
      const gradientWidth = Number(source?.gradientWidth);
      const gradientHeight = Number(source?.gradientHeight);
      return [effect, {
        opacity: Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1,
        clipToTemplate: source?.clipToTemplate !== false,
        source: source?.source === "gradient" ? "gradient" : "asset",
         color: typeof source?.color === "string" && /^#[0-9a-f]{6}$/i.test(source.color) ? source.color : effect === "blush" ? "#ff90ae" : effect === "shadow" ? "#2c1f34" : "#ffffff",
        verticalCoverage: Number.isFinite(coverage) ? Math.min(1, Math.max(.01, coverage)) : .5,
        softness: Number.isFinite(softness) ? Math.min(1, Math.max(.01, softness)) : .18,
        gradientWidth: Number.isFinite(gradientWidth) ? Math.min(1000, Math.max(80, gradientWidth)) : 420,
        gradientHeight: Number.isFinite(gradientHeight) ? Math.min(700, Math.max(50, gradientHeight)) : 220,
        blushStyle: effect === "blush" && ["oval", "cheeks", "bands", "diagonal", "spot"].includes(source?.blushStyle) ? source.blushStyle : undefined,
      }];
    }));
    const mouthHaloSource = preset.mouthHalo;
    const mouthHalo = {
      enabled: mouthHaloSource?.enabled === true,
      color: typeof mouthHaloSource?.color === "string" && /^#[0-9a-f]{6}$/i.test(mouthHaloSource.color) ? mouthHaloSource.color : "#ff90ae",
      opacity: Number.isFinite(Number(mouthHaloSource?.opacity)) ? Math.min(1, Math.max(0, Number(mouthHaloSource.opacity))) : .58,
      softness: Number.isFinite(Number(mouthHaloSource?.softness)) ? Math.min(1, Math.max(.01, Number(mouthHaloSource.softness))) : .35,
      width: Number.isFinite(Number(mouthHaloSource?.width)) ? Math.min(500, Math.max(40, Number(mouthHaloSource.width))) : 170,
      height: Number.isFinite(Number(mouthHaloSource?.height)) ? Math.min(300, Math.max(20, Number(mouthHaloSource.height))) : 90,
    };
    const mouthTalkIndex = Number.isInteger(preset.mouthTalkIndex) && preset.mouthTalkIndex >= 0 && preset.mouthTalkIndex < 21 ? preset.mouthTalkIndex : Object.keys(value).indexOf(key);
    const effectPieceIndexes = Object.fromEntries(["blush", "shadow", "manpu"].map((effect) => {
      const candidate = preset.effectPieceIndexes?.[effect];
      return [effect, Number.isInteger(candidate) && candidate >= 0 && candidate < 21 ? candidate : effect === "manpu" ? Object.keys(value).indexOf(key) : null];
    }));
    if (eyes && eyebrows && mouth) result[key] = { templateScaleX: Number.isFinite(templateScaleX) ? Math.min(1.2, Math.max(.5, templateScaleX)) : .95, effectPlacements, eyes, eyebrows, mouth, effects, enabledEffects, effectAssets, effectSettings, mouthHalo, effectPieceIndexes, mouthTalkIndex: mouthTalkIndex >= 0 ? mouthTalkIndex : 0 };
  }
  return result;
}

function normalizePresetProfileId(value, fallback) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || fallback;
}

function normalizePresetProfileName(value, fallback) {
  const name = String(value ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
  return name || fallback;
}

export function normalizeFabricatorPresetProfiles(value, legacyPresets = {}) {
  const sourceProfiles = Array.isArray(value?.profiles) ? value.profiles : [];
  const usedIds = new Set();
  const profiles = [];
  for (const [index, source] of sourceProfiles.slice(0, 32).entries()) {
    if (!source || typeof source !== "object") continue;
    const fallbackId = index === 0 ? "padrao" : `perfil-${index + 1}`;
    let id = normalizePresetProfileId(source.id, fallbackId);
    while (usedIds.has(id)) id = `${id}-${index + 1}`.slice(0, 64);
    usedIds.add(id);
    const presets = normalizeFabricatorPresets(source.presets);
    const savedExpressionVersions = normalizeFabricatorPresets(source.savedExpressionVersions);
    const expressionReferences = Object.fromEntries(Object.entries(source.expressionReferences && typeof source.expressionReferences === "object" ? source.expressionReferences : {}).slice(0, 21).flatMap(([key, reference]) => {
      if (!/^[a-z0-9_-]{1,80}$/i.test(key) || !reference || typeof reference !== "object") return [];
      const description = String(reference.description ?? "").slice(0, 500);
      const imageDataUrl = typeof reference.imageDataUrl === "string" && /^data:image\/(?:png|webp|jpeg);base64,/i.test(reference.imageDataUrl) && reference.imageDataUrl.length <= 2_000_000
        ? reference.imageDataUrl
        : null;
      return [[key, { description, imageDataUrl }]];
    }));
    profiles.push({
      id,
      name: normalizePresetProfileName(source.name, id === "padrao" ? "Padrão" : `Perfil ${index + 1}`),
      description: String(source.description ?? "").trim().slice(0, 180),
      createdAt: typeof source.createdAt === "string" && source.createdAt ? source.createdAt : new Date().toISOString(),
      updatedAt: typeof source.updatedAt === "string" && source.updatedAt ? source.updatedAt : new Date().toISOString(),
      skinColor: typeof source.skinColor === "string" && /^#[0-9a-f]{6}$/i.test(source.skinColor) ? source.skinColor.toLowerCase() : "#fff0e7",
      presets,
      expressionReferences,
      savedExpressionVersions,
    });
  }
  if (!profiles.length) {
    const now = new Date().toISOString();
    profiles.push({
      id: "padrao",
      name: "Padrão",
      description: "Conjunto base finalizado do Fabricador.",
      createdAt: now,
      updatedAt: now,
      skinColor: "#fff0e7",
      presets: normalizeFabricatorPresets(legacyPresets),
    });
  }
  const activeProfileId = profiles.some((profile) => profile.id === value?.activeProfileId)
    ? value.activeProfileId
    : profiles[0].id;
  return { version: 1, activeProfileId, profiles };
}
