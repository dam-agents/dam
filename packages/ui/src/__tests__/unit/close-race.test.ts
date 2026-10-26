import {
  type AnyMessage,
  client,
  type ClientConnection,
} from "@agentclientprotocol/sdk";
import { describe, expect, it } from "vitest";

import {
  connectionCloseReason,
  isConnectionClosed,
  withCloseRace,
} from "../../modules/acp/close-race.js";

/**
 * TEST_OVERVIEW: every request on a connection that closes fails as a
 * connection close, never as a plain error.
 *
 * Switching sessions closes the previous session's connection while its
 * `session/prompt` may still be pending. When the connection closes, the SDK
 * rejects every pending request with a plain `Error("ACP connection closed")`,
 * and a request made after the close rejects with it at once. The send path
 * reads `isConnectionClosed()` to tell a drop from a real failure, so a plain
 * error that slips through reaches the user as a red "ACP connection closed"
 * toast after an ordinary session switch.
 */

function silentAgentConnection(): {
  connection: ClientConnection;
  closeStream: () => void;
} {
  let closeReadable = () => {};
  const readable = new ReadableStream<AnyMessage>({
    start(controller) {
      closeReadable = () => controller.close();
    },
  });
  const writable = new WritableStream<AnyMessage>();
  const connection = client().connect({ readable, writable });
  return {
    connection: withCloseRace(connection, () => "switched session"),
    closeStream: () => closeReadable(),
  };
}

async function rejectionOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected the request to reject");
}

describe("withCloseRace", () => {
  /**
   * TEST_SCENARIO: the user switches sessions while the agent is still
   * replying; the pending prompt must fail as a connection close.
   */
  it("should report a pending request as closed when the connection is closed", async () => {
    const { connection } = silentAgentConnection();
    const turn = connection.agent.request("session/prompt", {
      sessionId: "sess-1",
      prompt: [],
    });

    connection.close();

    const err = await rejectionOf(turn);
    expect(isConnectionClosed(err)).toBe(true);
    expect(connectionCloseReason(err)).toBe("switched session");
  });

  /**
   * TEST_SCENARIO: the server drops the WebSocket while a request is pending;
   * the request must fail as a connection close.
   */
  it("should report a pending request as closed when the stream ends", async () => {
    const { connection, closeStream } = silentAgentConnection();
    const turn = connection.agent.request("session/prompt", {
      sessionId: "sess-1",
      prompt: [],
    });

    closeStream();

    expect(isConnectionClosed(await rejectionOf(turn))).toBe(true);
  });

  /**
   * TEST_SCENARIO: a send races a session switch and reaches a connection that
   * is already closed; the request must fail as a connection close.
   */
  it("should report a request made after the close as closed", async () => {
    const { connection } = silentAgentConnection();
    connection.close();
    await connection.closed;

    const err = await rejectionOf(
      connection.agent.request("session/prompt", {
        sessionId: "sess-1",
        prompt: [],
      }),
    );

    expect(isConnectionClosed(err)).toBe(true);
  });
});
