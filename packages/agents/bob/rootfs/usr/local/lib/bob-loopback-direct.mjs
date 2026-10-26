/** UNIT_BOUNDARY_DESCRIPTION: Bob's global undici ProxyAgent sends every
 * request through the proxy, NO_PROXY or not, so its calls to the Model
 * Router on the machine's loopback would reach the gateway pod's loopback and
 * fail. This preload sends loopback requests to the dispatcher Node installs
 * under NODE_USE_ENV_PROXY, which honours NO_PROXY, by wrapping the one
 * Object.defineProperty write undici's setGlobalDispatcher makes. */
import { dropOwnImport } from "./bob-preload-lib.mjs";

const KEY = Symbol.for("undici.globalDispatcher.2");
const direct = globalThis[KEY];

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const isLoopback = (origin) => {
  try {
    return LOOPBACK.has(new URL(String(origin)).hostname);
  } catch {
    return false;
  }
};

const loopbackDirect = (agent) =>
  new Proxy(agent, {
    get(target, prop) {
      if (prop === "dispatch")
        return (opts, handler) =>
          isLoopback(opts?.origin)
            ? direct.dispatch(opts, handler)
            : target.dispatch(opts, handler);
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

/** UNIT_BOUNDARY_DESCRIPTION: only the process that installs Bob's proxy
 * agent leaves the preload out of NODE_OPTIONS, so the Node processes it
 * starts (tools, MCP servers, scripts) keep their dispatchers as they are. The
 * `bob chat` TUI runs in a child that its supervisor starts with this env, and
 * the supervisor installs no agent, so the child still gets the preload. */
const dropPreload = () => dropOwnImport("bob-loopback-direct.mjs");

if (direct && typeof direct.dispatch === "function") {
  const define = Object.defineProperty;
  Object.defineProperty = function (target, key, descriptor) {
    if (
      target === globalThis &&
      key === KEY &&
      typeof descriptor?.value?.dispatch === "function" &&
      descriptor.value !== direct
    ) {
      descriptor = { ...descriptor, value: loopbackDirect(descriptor.value) };
      dropPreload();
    }
    return define(target, key, descriptor);
  };
} else {
  process.stderr.write(
    "bob-loopback-direct: no proxy-aware dispatcher (NODE_USE_ENV_PROXY unset?); Bob's loopback calls will go through its proxy\n",
  );
  dropPreload();
}

