// TEST_OVERVIEW: which Backend a create form offers and sends. The install's default Backend decides first — a vm default offers the microVM to everyone, with no per-user flag — and the vm-sandboxes flag only matters on an install that still defaults to containers. A template that needs a pod is always a container, and a user may pick a container over the offered microVM.
import { describe, expect, it } from "vitest";

import {
  backendLine,
  effectiveBackend,
  kitBackend,
} from "../../modules/agents/lib/create-backend.js";
import { backendOffer } from "../../modules/features/lib/backend-offer.js";

const vmInstall = {
  value: { virtualization: true, defaultBackend: "vm" as const },
  failed: false,
};
const containerInstall = {
  value: { virtualization: true, defaultBackend: "container" as const },
  failed: false,
};
const flag = (value: boolean | undefined, failed = false) => ({
  value,
  failed,
});

describe("backendOffer", () => {
  // TEST_SCENARIO: once the operator makes vm the install default, the experimental flag no longer gates it — an owner who never opted in, or whose flags have not loaded, still gets the microVM.
  it("offers the microVM on a vm-default install without asking the flag", () => {
    expect(backendOffer(vmInstall, flag(false))).toEqual({
      answered: true,
      vmOffered: true,
      installDefault: "vm",
    });
    expect(backendOffer(vmInstall, flag(undefined)).answered).toBe(true);
    expect(backendOffer(vmInstall, flag(undefined, true)).vmOffered).toBe(true);
  });

  it("offers it on a container-default install only to a flagged-in user", () => {
    expect(backendOffer(containerInstall, flag(true)).vmOffered).toBe(true);
    expect(backendOffer(containerInstall, flag(false)).vmOffered).toBe(false);
    expect(backendOffer(containerInstall, flag(undefined)).answered).toBe(
      false,
    );
  });

  it("never offers it where the install cannot run one", () => {
    const off = {
      value: { virtualization: false, defaultBackend: "container" as const },
      failed: false,
    };
    expect(backendOffer(off, flag(true))).toMatchObject({
      answered: true,
      vmOffered: false,
    });
  });

  // TEST_SCENARIO: a form waits for the install's answer rather than creating something its author did not choose; a failed read settles as a container the form then shows.
  it("waits for the install answer, and settles a failed one as no microVM", () => {
    expect(
      backendOffer({ value: undefined, failed: false }, flag(true)).answered,
    ).toBe(false);
    expect(
      backendOffer({ value: undefined, failed: true }, flag(true)),
    ).toMatchObject({ answered: true, vmOffered: false });
  });
});

describe("effectiveBackend", () => {
  const offered = { vmOffered: true };

  it("defaults to the microVM where one is offered, and lets a user pick a container", () => {
    expect(
      effectiveBackend({
        offer: offered,
        containerOnlyReason: undefined,
        picked: null,
      }),
    ).toBe("vm");
    expect(
      effectiveBackend({
        offer: offered,
        containerOnlyReason: undefined,
        picked: "container",
      }),
    ).toBe("container");
  });

  it("keeps a container-only template on a container whatever was picked", () => {
    expect(
      effectiveBackend({
        offer: offered,
        containerOnlyReason: "its template requests the device resource gpu",
        picked: "vm",
      }),
    ).toBe("container");
  });

  it("is a container where no microVM is offered", () => {
    expect(
      effectiveBackend({
        offer: { vmOffered: false },
        containerOnlyReason: undefined,
        picked: "vm",
      }),
    ).toBe("container");
  });
});

describe("kitBackend", () => {
  it("shows what the kit declares, else the install default the create will apply", () => {
    const vmDefault = { installDefault: "vm" as const };
    expect(
      kitBackend({
        declared: "container",
        offer: vmDefault,
        containerOnlyReason: undefined,
      }),
    ).toBe("container");
    expect(
      kitBackend({
        declared: undefined,
        offer: vmDefault,
        containerOnlyReason: undefined,
      }),
    ).toBe("vm");
    expect(
      kitBackend({
        declared: undefined,
        offer: vmDefault,
        containerOnlyReason: "its template places its pod on selected nodes",
      }),
    ).toBe("container");
    expect(
      kitBackend({
        declared: undefined,
        offer: { installDefault: "container" },
        containerOnlyReason: undefined,
      }),
    ).toBe("container");
  });
});

describe("backendLine", () => {
  it("tells the user why a template stays a container", () => {
    expect(
      backendLine("container", "its template places its pod on selected nodes"),
    ).toBe(
      "Runs as a container, because its template places its pod on selected nodes.",
    );
    expect(backendLine("vm", undefined)).toBe(
      "Runs on the new sandbox runtime.",
    );
  });
});
