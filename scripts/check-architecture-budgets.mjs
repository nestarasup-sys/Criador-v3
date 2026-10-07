import { readFile } from "node:fs/promises";

const budgets = {
  "app/page.tsx": 6100,
  "app/Ferramentas/fabricador-de-modelo/page.tsx": 2350,
  "local-data-server.mjs": 2060,
  "app/roteiros/components/RoteiroEditor.tsx": 1100,
  "services/roteiros/service.mjs": 1520,
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
