export const mockUser = {
  id_token: "mock-id-token",
  access_token: "mock-access-token",
  token_type: "Bearer",
  scope: "openid profile",
  profile: {
    sub: "mock-user-001",
    name: "Jamie Developer",
    email: "jamie@example.com",
    preferred_username: "jamie",
  },
  expires_at: Math.floor(Date.now() / 1000) + 86400,
  expired: false,
};
