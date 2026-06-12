import { expect, type Page } from "@playwright/test";

import type { ApiClient } from "./api-client.js";

export interface CustomHeaderConnectionInput {
  name: string;
  host: string;
  headerName: string;
  valueFormat: string;
  value: string;
  envName: string;
}

export async function createCustomHeaderConnection(
  page: Page,
  input: CustomHeaderConnectionInput,
): Promise<void> {
  await page
    .getByTestId("app-sidebar")
    .getByRole("button", { name: "Settings" })
    .click();
  await page.getByRole("button", { name: "Connections", exact: true }).click();
  await page.getByTestId("connection-template-custom-header").click();

  await page.getByTestId("connection-field-name").fill(input.name);
  await page.getByTestId("connection-field-host").fill(input.host);
  await page.getByTestId("connection-field-headerName").fill(input.headerName);
  await page
    .getByTestId("connection-field-valueFormat")
    .fill(input.valueFormat);
  await page.getByTestId("connection-field-value").fill(input.value);
  await page.getByTestId("connection-field-envName").fill(input.envName);

  await page.getByTestId("connection-create-submit").click();
  await expect(page.getByTestId("connection-create-submit")).toBeHidden();
}

export async function getConnectionId(
  api: ApiClient,
  connectionName: string,
): Promise<string> {
  const connections = await api.connections.list.query();
  const conn = connections.find((c) => c.name === connectionName);
  if (!conn) throw new Error(`connection ${connectionName} not found`);
  return conn.id;
}
