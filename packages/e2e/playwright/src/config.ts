export const baseUrl = process.env.PLATFORM_BASE_URL ?? "http://localhost:4444";

export const testUser = {
  username: process.env.PLATFORM_E2E_USERNAME ?? "dev",
  password: process.env.PLATFORM_E2E_PASSWORD ?? "dev",
};
