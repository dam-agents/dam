// TEST_OVERVIEW: A create form starts a person who holds the deployment's shared CurveBender on the Pi harness and that Connection, which the picker lists as "CurveBender" apart from an own-key CurveBender. Without the shared Connection the form starts as before, and a starter kit keeps its own harness and provider.
import { CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID } from "api-server-api";
import { describe, expect, it } from "vitest";

import { curveBenderPreselection } from "../../modules/agents/lib/create-agent-input.js";
import type { ProviderItem } from "../../modules/providers/components/provider-item.js";
import { providerChoices } from "../../modules/providers/lib/provider-rows.js";
import { reconcileHarnessSelection } from "../../modules/sandboxes/lib/image-catalogue.js";
import type { ProviderPresetType, TemplateView } from "../../types.js";

const harness = (id: string): TemplateView => ({
  id,
  name: id,
  image: `quay.io/x/${id}:latest`,
  category: "harness",
  experimental: false,
});
const CATALOGUE = [harness("claude-code"), harness("pi-agent")];
const item = (id: string, templateId: string) =>
  ({ id, conn: { id, templateId } }) as ProviderItem;
const shared = item("conn-shared", CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID);
const ownKey = item("conn-own", "curve-bender");
const ibm = item("conn-ibm", "ibm-litellm");
const ROWS: { type: ProviderPresetType; description: string }[] = [
  { type: "ibm-litellm", description: "" },
  { type: "curve-bender", description: "" },
];
const items = (...held: ProviderItem[]) => ({
  itemByType: new Map(
    held
      .filter((i) => i !== shared)
      .map((i) => [i.conn.templateId as ProviderPresetType, i]),
  ),
  shared: held.includes(shared) ? shared : undefined,
});

describe("the harness and provider a create form starts on", () => {
  // TEST_SCENARIO: a person who holds the shared Connection starts on Pi and the shared Connection, ahead of an IBM provider they also hold.
  it("starts on Pi and the shared Connection when it is held", () => {
    const pre = curveBenderPreselection(null, [shared.conn]);
    expect(pre).toEqual({
      harnessTemplateId: "pi-agent",
      settled: true,
      preferShared: true,
    });
    expect(
      reconcileHarnessSelection(CATALOGUE, null, {
        allowNone: false,
        preferred: pre.harnessTemplateId,
      }),
    ).toEqual({ templateId: "pi-agent" });
    expect(
      providerChoices(ROWS, items(ibm, shared), pre.preferShared).autoSelect,
    ).toBe(shared);
  });

  // TEST_SCENARIO: a harness the person already picked stays picked; the preference fills only an empty choice.
  it("keeps an earlier harness choice", () => {
    expect(
      reconcileHarnessSelection(CATALOGUE, "claude-code", {
        allowNone: false,
        preferred: "pi-agent",
      }),
    ).toBeNull();
  });

  // TEST_SCENARIO: without the shared Connection the form starts on today's default harness and the first provider held.
  it("starts as before without the shared Connection", () => {
    const pre = curveBenderPreselection(null, [ibm.conn]);
    expect(pre).toEqual({ settled: true, preferShared: false });
    expect(
      reconcileHarnessSelection(CATALOGUE, null, { allowNone: false }),
    ).toEqual({ templateId: "claude-code" });
    expect(providerChoices(ROWS, items(ibm), false).autoSelect).toBe(ibm);
  });

  // TEST_SCENARIO: a starter kit chooses its own harness and provider, so the shared Connection takes no precedence; and until the Connection list answers, nothing is decided.
  it("lets a kit win and waits for the Connection list", () => {
    expect(curveBenderPreselection({}, [shared.conn])).toEqual({
      settled: true,
      preferShared: false,
    });
    expect(providerChoices(ROWS, items(ibm, shared), false).autoSelect).toBe(
      ibm,
    );
    expect(curveBenderPreselection(null, undefined).settled).toBe(false);
  });

  // TEST_SCENARIO: the picker lists the shared Connection as its own choice; the own-key choice shows only while an own key is held, and then both are choosable.
  it("lists the shared and own-key CurveBender apart", () => {
    const choicesOf = (...held: ProviderItem[]) =>
      providerChoices(ROWS, items(...held), false).choices.map((c) => [
        c.choice,
        c.item?.id,
      ]);
    expect(choicesOf(shared)).toEqual([
      ["ibm-litellm", undefined],
      [CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID, "conn-shared"],
    ]);
    expect(choicesOf(shared, ownKey)).toEqual([
      ["ibm-litellm", undefined],
      [CURVE_BENDER_DEPLOYMENT_TEMPLATE_ID, "conn-shared"],
      ["curve-bender", "conn-own"],
    ]);
    expect(choicesOf()).toEqual([
      ["ibm-litellm", undefined],
      ["curve-bender", undefined],
    ]);
  });
});
