export function safePrintName(value) {
  const normalized = String(value ?? "studio")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || "studio";
}

export function safeExportFolderName(value, fallback = "Roteiro") {
  const normalized = String(value ?? fallback)
    .replace(/[<>:"/\\|?*]+/g, "-")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 120);
  return normalized || fallback;
}

export function printTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}-${String(date.getMilliseconds()).padStart(3, "0")}`;
}
