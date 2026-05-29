import { composeScriptedMock } from "./modules/scripted-mock/index.js";

console.log = console.error;
console.info = console.error;
console.warn = console.error;
console.debug = console.error;

const controlPort = Number.parseInt(
  process.env.MOCK_CONTROL_PORT ?? "8081",
  10,
);
const controlHost = process.env.MOCK_CONTROL_HOST ?? "0.0.0.0";

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

await composition.start({ controlPort, controlHost });
process.stderr.write(
  `[mock-agent] control listening on http://${controlHost}:${controlPort}/api/trpc\n`,
);
process.stdin.resume();
