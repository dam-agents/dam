import { expect, test } from "@playwright/test";

import { baseUrl } from "../config.js";
import { createApiClient } from "../lib/api-client.js";
import { getAccessToken } from "../lib/auth.js";
import { createCustomHeaderConnection } from "../lib/connections.js";
import {
  connectionHost,
  connectionName,
  envName,
  headerName,
  sentinel,
  valueFormat,
} from "../lib/fixtures.js";

test("create a custom-header connection", async ({ page }) => {
  const token = await getAccessToken();
  const api = createApiClient(token);

  await test.step("assert clean slate", async () => {
    const conn = (await api.connections.list.query()).find(
      (c) => c.name === connectionName,
    );
    expect(conn, `connection ${connectionName} already exists`).toBeUndefined();
  });

  await test.step("open app", async () => {
    await page.goto(baseUrl);
    await expect(page.getByTestId("app-sidebar")).toBeVisible();
  });

  await test.step("create the connection", async () => {
    await createCustomHeaderConnection(page, {
      name: connectionName,
      host: connectionHost,
      headerName,
      valueFormat,
      value: sentinel,
      envName,
    });
  });

  await test.step("connection is listed in the UI", async () => {
    await expect(page.getByText(connectionName)).toBeVisible();
  });
});
