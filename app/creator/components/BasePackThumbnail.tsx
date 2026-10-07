"use client";

import { useEffect, useState } from "react";
import { createCharacterPhotoDataUrl, loadImage, removeChroma } from "../image-runtime";

const BASE_PACK_THUMBNAIL_CACHE_LIMIT = 24;
const basePackThumbnailCache = new Map<string, Promise<string>>();

export function clearBasePackThumbnailCache() {
  basePackThumbnailCache.clear();
}

async function createBasePackThumbnail(src: string) {
  const cached = basePackThumbnailCache.get(src);
  if (cached) return cached;
  const pending = (async () => {
    const transparentBlob = await removeChroma(src);
    const temporaryUrl = URL.createObjectURL(transparentBlob);
    try {
      const image = await loadImage(temporaryUrl);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas da miniatura indisponível");
      context.drawImage(image, 0, 0);
      return createCharacterPhotoDataUrl(canvas);
    } finally {
      URL.revokeObjectURL(temporaryUrl);
    }
  })().catch((error) => {
    basePackThumbnailCache.delete(src);
    throw error;
  });
  basePackThumbnailCache.set(src, pending);
  while (basePackThumbnailCache.size > BASE_PACK_THUMBNAIL_CACHE_LIMIT) {
    const oldest = basePackThumbnailCache.keys().next().value as string | undefined;
    if (!oldest || oldest === src) break;
    basePackThumbnailCache.delete(oldest);
  }
  return pending;
}

export function BasePackThumbnail({ src, name }: { src: string; name: string }) {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void createBasePackThumbnail(src)
      .then((result) => { if (active) setThumbnail(result); })
      .catch(() => { if (active) setThumbnail(src); });
    return () => { active = false; };
  }, [src]);
  if (!thumbnail) return <span className="base-pack-thumbnail-loading" aria-label={`Carregando prévia de ${name}`} />;
  // The generated data URL is a local, dynamically cropped preview.
  return <img className="base-pack-thumbnail" src={thumbnail} alt={`Prévia de ${name}`} />;
}
