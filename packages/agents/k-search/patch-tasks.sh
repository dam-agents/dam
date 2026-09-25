#!/bin/sh
# http:k-search's postinstall: K-Search reads KernelBench's tree from inside
# its own, and its problems from that copy rather than Hugging Face.
set -eu
kb="$(mise where http:kernelbench)"
t="$MISE_TOOL_INSTALL_PATH/k_search/tasks"
cp -R "$kb/src" "$kb/scripts" "$kb/KernelBench" "$kb/pyproject.toml" "$t/"
[ ! -f "$kb/uv.lock" ] || cp "$kb/uv.lock" "$t/"
sed -i 's/dataset_src: str = "huggingface"/dataset_src: str = "local"/g' "$t/kernelbench_task.py"
sed -i 's/self.dataset_src = "huggingface"/self.dataset_src = "local"/g' "$t/kernelbench/run_and_check.py"
! grep -nE '(dataset_src: str|self\.dataset_src) = "huggingface"' "$t/kernelbench_task.py" "$t/kernelbench/run_and_check.py"
