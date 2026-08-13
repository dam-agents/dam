import { describe, expect, it } from "vitest";

import {
  inboundFilePath,
  looksLikeSignInPage,
  mayContainMarkup,
  wasSentAsImage,
} from "../../modules/channels/inbound-file.js";

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

  it("falls back to the extension when the label says nothing", () => {
    // Some clients upload a screenshot as an octet-stream blob; filing that as
    // a document would stop the agent from seeing a picture it can read.
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
    // A `.png` inside a document's name is not a picture — the label wins.
    expect(
      wasSentAsImage({ mimeType: "application/pdf", name: "logo.png.pdf" }),
    ).toBe(false);
  });
});

describe("mayContainMarkup", () => {
  it("is true for the formats whose own contents can be markup", () => {
    expect(mayContainMarkup({ mimeType: "text/html", name: "p.html" })).toBe(
      true,
    );
    expect(mayContainMarkup({ mimeType: "text/plain", name: "n.txt" })).toBe(
      true,
    );
    expect(mayContainMarkup({ name: "transcript.vtt" })).toBe(true);
    expect(mayContainMarkup({ name: "data.json" })).toBe(true);
    expect(mayContainMarkup({ mimeType: "application/xml" })).toBe(true);
  });

  it("is false for binary documents, where markup means the download failed", () => {
    expect(
      mayContainMarkup({ mimeType: "application/pdf", name: "s.pdf" }),
    ).toBe(false);
    expect(
      mayContainMarkup({
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        name: "d.docx",
      }),
    ).toBe(false);
    expect(mayContainMarkup({})).toBe(false);
  });
});

describe("looksLikeSignInPage", () => {
  it("recognises the page a messenger serves instead of a file", () => {
    // The real thing names Slack, in its title or its asset URLs.
    expect(looksLikeSignInPage("<html><title>Slack</title>")).toBe(true);
    // A redirect stub, which is what a refused download often is.
    expect(
      looksLikeSignInPage(
        '<html><head><meta http-equiv="refresh" content="0;url=https://acme.slack.com/signin"></head>',
      ),
    ).toBe(true);
    expect(
      looksLikeSignInPage('<html><form action="https://slack.com/signin">'),
    ).toBe(true);
    // HTML attribute order is not significant, so neither is it here.
    expect(
      looksLikeSignInPage(
        '<html><head><meta content="0;url=https://acme.slack.com/signin" http-equiv="refresh"></head>',
      ),
    ).toBe(true);
    expect(
      looksLikeSignInPage("<html><h1>You are not authorized</h1></html>"),
    ).toBe(true);
    // Or it is unmistakably a login form, whoever serves it.
    expect(
      looksLikeSignInPage(
        '<html><form>Sign in<input type="password" name="p"></form>',
      ),
    ).toBe(true);
    // A title that sits behind a stylesheet is still the title — the head is
    // scanned far enough to reach it.
    expect(
      looksLikeSignInPage(
        `<!DOCTYPE html><html><head><style>${"a{color:red}".repeat(120)}</style><title>Sign in to Slack</title></head>`,
      ),
    ).toBe(true);
    // An XML prologue is the shape the byte classifier already calls a page.
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
    // Someone's own JSON, which happens to be an error shape, is their file.
    expect(looksLikeSignInPage('{"ok":false,"error":"rate_limited"}')).toBe(
      false,
    );
    expect(looksLikeSignInPage('{"items":[{"id":1}]}')).toBe(false);
  });

  it("leaves a genuine document alone, even one that talks about signing in", () => {
    // A saved page is a real upload; only the refusal is a failed download. A
    // generic phrase must not decide it — these were all withheld before the
    // markers were tightened.
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
    // A runbook quoting an error, and a saved page that merely links to a
    // workspace: both say these words in the body, where they mean nothing.
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
    // A document that merely links to a sign-in page is still the document —
    // whether the link is prose, an og:url, or a description.
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
    // And a lookalike host cannot stand in for the real one.
    expect(
      looksLikeSignInPage(
        '<html><form action="https://notslack.com/signin"><input type="text">',
      ),
    ).toBe(false);
    // Not markup at all.
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

  it("strips anything that would escape the directory or hide the file", () => {
    // The sender picks the filename, and in a shared channel the sender is
    // whoever the messenger admits.
    const path = inboundFilePath({
      conversation: "../../etc",
      name: "../../../.bashrc",
      unique: "0000ffff",
    });

    expect(path).toBe(".uploads/_.._etc/0000ffff-_.._.._.bashrc");
    // Two segments below the root, neither of them a traversal or a dotfile.
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
