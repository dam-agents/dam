import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:tls";
import type { AddressInfo } from "node:net";
import { probeClusterCa } from "../../modules/connections/infrastructure/cluster-ca-probe.js";

// A real self-signed cert/key for 127.0.0.1 (test-only; never trusted). The
// probe must therefore report untrusted and hand back a pinnable CA.
const TEST_CERT = `-----BEGIN CERTIFICATE-----
MIIDMjCCAhqgAwIBAgIUMiX4bseuRVT+8L+EjCMZs2MIUAMwDQYJKoZIhvcNAQEL
BQAwIDEeMBwGA1UEAwwVcGxhdGZvcm0tdGVzdC1jbHVzdGVyMB4XDTI2MDcwMjEy
MjM1MloXDTM2MDYyOTEyMjM1MlowIDEeMBwGA1UEAwwVcGxhdGZvcm0tdGVzdC1j
bHVzdGVyMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwI5z1cP2t3k2
wu/2LlckhwjH5UhC7WJ6hgTh9bFnvK3IKa3dvy3/yqECvK93JRMh/ADSaM9w0F3d
9q1UMidXy8T/ulb4BFNDOh07DE0W8WVbrHHZ6mXVwdSfKyB40zZ37yW0LzTLUjv7
fAbnABEmcHl7nbTKf2AfidjiU+wOr7QC/R66aLkgC3uqU45mq01bnaEwjmWTb6RY
c1GTg29HxpuBsAgCZwmwiQFYMqUbEu1i5pxL5vTIkCMw3PuPi3sOR4gF9OKs5FmW
7S+Hr9wUE1LEx6au0fVEhgDwTBPzqHCx/VXdqw3tkv1fP/TS+K4pTLXNinXwwZ2C
PF4DLJHsuQIDAQABo2QwYjAdBgNVHQ4EFgQUrbEUzJTKwRH5SYZEEFswPNzV53Qw
HwYDVR0jBBgwFoAUrbEUzJTKwRH5SYZEEFswPNzV53QwDwYDVR0TAQH/BAUwAwEB
/zAPBgNVHREECDAGhwR/AAABMA0GCSqGSIb3DQEBCwUAA4IBAQB9MglpUjdZ2vUg
5li/5lKmV3I+6SvxD40fjuNAMGTxcPWsiYDh75C4LhhlykosPRXPIDYrB//gHbLp
hvl64Ektlaoqdg8Fgy7hlJWCyLtZfCS1g3Z0oZ8nbHCNt+zuT1cFKdzeHKzAHSrD
odtUCpQz+iQ0G+u48thi1UJ+NGCkcXC72F+wYYQsKteY2qqI1R/SaXTf0zWOFUMR
iRE24pgARhd1wueI7Cpdk7FG9lZAHawuOXWODa4sbT182EcVzjG7/Ncwvjpq1Owi
JG2IiAQ+BegQRj1cxNtzkakdTQWYSSw9TdnevQSjjcjPN3jh0kbj0PnSLqhEUNzv
HUAT/xFb
-----END CERTIFICATE-----
`;
const TEST_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDAjnPVw/a3eTbC
7/YuVySHCMflSELtYnqGBOH1sWe8rcgprd2/Lf/KoQK8r3clEyH8ANJoz3DQXd32
rVQyJ1fLxP+6VvgEU0M6HTsMTRbxZVuscdnqZdXB1J8rIHjTNnfvJbQvNMtSO/t8
BucAESZweXudtMp/YB+J2OJT7A6vtAL9HrpouSALe6pTjmarTVudoTCOZZNvpFhz
UZODb0fGm4GwCAJnCbCJAVgypRsS7WLmnEvm9MiQIzDc+4+Lew5HiAX04qzkWZbt
L4ev3BQTUsTHpq7R9USGAPBME/OocLH9Vd2rDe2S/V8/9NL4rilMtc2KdfDBnYI8
XgMskey5AgMBAAECggEAAq2ryTXRzexVT95ynpZlUnntMRbeOqfiBTc2kjcgUEZc
Js6qUcLcCf+CjQlYlbiizy4oi+V5/KWYAgExm9KV4Azvc0uxmEdoNsi6Gr1MkmY5
VJ67/z/g+n89b4yJSB072D6LN3tIHYhQ3GeXX8lDrzc6+iia060mNltz9BYWf88k
+0zHrlP4FspC2VXw0uVYt7ci/ANtZIwPG/XGsUvBY0DqgaAr8tfKVLWbvZabu2wB
iIwqqMZKO4dH3nEc7doxWZa4QJCaiGbgIK44Z2Vl6/uD4njXDBlR0YEoamJ4wO1S
tD+NyCEI1/91Y6X5aArZhXrilU0IzeqXU1uSO64eeQKBgQD5xKNCuzhu0VdCgggP
CdUf5SxzRMJIayjvB2nYKeDaMZEee0iyI7EYMheWjR5b2A2tP03DYHU0ujVVvfec
HQXbBd8KoRPK0r9fnxopFvu4oBDZWIvS+u83ZTlA3WLYngyQaOBPkUJGmRsqByaC
g05bYqQSg4QUu559LEnVqbf2FwKBgQDFXGHq9EGrn0DQZgcj1hrFXQ9yJyY2Pl+m
hg3aY4pN9XJcM6iEjG8Rg/l39YUHOZl1sdZzXiFGRELyVsrW2m3JKoAjZ8mFHTnp
soVlG5Jd+6v/GGhG2fQaCgo1AkTWPSSLLZrXF4tZ2jvoMI9WhQdMaujv4d71Xh7M
IDol27fFrwKBgQCXDZA7JGUdyCdAxsk+5xBoyL3YPIZPK9fGr7IYlEMzUnTUfXTa
n3FUE79mQpRQsVqcI0PRXD2mFNN6tnfQh1DqRCO/FumUaV5p4xv8K7Uy1EM8Xyu4
/h+8XdCBZSKJpRQuJe86z7vIXIIsKcTle6ng5MgblkREEa/pPeatfIYQIwKBgHHQ
ft9iEOUKJ/SGgiOWe0XKDvhDv3OUsNB1ilOhB8dBfrvRRqN54St2sk0Nl7O88dS/
w+4wIHxHLVxX1Q3mVV2nVtIULlDHs/gjbW4LYnM0idHIn4oMcwr5Mz2ym0P5arOg
jyTvfPtKMTYLmv3IJZdaKA7+cPeLWbNZ+m6OsQIdAoGAcQKU4/3SENUGs1fdWey+
umwqF39NnXEMMs7Zac9Y2xR9NE7Smm4vjqbCkOAlUg4a4UccKcYFs/oonljN+GwR
6HcPVeYly1YMJDhTeZyciKuu+Q8o2HmQ8rSE7JPpGrdWA/Yiz3gDVqBcOtZy+W/Z
OxUSvj6+Ec+uwBF8O4MatqQ=
-----END PRIVATE KEY-----
`;

describe("probeClusterCa", () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer({ key: TEST_KEY, cert: TEST_CERT }, (socket) =>
      socket.end(),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.close();
  });

  it("reports a self-signed endpoint as reachable but not trusted", async () => {
    const result = await probeClusterCa(`127.0.0.1:${port}`);
    expect(result.reachable).toBe(true);
    expect(result.trusted).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("reports unreachable for a dead endpoint without throwing", async () => {
    const result = await probeClusterCa("127.0.0.1:1");
    expect(result.reachable).toBe(false);
    expect(result.trusted).toBe(false);
  });
});
