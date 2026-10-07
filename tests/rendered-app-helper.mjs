import { access } from "node:fs/promises";

export async function requireLocalModelFixture(t, relativePath) {
  try {
    await access(new URL(`../public/models/modelos/${relativePath}`, import.meta.url));
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      t.skip("requer assets locais de modelo, que deliberadamente não são versionados");
      return false;
    }
    throw error;
  }
}

export async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}
