#!/bin/bash
# ============================================================
# 部署脚本 - 将英语学习应用部署到云主机/VPS
#
# 使用方法：
#   1. 修改下方 SERVER_USER / SERVER_IP / REMOTE_PATH
#   2. chmod +x deploy.sh
#   3. ./deploy.sh
#
# 前提：服务器已安装 nginx，且本地能 SSH 到服务器
# ============================================================

# ---- 配置区（改成你自己的）----
SERVER_USER="root"           # SSH 用户名
SERVER_IP="your.server.ip"    # 服务器 IP 或域名
REMOTE_PATH="/var/www/english-app"  # 服务器上存放静态文件的目录
SSH_PORT="22"                # SSH 端口，默认22
# --------------------------------

set -e

echo "=== 1. 本地构建 ==="
npm run build

echo ""
echo "=== 2. 上传 dist/ 到服务器 ==="
# 在服务器上创建目录（如果不存在）
ssh -p $SSH_PORT $SERVER_USER@$SERVER_IP "mkdir -p $REMOTE_PATH"

# 上传 dist/ 内容到服务器（rsync 增量上传，首次较慢后续快）
if command -v rsync &> /dev/null; then
    rsync -avz --delete -e "ssh -p $SSH_PORT" dist/ $SERVER_USER@$SERVER_IP:$REMOTE_PATH/
    echo "rsync 上传完成"
else
    # 没有 rsync 就用 scp
    scp -P $SSH_PORT -r dist/* $SERVER_USER@$SERVER_IP:$REMOTE_PATH/
    echo "scp 上传完成"
fi

echo ""
echo "=== 3. 部署完成 ==="
echo "静态文件已上传到: $SERVER_USER@$SERVER_IP:$REMOTE_PATH"
echo ""
echo "下一步：配置 nginx 指向该目录（见 nginx-english-app.conf）"
echo "配置后执行: ssh -p $SSH_PORT $SERVER_USER@$SERVER_IP 'nginx -s reload'"
echo ""
echo "访问地址: http://$SERVER_IP/"
