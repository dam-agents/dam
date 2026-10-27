import json
import os
import sys
from pathlib import Path

from ruamel.yaml import YAML

HOME = Path(os.environ.get("HERMES_HOME") or Path.home() / ".hermes")
CONFIG = HOME / "config.yaml"
PLATFORM_MCP = HOME / "platform-mcp.json"
PLATFORM_SETTINGS = HOME / "platform-settings.json"
DEFAULT_MODE = "dont_ask"
ROUTER_PROVIDER = "platform"


def _router_url() -> str:
    return os.environ.get("PLATFORM_MODEL_ROUTER_URL", "http://127.0.0.1:24180").rstrip("/") + "/v1"


def _platform_mcp_servers() -> dict:
    try:
        servers = json.loads(PLATFORM_MCP.read_text()).get("mcpServers") or {}
    except (OSError, ValueError):
        return {}
    return {
        name: {k: v for k, v in entry.items() if k in ("url", "headers", "command", "args", "env")}
        for name, entry in servers.items()
        if isinstance(entry, dict)
    }


def write_config() -> None:
    yaml = YAML()
    HOME.mkdir(parents=True, exist_ok=True)
    config = (yaml.load(CONFIG.read_text()) if CONFIG.exists() else None) or {}

    model = config.get("model") if isinstance(config.get("model"), dict) else {}
    model["provider"] = ROUTER_PROVIDER
    model["default"] = os.environ.get("PLATFORM_MODEL") or model.get("default") or "platform-no-model"
    # Auxiliary calls (titles, compression) read these headers, not the provider's.
    model["default_headers"] = {"X-Platform-Harness": "hermes"}
    config["model"] = model

    providers = config.get("providers") if isinstance(config.get("providers"), dict) else {}
    providers[ROUTER_PROVIDER] = {
        "base_url": _router_url(),
        "api_key": "platform-placeholder",
        "transport": "chat_completions",
        "extra_headers": {"X-Platform-Harness": "hermes"},
    }
    config["providers"] = providers

    config["mcp_servers"] = _platform_mcp_servers()
    config.setdefault("approvals", {})["mode"] = "off"
    config.setdefault("security", {})["allow_lazy_installs"] = False
    skills = config.setdefault("skills", {})
    dirs = list(skills.get("external_dirs") or [])
    if "~/.agents/skills" not in dirs:
        dirs.append("~/.agents/skills")
    skills["external_dirs"] = dirs

    with CONFIG.open("w") as f:
        yaml.dump(config, f)


def run_acp() -> None:
    from acp.schema import SetSessionConfigOptionResponse
    from acp_adapter import entry, server

    original = server.HermesACPAgent.set_config_option
    register_mcp = server.HermesACPAgent._register_session_mcp_servers

    async def remember_mcp(self, state, mcp_servers):
        state.platform_mcp_servers = mcp_servers
        await register_mcp(self, state, mcp_servers)

    # The runtime sends a session's model as config option `model` before
    # every prompt; Hermes switches models only through session/set_model,
    # which builds a new agent without the session's MCP servers.
    async def set_config_option(self, config_id, session_id, value, **kwargs):
        if str(config_id) != "model":
            return await original(self, config_id, session_id, value, **kwargs)
        state = self.session_manager.get_session(session_id)
        if state is None:
            return None
        if str(value).split(":")[-1] != state.model:
            await self.set_session_model(model_id=str(value), session_id=session_id)
            await register_mcp(self, state, getattr(state, "platform_mcp_servers", None))
        return SetSessionConfigOptionResponse(config_options=[])

    session_modes = server.HermesACPAgent._session_modes

    # Hermes starts every session on "default", which asks before each edit;
    # nobody answers that on a schedule or channel turn.
    def start_on_configured_mode(self, state):
        if not getattr(state, "mode", None):
            state.mode = _configured_mode()
        return session_modes(self, state)

    server.HermesACPAgent.set_config_option = set_config_option
    server.HermesACPAgent._session_modes = start_on_configured_mode
    server.HermesACPAgent._register_session_mcp_servers = remember_mcp
    entry.main([])


def _configured_mode() -> str:
    try:
        return json.loads(PLATFORM_SETTINGS.read_text()).get("mode") or DEFAULT_MODE
    except (OSError, ValueError):
        return DEFAULT_MODE


if __name__ == "__main__":
    write_config()
    if sys.argv[1:] == ["acp"]:
        run_acp()
