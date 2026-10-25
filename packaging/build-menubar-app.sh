#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd -P)"
APP_DIR="${ROOT_DIR}/dist/Localmark.app"
CONTENTS="${APP_DIR}/Contents"
RESOURCES="${CONTENTS}/Resources"
CORE="${RESOURCES}/core"
NODE_BIN="${LOCALMARK_NODE:-$(command -v node || true)}"
command -v swift >/dev/null || { echo "Swift toolchain is required" >&2; exit 69; }
[[ -x "${NODE_BIN}" ]] || { echo "Node 22 is required" >&2; exit 69; }
[[ "$("${NODE_BIN}" -p 'process.versions.node.split(".")[0]')" == "22" ]] || { echo "Node 22 is required" >&2; exit 69; }
NODE_REAL="$("${NODE_BIN}" -p 'process.execPath')"
NODE_PREFIX="$(cd "$(dirname "${NODE_REAL}")/.." && pwd -P)"
swift build -c release --package-path "${ROOT_DIR}/menubar"
rm -rf "${APP_DIR}"
mkdir -p "${CONTENTS}/MacOS" "${CORE}" "${RESOURCES}/node/bin" "${RESOURCES}/node/lib"
cp "${ROOT_DIR}/menubar/.build/release/LocalmarkMenuBar" "${CONTENTS}/MacOS/LocalmarkMenuBar"
cp "${ROOT_DIR}/menubar/Info.plist" "${CONTENTS}/Info.plist"
cp "${NODE_REAL}" "${RESOURCES}/node/bin/node"
if compgen -G "${NODE_PREFIX}/lib/libnode.*.dylib" >/dev/null; then cp "${NODE_PREFIX}"/lib/libnode.*.dylib "${RESOURCES}/node/lib/"; fi
cp -R "${ROOT_DIR}/src" "${ROOT_DIR}/scripts" "${CORE}/"
cp "${ROOT_DIR}/package.json" "${ROOT_DIR}/tsconfig.json" "${CORE}/"
cp -R "${ROOT_DIR}/node_modules" "${CORE}/node_modules"
"${NODE_BIN}" -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({initialDataDirectory:process.argv[2]},null,2)+"\n")' "${RESOURCES}/bundle-config.json" "${ROOT_DIR}/data"
chmod +x "${CORE}/scripts/"*.sh
plutil -lint "${CONTENTS}/Info.plist" >/dev/null
if command -v codesign >/dev/null; then
  codesign --force --sign - --entitlements "${ROOT_DIR}/packaging/node-entitlements.plist" "${RESOURCES}/node/bin/node" >/dev/null
  for library in "${RESOURCES}/node/lib/"*.dylib; do [[ -f "${library}" ]] && codesign --force --sign - "${library}" >/dev/null; done
  codesign --force --sign - "${APP_DIR}" >/dev/null
fi
printf 'Built: %s\nData: %s\n' "${APP_DIR}" "${ROOT_DIR}/data"
