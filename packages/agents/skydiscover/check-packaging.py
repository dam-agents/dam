import pathlib

import skydiscover
import yaml

pkg = pathlib.Path(skydiscover.__file__).parent
cfg = pkg / "search/evox/config"
assert yaml.safe_load((cfg / "search.yaml").read_text()), "empty search.yaml"
assert (cfg / "evox_search_sys_prompt.txt").stat().st_size > 0, "empty sys prompt"
assert not (pkg / "llm/tool_schemas").exists(), "tool_schemas now ships: agentic mode may work; update the skydiscover skill"
print("evox config ok; agentic still unpackaged")
