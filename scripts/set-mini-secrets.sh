#!/bin/sh
# 把小程序登录和云托管网关用的密钥写进线上服务器的 .env。在 Mac 终端运行：
#   sh scripts/set-mini-secrets.sh
# 只问两次（输入不显示）。密钥经 ssh 的标准输入传过去，不出现在命令行和服务器的历史记录里。
# 服务器上会先备份 .env，再替换这三项；其它配置不动。写完后需要重启服务才会生效（部署时会重启）。
set -eu
HOST=root@47.116.46.214
DIR=/var/www/agri-monitor
APPID=wxf8a730c56844e54c

ask() {
  printf '%s' "$1" >&2
  stty -echo
  IFS= read -r value
  stty echo
  printf '\n' >&2
  printf '%s' "$value"
}

MINI_SECRET=$(ask '1) 小程序 AppSecret（32 位）：')
case "$MINI_SECRET" in
  *[!0-9a-fA-F]*|'') echo '这不像 AppSecret（应为 32 位 0-9a-f），没有写入。' >&2; exit 1 ;;
esac
[ "${#MINI_SECRET}" -eq 32 ] || { echo "AppSecret 应为 32 位，你输入了 ${#MINI_SECRET} 位，没有写入。" >&2; exit 1; }

GATEWAY=$(ask '2) 云托管网关的 FORWARD_SECRET（还没设过就直接回车，自动生成）：')
GENERATED=0
if [ -z "$GATEWAY" ]; then
  GATEWAY=$(openssl rand -hex 24)
  GENERATED=1
fi
case "$GATEWAY" in
  *[[:space:]]*|*\'*|*\"*) echo 'FORWARD_SECRET 里不能有空格或引号，没有写入。' >&2; exit 1 ;;
esac

printf '%s\n%s\n%s\n' "$APPID" "$MINI_SECRET" "$GATEWAY" | ssh "$HOST" "cd $DIR && sh -c '
  set -eu
  IFS= read -r appid; IFS= read -r secret; IFS= read -r gateway
  cp .env .env.bak-\$(date +%Y%m%d-%H%M%S)
  grep -v -E \"^(WECHAT_MINI_APPID|WECHAT_MINI_SECRET|MINI_GATEWAY_SECRET)=\" .env > .env.tmp || true
  printf \"WECHAT_MINI_APPID=%s\nWECHAT_MINI_SECRET=%s\nMINI_GATEWAY_SECRET=%s\n\" \"\$appid\" \"\$secret\" \"\$gateway\" >> .env.tmp
  chmod 600 .env.tmp
  mv .env.tmp .env
  echo \"服务器 .env 已更新，现有的配置项：\$(cut -d= -f1 .env | grep -v \"^#\" | tr \"\\n\" \" \")\"
'"

if [ "$GENERATED" -eq 1 ]; then
  echo
  echo '已自动生成网关密钥。请到 微信云托管控制台 → 环境 agri-gateway-d0go1d0k14d563146 → 服务 agri-gateway'
  echo '→ 服务设置 → 环境变量，把 FORWARD_SECRET 设为下面这一串（完整复制），然后发布/重启服务：'
  echo
  echo "$GATEWAY"
fi
