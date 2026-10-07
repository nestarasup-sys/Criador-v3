import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  dependencyFingerprint,
  dependencyState,
  isDirectInvocation,
  nodeVersionAtLeast,
  parseNodeVersion,
} from "../scripts/local-bootstrap.mjs";

test("local bootstrap validates the required Node baseline", () => {
  assert.deepEqual(parseNodeVersion("v22.13.0"), [22, 13, 0]);
  assert.equal(nodeVersionAtLeast("22.13.0"), true);
  assert.equal(nodeVersionAtLeast("22.12.9"), false);
  assert.equal(nodeVersionAtLeast("23.0.0"), true);
});

test("local bootstrap fingerprint changes with lockfile or Node runtime", () => {
  assert.equal(dependencyFingerprint("lock-a", "22.13.0"), dependencyFingerprint("lock-a", "22.13.0"));
  assert.notEqual(dependencyFingerprint("lock-a", "22.13.0"), dependencyFingerprint("lock-b", "22.13.0"));
  assert.notEqual(dependencyFingerprint("lock-a", "22.13.0"), dependencyFingerprint("lock-a", "22.14.0"));
});

test("local bootstrap only reports ready when node_modules and marker match", async () => {
  const root = await mkdtemp(join(tmpdir(), "nymi-bootstrap-"));
  try {
    await writeFile(join(root, "package-lock.json"), '{"lockfileVersion":3}', "utf8");
    let state = await dependencyState(root);
    assert.equal(state.ready, false);
    assert.equal(state.reason, "node_modules ausente");

    await mkdir(join(root, "node_modules"));
    state = await dependencyState(root);
    assert.equal(state.ready, false);

    await writeFile(join(root, ".nymi-local-deps.json"), JSON.stringify({
      fingerprint: state.fingerprint,
    }), "utf8");
    state = await dependencyState(root);
    assert.equal(state.ready, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("local bootstrap recognizes both relative and absolute script invocation paths", () => {
  const moduleUrl = new URL("../scripts/local-bootstrap.mjs", import.meta.url).href;
  const absolute = join(process.cwd(), "scripts", "local-bootstrap.mjs");
  assert.equal(isDirectInvocation(moduleUrl, absolute), true);
  assert.equal(isDirectInvocation(moduleUrl, join("scripts", "local-bootstrap.mjs")), true);
  assert.equal(isDirectInvocation(moduleUrl, join("scripts", "local-doctor.mjs")), false);
});
