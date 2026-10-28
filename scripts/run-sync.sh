#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="${LOCALMARK_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd -P)}"
NODE_BIN="${LOCALMARK_NODE:-$(command -v node || true)}"
DATA_DIR="${LOCALMARK_DATA_DIR:-${ROOT_DIR}/data}"
[[ -x "${NODE_BIN}" ]] || { echo "Localmark: Node 22 is required" >&2; exit 69; }
export LOCALMARK_ROOT="${ROOT_DIR}" LOCALMARK_NODE="${NODE_BIN}" LOCALMARK_DATA_DIR="${DATA_DIR}"
export PATH="${HOME}/.local/bin:$(dirname "${NODE_BIN}"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
ENABLED="$("${NODE_BIN}" --disable-warning=ExperimentalWarning --import tsx "${ROOT_DIR}/src/cli.ts" settings --data "${DATA_DIR}" | "${NODE_BIN}" -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(String(JSON.parse(s).autoSync)))')"
[[ "${ENABLED}" == "true" ]] || exit 0
cd "${ROOT_DIR}"
"${NODE_BIN}" --disable-warning=ExperimentalWarning --import tsx "${ROOT_DIR}/src/cli.ts" sync --scheduled --data "${DATA_DIR}"
