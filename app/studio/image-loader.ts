const MAX_CACHED_IMAGES = 96;
const imageCache = new Map<string, Promise<HTMLImageElement>>();

function remember(src: string, image: Promise<HTMLImageElement>) {
  imageCache.set(src, image);
  while (imageCache.size > MAX_CACHED_IMAGES) {
    const oldest = imageCache.keys().next().value as string | undefined;
    if (!oldest) break;
    imageCache.delete(oldest);
  }
  return image;
}

export function loadStudioImage(src: string) {
  const cached = imageCache.get(src);
  if (cached) {
    imageCache.delete(src);
    imageCache.set(src, cached);
    return cached;
  }
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
  return remember(src, pending);
}
