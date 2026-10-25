import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";

export function acpClient(
  cmd,
  args,
  { env, cwd, name, onRequest, onNotification, log = () => {} },
) {
  const child = spawn(cmd, args, { env, cwd, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let nextId = 1;
  let buf = "";
  const stderr = [];
  child.stderr.on("data", (d) => {
    const s = String(d);
    stderr.push(s);
    log(`${name} stderr: ${s.trim().slice(0, 300)}`);
  });
  child.stdout.on("data", (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id !== undefined && msg.method === undefined) {
        const p = pending.get(msg.id);
        if (!p) continue;
        pending.delete(msg.id);
        if (msg.error)
          p.reject(
            new Error(
              `${p.method}: ${JSON.stringify(msg.error).slice(0, 300)}`,
            ),
          );
        else p.resolve(msg.result);
      } else if (msg.method !== undefined && msg.id !== undefined) {
        Promise.resolve(onRequest?.(msg.method, msg.params)).then(
          (result) =>
            child.stdin.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                result: result ?? {},
              }) + "\n",
            ),
          (e) =>
            child.stdin.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                error: { code: -32000, message: String(e.message ?? e) },
              }) + "\n",
            ),
        );
      } else if (msg.method !== undefined)
        onNotification?.(msg.method, msg.params);
    }
  });
  const request = (method, params, timeoutMs = 120_000) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const t = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error(
            `${method} timed out after ${timeoutMs}ms; stderr tail: ${stderr.slice(-3).join("").slice(-400)}`,
          ),
        );
      }, timeoutMs);
      pending.set(id, {
        method,
        resolve: (r) => {
          clearTimeout(t);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  const close = async () => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        once(child, "exit"),
        new Promise((r) => setTimeout(r, 3000)),
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  };
  return { request, close, child };
}

export const allowPermission = (method, params) => {
  if (method === "session/request_permission") {
    const o =
      params.options?.find((x) => /allow/i.test(x.kind ?? x.optionId)) ??
      params.options?.[0];
    return { outcome: { outcome: "selected", optionId: o?.optionId } };
  }
  throw new Error(`unsupported client request ${method}`);
};

const sse = (events) =>
  events
    .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");

const usage = { input_tokens: 10, output_tokens: 3 };

export function messagesText(model, text, stream) {
  if (!stream) {
    return {
      contentType: "application/json",
      body: JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "text", text }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage,
      }),
    };
  }
  return {
    contentType: "text/event-stream",
    body: sse([
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 3 },
      },
      { type: "message_stop" },
    ]),
  };
}

export function messagesTool(model, name, input, stream) {
  if (!stream) {
    return {
      contentType: "application/json",
      body: JSON.stringify({
        id: "msg_2",
        type: "message",
        role: "assistant",
        model,
        content: [{ type: "tool_use", id: "toolu_1", name, input }],
        stop_reason: "tool_use",
        stop_sequence: null,
        usage,
      }),
    };
  }
  const json = JSON.stringify(input);
  return {
    contentType: "text/event-stream",
    body: sse([
      {
        type: "message_start",
        message: {
          id: "msg_2",
          type: "message",
          role: "assistant",
          model,
          content: [],
          stop_reason: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu_1", name, input: {} },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "input_json_delta", partial_json: json },
      },
      { type: "content_block_stop", index: 0 },
      {
        type: "message_delta",
        delta: { stop_reason: "tool_use", stop_sequence: null },
        usage: { output_tokens: 5 },
      },
      { type: "message_stop" },
    ]),
  };
}

export async function mockRouter({ catalog, answer, log = () => {} }) {
  const seen = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "HEAD" && url.pathname === "/api/hello")
      return res.writeHead(200).end();
    if (req.method === "GET" && url.pathname === "/v1/models") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          data: catalog.map((m) => ({
            id: `claude/${m.alias}/${m.id}`,
            object: "model",
            type: "model",
            display_name: m.id,
            description: m.alias,
          })),
          has_more: false,
        }),
      );
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {}
    if (url.pathname.endsWith("/count_tokens")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ input_tokens: 10 }));
    }
    const m = /^claude\/([a-z]+)\/(.+)$/.exec(body?.model ?? "");
    const alias = m?.[1] ?? catalog[0]?.alias ?? null;
    const model = m?.[2] ?? body?.model ?? "";
    seen.push({ alias, model, bare: !m, body, headers: req.headers });
    log(
      `router ${req.method} ${url.pathname} model=${body?.model} stream=${body?.stream === true}`,
    );
    const reply = answer({ alias, model, body, seen });
    if (reply.status && reply.status >= 400) {
      res.writeHead(reply.status, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: reply.message ?? "refused",
          },
        }),
      );
    }
    const name = body?.model ?? "";
    const rendered = reply.tool
      ? messagesTool(
          name,
          reply.tool.name,
          reply.tool.input,
          body?.stream === true,
        )
      : messagesText(name, reply.text ?? "ok", body?.stream === true);
    res.writeHead(200, { "content-type": rendered.contentType });
    res.end(rendered.body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    port: server.address().port,
    base: `http://127.0.0.1:${server.address().port}`,
    seen,
    close: () => server.close(),
  };
}

export const modelOption = (configOptions) =>
  configOptions?.find((o) => o.id === "model");
export const conversationCalls = (seen, promptText) =>
  seen.filter((s) =>
    JSON.stringify(s.body?.messages ?? []).includes(promptText),
  );
export const pickerValues = (configOptions) =>
  (modelOption(configOptions)?.options ?? [])
    .flatMap((o) => ("options" in o ? o.options : [o]))
    .map((o) => o.value);

export function responsesText(model, text, stream) {
  const item = {
    type: "message",
    id: "msg_r1",
    status: "completed",
    role: "assistant",
    content: [{ type: "output_text", text, annotations: [] }],
  };
  const response = (status, output) => ({
    id: "resp_1",
    object: "response",
    created_at: 1,
    status,
    model,
    output,
    usage: {
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 2,
      output_tokens_details: { reasoning_tokens: 0 },
      total_tokens: 12,
    },
  });
  if (!stream)
    return {
      contentType: "application/json",
      body: JSON.stringify(response("completed", [item])),
    };
  return {
    contentType: "text/event-stream",
    body: sse([
      {
        type: "response.created",
        sequence_number: 0,
        response: response("in_progress", []),
      },
      {
        type: "response.output_item.added",
        sequence_number: 1,
        output_index: 0,
        item: { ...item, status: "in_progress", content: [] },
      },
      {
        type: "response.content_part.added",
        sequence_number: 2,
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text: "", annotations: [] },
      },
      {
        type: "response.output_text.delta",
        sequence_number: 3,
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        delta: text,
      },
      {
        type: "response.output_text.done",
        sequence_number: 4,
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        text,
      },
      {
        type: "response.content_part.done",
        sequence_number: 5,
        item_id: item.id,
        output_index: 0,
        content_index: 0,
        part: { type: "output_text", text, annotations: [] },
      },
      {
        type: "response.output_item.done",
        sequence_number: 6,
        output_index: 0,
        item,
      },
      {
        type: "response.completed",
        sequence_number: 7,
        response: response("completed", [item]),
      },
    ]),
  };
}

export function codexCatalogEntry(
  slug,
  display,
  reasoning = true,
  contextWindow = 200_000,
) {
  const levels = [
    { effort: "low", description: "Fast responses with lighter reasoning" },
    {
      effort: "medium",
      description: "Balances speed and reasoning depth for everyday tasks",
    },
    {
      effort: "high",
      description: "Greater reasoning depth for complex problems",
    },
    {
      effort: "xhigh",
      description: "Extra high reasoning depth for complex problems",
    },
  ];
  return {
    slug,
    display_name: display,
    description: `${display} via the platform router`,
    default_reasoning_level: reasoning ? "medium" : null,
    supported_reasoning_levels: reasoning ? levels : [],
    shell_type: "shell_command",
    visibility: "list",
    supported_in_api: true,
    priority: 1,
    availability_nux: null,
    upgrade: null,
    model_messages: {
      instructions_template: "You are Codex, a coding agent. Answer briefly.",
    },
    include_skills_usage_instructions: true,
    include_apps_usage_instructions: true,
    include_plugin_usage_instructions: true,
    default_reasoning_summary: "none",
    support_verbosity: false,
    default_verbosity: null,
    apply_patch_tool_type: "freeform",
    web_search_tool_type: "text_and_image",
    truncation_policy: { mode: "tokens", limit: 10_000 },
    supports_image_detail_original: false,
    context_window: contextWindow,
    max_context_window: contextWindow,
    auto_compact_token_limit: null,
    comp_hash: null,
    experimental_supported_tools: [],
    input_modalities: ["text", "image"],
    supports_parallel_tool_calls: true,
    tool_mode: null,
    multi_agent_version: null,
    multi_agent_reasoning_effort: null,
    use_responses_lite: false,
    supports_reasoning_effort_updates: false,
    guardian: null,
    node_repl_auto_review_required: false,
    node_repl_disabled: false,
    requires_sandboxed_review: false,
    auto_review_model_override: null,
    model_specialty: null,
    minimal_client_version: "0.1.0",
  };
}

export async function mockCodexRouter({
  catalog,
  text = "ok",
  log = () => {},
}) {
  const seen = [];
  let catalogHits = 0;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/codex/models") {
      catalogHits++;
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          models: catalog.map((m) =>
            codexCatalogEntry(
              `${m.alias}/${m.id}`,
              m.display ?? m.id,
              m.reasoning ?? true,
            ),
          ),
        }),
      );
    }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    let body = null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {}
    if (!url.pathname.endsWith("/responses")) {
      res.writeHead(404, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({ error: { message: `no route ${url.pathname}` } }),
      );
    }
    const m = /^([a-z]+)\/(.+)$/.exec(body?.model ?? "");
    const known = m && catalog.some((c) => c.alias === m[1]);
    const alias = known ? m[1] : (catalog[0]?.alias ?? null);
    const model = known ? m[2] : (body?.model ?? "");
    seen.push({ alias, model, bare: !known, body, headers: req.headers });
    log(
      `router POST ${url.pathname} model=${body?.model} stream=${body?.stream === true}`,
    );
    const rendered = responsesText(
      body?.model ?? "",
      text,
      body?.stream === true,
    );
    res.writeHead(200, { "content-type": rendered.contentType });
    res.end(rendered.body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    port: server.address().port,
    base: `http://127.0.0.1:${server.address().port}`,
    seen,
    catalogHits: () => catalogHits,
    close: () => server.close(),
  };
}

export function chatStream(model, { text, tool }) {
  const chunk = (delta, finish) => ({
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1,
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  const events = tool
    ? [
        chunk(
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                type: "function",
                function: {
                  name: tool.name,
                  arguments: JSON.stringify(tool.arguments),
                },
              },
            ],
          },
          null,
        ),
        chunk({}, "tool_calls"),
      ]
    : [chunk({ role: "assistant", content: text }, null), chunk({}, "stop")];
  events.push({
    id: "chatcmpl-1",
    object: "chat.completion.chunk",
    created: 1,
    model,
    choices: [],
    usage: { prompt_tokens: 10, completion_tokens: 3, total_tokens: 13 },
  });
  return {
    contentType: "text/event-stream",
    body:
      events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") +
      "data: [DONE]\n\n",
  };
}

export async function fakePlatformMcp({ tools = [], callResult } = {}) {
  const calls = [];
  const waiters = [];
  const server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.statusCode = 405;
      return res.end();
    }
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const message = JSON.parse(body);
      calls.push({
        method: message.method,
        headers: req.headers,
        params: message.params,
      });
      for (const w of waiters.splice(0)) w();
      if (message.id === undefined) {
        res.statusCode = 202;
        return res.end();
      }
      const result =
        message.method === "initialize"
          ? {
              protocolVersion: message.params.protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: "platform", version: "0" },
            }
          : message.method === "tools/list"
            ? { tools }
            : message.method === "tools/call"
              ? {
                  content: [
                    {
                      type: "text",
                      text: callResult?.(message.params, req.headers) ?? "ok",
                    },
                  ],
                }
              : {};
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    url: `http://127.0.0.1:${server.address().port}/mcp`,
    calls,
    waitFor: async (pred, what, timeoutMs = 60_000) => {
      const deadline = Date.now() + timeoutMs;
      while (!pred(calls)) {
        const left = deadline - Date.now();
        if (left <= 0)
          throw new Error(
            `timed out waiting for ${what}; the platform server saw: ${calls.map((c) => c.method).join(", ") || "nothing"}`,
          );
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, left);
          waiters.push(() => {
            clearTimeout(timer);
            resolve();
          });
        });
      }
    },
    close: () => server.close(),
  };
}
