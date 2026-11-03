#!/usr/bin/env bash
# dsh-plugin-token-audit — 一键安装（macOS / Linux）
#
#   bash install.sh
#   bash install.sh --uninstall
#
# 环境变量可覆盖：
#   DSH_PNPM=/path/to/pnpm.cjs
#   DSH_NODE=/path/to/node
#   PORT=48921
#   BUDGET=20000000

set -euo pipefail

PKG_NAME="dsh-plugin-token-audit"
PROFILE_DIR="${HOME}/.dsh/profiles/desktop"
PKG_FILE="${PROFILE_DIR}/package.json"
PATCH_FILE="${PROFILE_DIR}/cordis.patch.yml"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-48921}"
BUDGET="${BUDGET:-20000000}"
UNINSTALL=0

for arg in "$@"; do
  case "$arg" in
    --uninstall|-u) UNINSTALL=1 ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

if [ ! -f "$PKG_FILE" ]; then
  echo "找不到 $PKG_FILE —— 请先启动一次 DeepSeek Harness 桌面端。" >&2
  exit 1
fi

# ---------- 定位 DSH 安装目录 ----------
find_dsh_root() {
  local candidates=(
    "/Applications/DeepSeek Harness.app/Contents"
    "/opt/DeepSeek Harness/resources"
    "${HOME}/Applications/DeepSeek Harness.app/Contents"
  )
  for c in "${candidates[@]}"; do
    if [ -d "$c" ]; then echo "$c"; return 0; fi
  done
  return 1
}

DSH_ROOT="$(find_dsh_root || true)"

find_node() {
  if [ -n "${DSH_NODE:-}" ]; then echo "$DSH_NODE"; return 0; fi
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  if [ -n "$DSH_ROOT" ] && [ -x "${DSH_ROOT}/Resources/runtime/bin/node" ]; then
    echo "${DSH_ROOT}/Resources/runtime/bin/node"; return 0
  fi
  return 1
}

find_pnpm() {
  if [ -n "${DSH_PNPM:-}" ]; then echo "$DSH_PNPM"; return 0; fi
  if [ -n "$DSH_ROOT" ]; then
    local p="${DSH_ROOT}/Resources/runtime/primary-runtime/dependencies/pnpm/bin/pnpm.cjs"
    if [ -f "$p" ]; then echo "$p"; return 0; fi
  fi
  if command -v pnpm >/dev/null 2>&1; then command -v pnpm; return 0; fi
  return 1
}

NODE_BIN="$(find_node || true)"
PNPM_JS="$(find_pnpm || true)"

if [ -z "$NODE_BIN" ]; then
  echo "找不到 node，请设置 DSH_NODE=/path/to/node" >&2
  exit 1
fi

# ---------- JSON 编辑（用 node 保证格式正确） ----------
edit_pkg() {
  local mode="$1"   # install | uninstall
  local spec="$2"
  "$NODE_BIN" - "$PKG_FILE" "$PKG_NAME" "$mode" "$spec" <<'NODE'
const fs = require('fs');
const [file, pkg, mode, spec] = process.argv.slice(2);
const json = JSON.parse(fs.readFileSync(file, 'utf8'));
json.dependencies = json.dependencies || {};
if (mode === 'install') json.dependencies[pkg] = spec;
else delete json.dependencies[pkg];

json.dsh = json.dsh || {};
json.dsh.profile = json.dsh.profile || {};
const list = (json.dsh.profile.bundles || []).filter((x) => x !== pkg);
if (mode === 'install') list.push(pkg);
json.dsh.profile.bundles = list;

fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8');
NODE
}

remove_patch_block() {
  if [ -f "$PATCH_FILE" ]; then
    "$NODE_BIN" - "$PATCH_FILE" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const text = fs.readFileSync(file, 'utf8');
const cleaned = text.replace(/# >>> token-audit[\s\S]*?# <<< token-audit\r?\n?/g, '');
fs.writeFileSync(file, cleaned.replace(/\s+$/, '') + '\n', 'utf8');
NODE
  fi
}

run_install() {
  if [ -z "$PNPM_JS" ]; then
    echo "跳过 pnpm install（找不到 pnpm），请手动执行：cd \"$PROFILE_DIR\" && pnpm install"
    return 0
  fi
  ( cd "$PROFILE_DIR" && "$NODE_BIN" "$PNPM_JS" install --reporter=append-only )
}

if [ "$UNINSTALL" = "1" ]; then
  edit_pkg uninstall ""
  remove_patch_block
  run_install || true
  echo "已卸载。重启 DeepSeek Harness 生效。"
  exit 0
fi

SPEC="file:${SRC_DIR}"
mkdir -p "$(dirname "$PATCH_FILE")"
cp "$PKG_FILE" "${PKG_FILE}.bak-$(date +%Y%m%d-%H%M%S)"
[ -f "$PATCH_FILE" ] && cp "$PATCH_FILE" "${PATCH_FILE}.bak-$(date +%Y%m%d-%H%M%S)"

edit_pkg install "$SPEC"
echo "已写入 $PKG_FILE"
run_install

if [ -e "${PROFILE_DIR}/node_modules/${PKG_NAME}" ]; then
  echo "依赖安装成功：${PROFILE_DIR}/node_modules/${PKG_NAME}"
else
  echo "依赖未出现在 node_modules —— 下次启动 DSH 时会补装。"
fi

echo
echo "安装完成。请完全退出 DeepSeek Harness 再重新打开。"
echo "回滚：bash install.sh --uninstall"
