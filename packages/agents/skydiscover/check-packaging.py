import pathlib
import sys

import skydiscover
import yaml
from skydiscover.optimize.config import SearchConfig

pkg = pathlib.Path(skydiscover.__file__).parent
cfg = pkg / "optimize/search/evox/config"
assert yaml.safe_load((cfg / "search.yaml").read_text()), "empty search.yaml"
assert (cfg / "evox_search_sys_prompt.txt").stat().st_size > 0, "empty sys prompt"
assert (pkg / "optimize/llm/tool_schemas/agentic_tools.json").stat().st_size > 0, "tool_schemas no longer ship: agentic mode breaks; update the skydiscover skill"
assert hasattr(SearchConfig(), "share_llm"), "search.share_llm is gone: EvoX's auxiliary models bypass -m again; update the skydiscover skill"
bindir = pathlib.Path(sys.executable).parent
assert (bindir / "skydiscover").exists(), "no skydiscover console script: the skill's `skydiscover optimize` is gone"
assert not (bindir / "skydiscover-run").exists(), "skydiscover-run is back: update the skydiscover skill"
print("evox config, tool schemas, share_llm and the skydiscover CLI ok")
