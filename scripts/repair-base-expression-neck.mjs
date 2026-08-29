import path from "node:path";
import { inspectBaseExpressionPack, repairBaseExpressionPack } from "../app/creator/base-expression-integrity.mjs";

const args = process.argv.slice(2);
const repair = args.includes("--repair");
const directoryArgument = args.find((value) => !value.startsWith("--"));
const packDir = path.resolve(directoryArgument ?? "public/models/modelos/feminino/modelo-4");

const before = await inspectBaseExpressionPack(packDir);
console.log(JSON.stringify({ mode: repair ? "repair" : "check", before }, null, 2));

if (repair) {
  const result = await repairBaseExpressionPack(packDir);
  console.log(JSON.stringify(result, null, 2));
  const after = await inspectBaseExpressionPack(packDir);
  console.log(JSON.stringify({ after }, null, 2));
}
