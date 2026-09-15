const env = process.env;
if (env.HTTPS_PROXY || env.HTTP_PROXY || env.https_proxy || env.http_proxy) {
  for (const name of ["node:http", "node:https"]) {
    const mod = require(name);
    const Original = mod.Agent;
    function Agent(options) {
      if (!new.target) return new Agent(options);
      return Reflect.construct(
        Original,
        [{ proxyEnv: env, ...options }],
        new.target,
      );
    }
    Agent.prototype = Original.prototype;
    Object.setPrototypeOf(Agent, Original);
    mod.Agent = Agent;
  }
}
