import { describe, expect, it } from "vitest";
import { buildSshArgs } from "../modules/ssh/infrastructure/launch.js";

describe("buildSshArgs", () => {
  it("appends passthrough args after the destination", () => {
    const args = buildSshArgs({
      agentRef: "myagent",
      paths: { dir: "/k", privateKey: "/k/id", publicKey: "/k/id.pub" },
      extra: ["-L", "8080:localhost:8080", "-N"],
    });
    expect(args.slice(-4)).toEqual([
      "myagent",
      "-L",
      "8080:localhost:8080",
      "-N",
    ]);
  });
});
