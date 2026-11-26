#!/bin/bash
# usage: fetch.sh -> vendor/zed: a shallow, sparse checkout of zed-industries/zed at v1.29.2 with
# only the gpui crates and the workspace crates they need. Never run cargo inside vendor/zed: its
# rust-toolchain.toml would make rustup install Zed's toolchain.
set -euo pipefail
D=$(cd "$(dirname "$0")" && pwd)
REV=2de9e435a5d98657f35c260b5f4dd0979df659e6
[[ -d $D/vendor/zed/.git ]] && { echo "vendor/zed exists: $(git -C "$D/vendor/zed" rev-parse HEAD)"; exit 0; }
mkdir -p "$D/vendor" && git init -q "$D/vendor/zed" && cd "$D/vendor/zed"
git remote add origin https://github.com/zed-industries/zed
git config core.sparseCheckout true
cat > .git/info/sparse-checkout <<'LIST'
/Cargo.toml
/Cargo.lock
/LICENSE*
/crates/gpui*/
/crates/bench_metrics/
/crates/collections/
/crates/http_client/
/crates/refineable/
/crates/scheduler/
/crates/sum_tree/
/crates/ztracing/
/crates/ztracing_macro/
/crates/util/
/crates/util_macros/
/crates/perf/
/crates/media/
/crates/zlog/
/crates/reqwest_client/
LIST
git fetch -q --depth 1 --filter=blob:none origin $REV && git checkout -q FETCH_HEAD && git rev-parse HEAD
