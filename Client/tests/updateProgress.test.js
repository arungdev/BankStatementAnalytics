import test from "node:test";
import assert from "node:assert/strict";
import { getUpdateOutcome, isInstallingUpdate } from "../src/utils/updateProgress.js";

const restart = { target: "3.1.0", startedAt: 1000 };
const status = (state, currentVersion = "3.0.0") => ({ state, updateInfo: { currentVersion } });

test("a responding old server does not mean the upgrade completed", () => {
  assert.equal(getUpdateOutcome(status("Installing"), restart, 2000), "waiting");
  assert.equal(getUpdateOutcome(status(6), restart, 2000), "waiting");
  assert.equal(getUpdateOutcome(status("Idle"), restart, 2000), "waiting");
});

test("completion requires the target version and a finished installation", () => {
  assert.equal(getUpdateOutcome(status("Idle", "v3.1.0+commit"), restart, 2000), "complete");
  assert.equal(getUpdateOutcome(status("Installing", "3.1.0"), restart, 2000), "waiting");
  assert.equal(getUpdateOutcome(status("Idle"), { ...restart, target: undefined }, 2000), "waiting");
});

test("both an online old server and an unreachable server time out", () => {
  assert.equal(getUpdateOutcome(status("Installing"), restart, 181000), "timeout");
  assert.equal(getUpdateOutcome(null, restart, 181000), "timeout");
  assert.equal(getUpdateOutcome(status("Error"), restart, 2000), "failed");
  assert.equal(getUpdateOutcome(status("Failed"), restart, 2000), "failed");
  assert.equal(getUpdateOutcome(null, null), "idle");
  assert.equal(isInstallingUpdate(null), false);
});
