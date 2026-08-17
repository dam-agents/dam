import { describe, expect, it } from "vitest";

import {
  inboundFilePath,
  looksLikeSignInPage,
  wasSentAsImage,
} from "../../modules/channels/inbound-file.js";

/**
 * TEST_OVERVIEW: the decisions taken about an inbound attachment before it is delivered.
 *
 * Two of them, each with a failure on both sides. Whether the sender sent a
 * picture or a file decides which door the bytes take, and a bad label must not
 * file a real screenshot as a document. Whether markup is the messenger refusing
 * decides whether it is written into the workspace at all: believe it too
 * readily and the agent summarises a login screen as the sender's spreadsheet;
 * too reluctantly and a genuine saved page is refused, blaming a permission that
 * is granted.
 */

describe("wasSentAsImage", () => {
  it("takes the sender's label when there is one", () => {
    expect(wasSentAsImage({ mimeType: "image/png", name: "a.png" })).toBe(true);
    expect(wasSentAsImage({ mimeType: "image/heic", name: "a.heic" })).toBe(
      true,
    );
    expect(wasSentAsImage({ mimeType: "application/pdf", name: "a.pdf" })).toBe(
      false,
    );
  });

  /**
   * TEST_SCENARIO: Some clients upload a screenshot as an octet-stream blob. Filing that
   * as a document would stop the agent from seeing a picture it can read.
   */
  it("falls back to the extension when the label says nothing", () => {
    expect(
      wasSentAsImage({
        mimeType: "application/octet-stream",
        name: "Screenshot.PNG",
      }),
    ).toBe(true);
    expect(
      wasSentAsImage({ mimeType: "binary/octet-stream", name: "notes.txt" }),
    ).toBe(false);
    expect(wasSentAsImage({ name: "photo.jpeg" })).toBe(true);
    expect(wasSentAsImage({})).toBe(false);
  });

  it("does not read an image extension out of a labelled document", () => {
    expect(
      wasSentAsImage({ mimeType: "application/pdf", name: "logo.png.pdf" }),
    ).toBe(false);
  });
});

describe("looksLikeSignInPage", () => {
  /**
   * TEST_SCENARIO: A refused download arrives as a 200 with a page. Written into the
   * workspace under the sender's filename, the agent answers from it.
   */
  it("recognises the page a messenger serves instead of a file", () => {
    expect(looksLikeSignInPage("<html><title>Slack</title>")).toBe(true);
    expect(
      looksLikeSignInPage(
        '<html><head><meta http-equiv="refresh" content="0;url=https://acme.slack.com/signin"></head>',
      ),
    ).toBe(true);
    expect(
      looksLikeSignInPage('<html><form action="https://slack.com/signin">'),
    ).toBe(true);
    expect(
      looksLikeSignInPage(
        "<html><meta http-equiv=refresh content=0;url=https://slack.com/signin>",
      ),
    ).toBe(true);
    expect(
      looksLikeSignInPage(
        '<html><head><meta name="x" content="a>b"><meta http-equiv="refresh" content="0;url=https://slack.com/signin"></head>',
      ),
    ).toBe(true);
    expect(
      looksLikeSignInPage(
        '<html><head><meta content="0;url=https://acme.slack.com/signin" http-equiv="refresh"></head>',
      ),
    ).toBe(true);
    expect(
      looksLikeSignInPage("<html><h1>You are not authorized</h1></html>"),
    ).toBe(true);
    expect(
      looksLikeSignInPage(
        '<html><form>Sign in<input type="password" name="p"></form>',
      ),
    ).toBe(true);
    expect(
      looksLikeSignInPage(
        `<!DOCTYPE html><html><head><style>${"a{color:red}".repeat(120)}</style><title>Sign in to Slack</title></head>`,
      ),
    ).toBe(true);
    expect(
      looksLikeSignInPage(
        '<?xml version="1.0"?><html><title>Sign in to Slack</title>',
      ),
    ).toBe(true);
  });

  it("recognises the API refusal a JSON download can be", () => {
    expect(
      looksLikeSignInPage('{"ok":false,"error":"not_allowed_token_type"}'),
    ).toBe(true);
    expect(looksLikeSignInPage('{"ok":false,"error":"rate_limited"}')).toBe(
      false,
    );
    expect(looksLikeSignInPage('{"items":[{"id":1}]}')).toBe(false);
  });

  /**
   * TEST_SCENARIO: The other direction, and the one that bites in normal use: a saved
   * page, a runbook quoting an error, a document linking to a workspace. Withholding
   * these tells the sender to fix a permission that was never the problem.
   */
  it("leaves a genuine document alone, even one that talks about signing in", () => {
    expect(
      looksLikeSignInPage(
        "<!DOCTYPE html><html><h1>Quarterly report</h1><table>",
      ),
    ).toBe(false);
    expect(looksLikeSignInPage("<html><h1>My blog index</h1>")).toBe(false);
    expect(looksLikeSignInPage("<html><p>catalog information</p>")).toBe(false);
    expect(
      looksLikeSignInPage("<html><nav>Sign in</nav><h1>Release notes</h1>"),
    ).toBe(false);
    expect(
      looksLikeSignInPage("<html><p>How permissions work in Kubernetes</p>"),
    ).toBe(false);
    expect(
      looksLikeSignInPage(
        "<html><h1>Runbook</h1><p>If the logs say permission denied, ask an admin.</p>",
      ),
    ).toBe(false);
    expect(
      looksLikeSignInPage(
        '<html><head><meta property="og:url" content="https://acme.slack.com/archives/C1/p1"></head><h1>Standup</h1>',
      ),
    ).toBe(false);
    expect(
      looksLikeSignInPage(
        '<html><h1>Onboarding</h1><a href="https://slack.com/signin">sign in here</a>',
      ),
    ).toBe(false);
    expect(
      looksLikeSignInPage(
        '<html><head><meta name="description" content="How to sign in: https://slack.com/signin"><title>Onboarding notes</title></head>',
      ),
    ).toBe(false);
    expect(
      looksLikeSignInPage(
        '<html><head><meta property="og:url" content="https://acme.slack.com/signin"></head><h1>Notes</h1>',
      ),
    ).toBe(false);
    expect(
      looksLikeSignInPage(
        '<html><form action="https://notslack.com/signin"><input type="text">',
      ),
    ).toBe(false);
    expect(
      looksLikeSignInPage(
        '<html><form action="https://evil.example/?next=https://slack.com/signin">',
      ),
    ).toBe(false);
    expect(
      looksLikeSignInPage(
        '<html><head><meta http-equiv="refresh" content="0;url=https://evil.example/?to=https://slack.com/signin"></head>',
      ),
    ).toBe(false);
    expect(looksLikeSignInPage("%PDF-1.7")).toBe(false);
    expect(looksLikeSignInPage("name,total\nsign in,3\n")).toBe(false);
  });
});

describe("inboundFilePath", () => {
  it("puts the file under .uploads, in its conversation, behind the prefix", () => {
    expect(
      inboundFilePath({
        conversation: "C123ABC:1712345678.123456",
        name: "spec.pdf",
        unique: "ab12cd34",
      }),
    ).toBe(".uploads/C123ABC_1712345678.123456/ab12cd34-spec.pdf");
  });

  /**
   * TEST_SCENARIO: The sender picks the filename, and in a shared channel the sender is
   * whoever the messenger admits.
   */
  it("strips anything that would escape the directory or hide the file", () => {
    const path = inboundFilePath({
      conversation: "../../etc",
      name: "../../../.bashrc",
      unique: "0000ffff",
    });

    expect(path).toBe(".uploads/_.._etc/0000ffff-_.._.._.bashrc");
    expect(path.split("/")).toHaveLength(3);
    expect(path.split("/").slice(1)).not.toContain("..");
    expect(path.split("/").slice(1).join("/")).not.toMatch(/(^|\/)\./);
  });

  it("still yields a path when the name is nothing usable", () => {
    expect(
      inboundFilePath({ conversation: "C1", name: "...", unique: "deadbeef" }),
    ).toBe(".uploads/C1/deadbeef-file");
  });
});
