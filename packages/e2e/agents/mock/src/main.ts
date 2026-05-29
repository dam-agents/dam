import { composeScriptedMock } from "./modules/scripted-mock/index.js";

console.log = console.error;
console.info = console.error;
console.warn = console.error;
console.debug = console.error;

const composition = composeScriptedMock();

const defaultReply = process.env.MOCK_DEFAULT_REPLY;
if (defaultReply) {
  composition.scriptedMock.setScript({
    entries: [
      {
        sessionUpdate: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: defaultReply },
        },
      },
    ],
    stopReason: "end_turn",
  });
}

process.stderr.write("[mock-agent] tRPC control dispatch on stdio ready\n");
process.stdin.resume();
