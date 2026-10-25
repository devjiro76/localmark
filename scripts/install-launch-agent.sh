#!/usr/bin/env bash
set -euo pipefail
LABEL="com.localmark.sync"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ROOT_DIR="${LOCALMARK_ROOT:-$(cd "${SCRIPT_DIR}/.." && pwd -P)}"
NODE_BIN="${LOCALMARK_NODE:-$(command -v node || true)}"
DATA_DIR="${LOCALMARK_DATA_DIR:-${ROOT_DIR}/data}"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST="${PLIST_DIR}/${LABEL}.plist"
LOG_DIR="${HOME}/Library/Logs/localmark"

if [[ "${1:-}" == "--uninstall" ]]; then
  launchctl bootout "gui/${UID}" "${PLIST}" >/dev/null 2>&1 || true
  rm -f "${PLIST}"
  echo "Uninstalled ${LABEL}"
  exit 0
fi
[[ -x "${NODE_BIN}" ]] || { echo "Node 22 is required" >&2; exit 69; }
mkdir -p "${PLIST_DIR}" "${LOG_DIR}"
chmod 700 "${LOG_DIR}"
xml() { local value="$1"; value="${value//&/&amp;}"; value="${value//</&lt;}"; value="${value//>/&gt;}"; printf '%s' "${value}"; }
TEMP="$(mktemp "${PLIST_DIR}/${LABEL}.XXXXXX.plist")"
trap 'rm -f "${TEMP}"' EXIT
cat > "${TEMP}" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$(xml "${ROOT_DIR}/scripts/run-sync.sh")</string></array>
  <key>WorkingDirectory</key><string>$(xml "${ROOT_DIR}")</string>
  <key>EnvironmentVariables</key><dict>
    <key>LOCALMARK_ROOT</key><string>$(xml "${ROOT_DIR}")</string>
    <key>LOCALMARK_NODE</key><string>$(xml "${NODE_BIN}")</string>
    <key>LOCALMARK_DATA_DIR</key><string>$(xml "${DATA_DIR}")</string>
    <key>PATH</key><string>$(xml "${HOME}/.local/bin:$(dirname "${NODE_BIN}"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin")</string>
  </dict>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>$(xml "${LOG_DIR}/sync.out.log")</string>
  <key>StandardErrorPath</key><string>$(xml "${LOG_DIR}/sync.err.log")</string>
</dict></plist>
PLIST
plutil -lint "${TEMP}" >/dev/null
mv "${TEMP}" "${PLIST}"
trap - EXIT
launchctl bootout "gui/${UID}" "${PLIST}" >/dev/null 2>&1 || true
launchctl bootstrap "gui/${UID}" "${PLIST}"
echo "Installed ${LABEL}; per-platform schedules are checked every 5 minutes"
