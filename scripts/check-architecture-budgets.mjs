import { readFile } from "node:fs/promises";

const budgets = {
  "app/page.tsx": 5900,
  "app/Ferramentas/fabricador-de-modelo/page.tsx": 2350,
  "local-data-server.mjs": 1160,
  "app/roteiros/components/RoteiroEditor.tsx": 575,
  "app/roteiros/components/TikTokCard.tsx": 540,
  "services/roteiros/service.mjs": 670,
  "app/studio/page.tsx": 1120,
  "services/models/routes.mjs": 400,
  "services/characters/routes.mjs": 170,
  "services/studio/routes.mjs": 190,
  "services/fabricator/service.mjs": 390,
  "services/video-maker/service.mjs": 320,
  "app/globals.css": 1180,
};

const failures = [];
for (const [path, maximumLines] of Object.entries(budgets)) {
  const content = await readFile(path, "utf8");
  const lines = content.split("\n").length;
  if (lines > maximumLines) failures.push(`${path}: ${lines} linhas > budget ${maximumLines}`);
  else console.log(`architecture budget OK: ${path} ${lines}/${maximumLines}`);
}

if (failures.length) {
  console.error("\nArchitecture budget excedido:");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("\nExtraia responsabilidades para módulos em vez de aumentar os monólitos.");
  process.exit(1);
}
