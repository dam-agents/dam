// TEST_OVERVIEW: the built-in provider follows the e2e user's platform-provider feature. Turned on, the user holds exactly one platform-llm Connection, which the API refuses to delete, and Settings / Providers shows a row named after the install's brand that reads Connected and offers no action; turned off, the Connection and the row are gone. The e2e install names a model server that never answers, since nothing here calls the model. The Playwright config runs this spec after every other spec that creates an agent, because while the feature is on a new agent may be granted this provider; the flag is turned off again even when the spec fails.
import { expect, test } from "@playwright/test";
import { brandSchema, PLATFORM_LLM_TEMPLATE_ID } from "api-server-api";

import { baseUrl } from "../../config.js";
import { type ApiClient, createApiClient } from "../../lib/api-client.js";
import { getAccessToken } from "../../lib/auth.js";

let api: ApiClient;

async function setPlatformProvider(enabled: boolean): Promise<void> {
  const flags = await api.features.setFlag.mutate({
    feature: "platform-provider",
    enabled,
  });
  expect(flags["platform-provider"], "the platform-provider flag").toBe(
    enabled,
  );
}

async function platformConnections() {
  return (await api.connections.list.query()).filter(
    (c) => c.templateId === PLATFORM_LLM_TEMPLATE_ID,
  );
}

test.beforeAll(async () => {
  api = createApiClient(await getAccessToken());
});

test.afterAll(async () => {
  await setPlatformProvider(false);
});

test("the built-in provider appears with the feature and leaves with it", async ({
  page,
}) => {
  const brand = brandSchema.parse(
    await (await fetch(`${baseUrl}/api/brand`)).json(),
  );
  const title = page.getByTitle(brand.name, { exact: true });

  await test.step("turning the feature on gives one undeletable connection", async () => {
    await setPlatformProvider(true);
    await expect
      .poll(async () => (await platformConnections()).length, {
        message: "platform-llm connections after turning the feature on",
      })
      .toBe(1);
    const [conn] = await platformConnections();
    await expect(
      api.connections.delete.mutate({ id: conn!.id }),
    ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  });

  await test.step("the row is connected and offers no action", async () => {
    await page.goto(`${baseUrl}/settings/providers`);
    await expect(title).toBeVisible();
    await expect(
      title.locator("..").getByText("Connected", { exact: true }),
    ).toBeVisible();
    for (const action of ["Connect", "Edit"])
      await expect(
        page.getByRole("button", {
          name: `${action} ${brand.name}`,
          exact: true,
        }),
      ).toHaveCount(0);
    await title.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Disconnect/ })).toHaveCount(
      0,
    );
  });

  await test.step("turning the feature off removes the row and the connection", async () => {
    await setPlatformProvider(false);
    await expect
      .poll(async () => (await platformConnections()).length, {
        message: "platform-llm connections after turning the feature off",
      })
      .toBe(0);
    await page.reload();
    await expect(
      page.getByRole("button", { name: /^Connect / }).first(),
    ).toBeVisible();
    await expect(title).toHaveCount(0);
  });
});
