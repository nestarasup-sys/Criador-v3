// 24 decoded 1080p images already represent about 190 MiB. The browser HTTP
// cache makes reloading preferable to holding the whole catalog decoded.
const MAX_CACHED_IMAGES = 24;
const imageCache = new Map<string, Promise<HTMLImageElement>>();

export type StudioImageCacheStats = { imageCacheHits: number; imageCacheMisses: number; imageLoadMs: number };

function measureLoad(image: Promise<HTMLImageElement>, stats?: StudioImageCacheStats) {
  if (!stats) return image;
  const startedAt = performance.now();
  return image.finally(() => { stats.imageLoadMs += performance.now() - startedAt; });
}

export function clearStudioImageCache() {
  imageCache.clear();
}

function remember(src: string, image: Promise<HTMLImageElement>) {
  imageCache.set(src, image);
  while (imageCache.size > MAX_CACHED_IMAGES) {
    const oldest = imageCache.keys().next().value as string | undefined;
    if (!oldest) break;
    imageCache.delete(oldest);
  }
  return image;
}

export function loadStudioImage(src: string, stats?: StudioImageCacheStats) {
  const cached = imageCache.get(src);
  if (cached) {
    if (stats) stats.imageCacheHits += 1;
    imageCache.delete(src);
    imageCache.set(src, cached);
    return measureLoad(cached, stats);
  }
  if (stats) stats.imageCacheMisses += 1;
  const pending = new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => {
      imageCache.delete(src);
      reject(new Error(`Não foi possível carregar ${src}`));
    };
    image.src = src;
  });
  return measureLoad(remember(src, pending), stats);
}
