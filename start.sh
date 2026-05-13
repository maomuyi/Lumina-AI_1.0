#!/usr/bin/env bash
# Lumina 一键启动 - backend(3001) + frontend(3000)
# 默认走"本地规则引擎"模式，不需要任何 API key
set -e
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# 1. 选包管理器
if command -v pnpm >/dev/null 2>&1; then PM=pnpm
elif command -v npm  >/dev/null 2>&1; then PM=npm
else echo "❌ 未找到 pnpm 或 npm"; exit 1
fi
echo "📦 使用 $PM"

# 2. 模式提示
read_env_value() {
  grep -E "^$1=" "$ROOT/backend/.env" 2>/dev/null | head -n 1 | cut -d= -f2- | tr -d ' "'
}

is_configured_key() {
  local value="$1"
  [ -n "$value" ] &&
    [ "$value" != "__PUT_YOUR_OPENAI_KEY_HERE__" ] &&
    [ "$value" != "sk-your-key-here" ] &&
    [ "$value" != "your-text-api-key-here" ] &&
    [ "$value" != "your-vision-api-key-here" ] &&
    [ "$value" != "your-deepseek-api-key-here" ] &&
    [ "$value" != "your-openai-vision-api-key-here" ]
}

mask_key() {
  local value="$1"
  local length=${#value}
  if [ "$length" -le 10 ]; then
    echo "***"
  else
    echo "${value:0:6}...${value: -4}"
  fi
}

TEXT_KEY=$(read_env_value "TEXT_API_KEY")
VISION_KEY=$(read_env_value "VISION_API_KEY")

if is_configured_key "$TEXT_KEY"; then
  echo "💬 Text：远程文本模型（TEXT_API_KEY=$(mask_key "$TEXT_KEY")）"
else
  echo "💬 Text：本地规则引擎（未配置 TEXT_API_KEY，Chat/微调走本地）"
fi

if is_configured_key "$VISION_KEY"; then
  echo "👁️ Vision：远程识图模型（VISION_API_KEY=$(mask_key "$VISION_KEY")）"
else
  echo "👁️ Vision：本地规则引擎（未配置 VISION_API_KEY，首轮识图走本地）"
fi

# 3. 安装依赖
[ -d "$ROOT/backend/node_modules" ]  || (cd "$ROOT/backend"  && $PM install)
[ -d "$ROOT/frontend/node_modules" ] || (cd "$ROOT/frontend" && $PM install)

# 4. 编译 backend
[ -d "$ROOT/backend/dist" ] || (cd "$ROOT/backend" && $PM run build)

# 5. 清理旧进程
lsof -ti :3001 2>/dev/null | xargs kill -9 2>/dev/null || true
lsof -ti :3000 2>/dev/null | xargs kill -9 2>/dev/null || true

# 6. 起 backend
echo "🚀 启动 backend (port 3001)..."
( cd "$ROOT/backend" && node dist/index.js > "$ROOT/backend.log" 2>&1 ) &
BE_PID=$!

# 7. 等 backend 就绪
for i in $(seq 1 20); do
  curl -s -m 1 http://127.0.0.1:3001/health >/dev/null 2>&1 && { echo "✅ backend 就绪"; break; }
  sleep 0.5
done
if ! curl -s -m 1 http://127.0.0.1:3001/health >/dev/null 2>&1; then
  echo "❌ backend 启动失败"; tail -30 "$ROOT/backend.log"; kill -9 $BE_PID 2>/dev/null; exit 1
fi

# 8. 起 frontend
echo ""
echo "════════════════════════════════════════════════"
echo " 🎨 Lumina 已启动"
echo " ▶ 本地访问：    http://localhost:3000"
echo " ▶ 想给同事看？ 另开终端运行："
echo "    cloudflared tunnel --url http://localhost:3000"
echo "    (没装 cloudflared: brew install cloudflared)"
echo " ▶ Ctrl+C 同时停止前后端"
echo "════════════════════════════════════════════════"
echo ""

trap "echo '关闭中...'; kill -9 $BE_PID 2>/dev/null; lsof -ti :3001 :3000 2>/dev/null | xargs kill -9 2>/dev/null; exit 0" INT TERM

cd "$ROOT/frontend" && $PM run dev
