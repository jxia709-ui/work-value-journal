# 工作价值助手：服务器部署与维护交接

最后更新：2026-08-19

## 1. 当前生产环境

- 生产地址：`https://work.xiaoxiazi.com`
- 服务器：腾讯云轻量应用服务器，上海，4 核 4 GB，3 Mbps，40 GB 系统盘
- 公网 IP：`122.51.0.173`
- 系统用户：项目目录属于 `ubuntu`，日常终端有时会进入 `root`
- 项目目录：`/home/ubuntu/apps/work-value-journal`
- GitHub：`jxia709-ui/work-value-journal`
- 应用容器：`work-value-journal`
- 应用监听：`127.0.0.1:3000 -> 容器 3000`
- HTTPS/反向代理：Caddy 容器 `work-caddy`，使用 host 网络
- Caddy 配置：`/opt/work-caddy/Caddyfile`
- 数据库与登录：Supabase
- ICP 备案号：`蜀ICP备2026047484号-1`

## 2. 已完成事项

1. Docker 和 Docker Compose 已安装并可用。
2. 项目已从 GitHub 拉取到服务器，并使用 Node 22 容器构建。
3. 应用已通过 Docker 常驻运行，并设置 `--restart unless-stopped`。
4. 域名已解析到国内服务器，Caddy 已自动申请并启用 HTTPS 证书。
5. 为解决国内网络访问 Supabase 出现 `Failed to fetch`，已使用同域代理：浏览器请求 `/supabase/*`，由 Caddy 转发至 Supabase。
6. 登录、工作记录、KPI 保存已验证正常。
7. Supabase `public.profiles` 已补充：
   - `role text not null default ''`
   - `kpis jsonb not null default '[]'::jsonb`
8. ICP 备案号已加入全站底部，并链接到 `https://beian.miit.gov.cn/`。

## 3. 标准更新流程

以后发布新代码，优先使用以下流程。不要直接以 root 身份在项目目录执行普通 `git pull`。

### 3.1 拉取代码

```bash
sudo -u ubuntu git -C /home/ubuntu/apps/work-value-journal pull --ff-only
```

### 3.2 构建

```bash
sudo docker run --rm \
  -e SITES_BUILD_TIMEOUT=10m \
  -v "/home/ubuntu/apps/work-value-journal:/app" \
  -v work_value_node_modules:/app/node_modules \
  -w /app \
  node:22-bookworm-slim \
  npm run build
```

必须看到 `Build complete` 后再继续。

### 3.3 重启并检查

```bash
sudo docker restart work-value-journal
sudo docker ps --filter name=work-value-journal
sudo docker logs --tail 30 work-value-journal
```

正常日志应包含：

```text
Production server running at http://0.0.0.0:3000
```

## 4. 今日问题与根因

### 4.1 备案号更新后一直不显示

症状：GitHub 已有新代码，服务器也反复构建和重启，但页面没有备案号。

真正原因：终端当前用户是 `root`，项目目录属于 `ubuntu`。Git 报错：

```text
fatal: detected dubious ownership in repository
```

因此 `git pull` 实际没有执行成功，服务器一直在构建旧代码。解决方法不是继续重启，而是用目录所有者执行 Git：

```bash
sudo -u ubuntu git -C /home/ubuntu/apps/work-value-journal pull --ff-only
```

### 4.2 页面可以打开但登录提示 `Failed to fetch`

这不是账号或密码错误，而是浏览器无法稳定直连 Supabase。最终方案是保留 Supabase 作为数据库和认证服务，通过本站同域 `/supabase/*` 反向代理访问。

### 4.3 日志出现 `SIGTERM`

如果 `SIGTERM` 出现在容器重启前的旧日志中，而最新日志随后显示服务已启动，这是正常重启记录，不代表当前服务故障。

### 4.4 KPI 消失或“添加 KPI”无反应

根因包括数据库缺少 `profiles.kpis`、前端未持久化或容器仍运行旧构建。数据库字段已补齐，现有版本已完成持久化修复。后续先确认代码版本和构建产物，不要直接修改线上数据。

## 5. 故障排查顺序

页面更新未生效时，必须按以下顺序检查，避免无效地反复构建、重启。

```bash
cd /home/ubuntu/apps/work-value-journal

echo "1. 当前提交"
sudo -u ubuntu git log -1 --oneline

echo "2. 工作区状态"
sudo -u ubuntu git status --short

echo "3. 容器状态"
sudo docker ps --filter name=work-value-journal

echo "4. 最新日志"
sudo docker logs --tail 30 work-value-journal

echo "5. 本机应用"
curl -I http://127.0.0.1:3000

echo "6. HTTPS 站点"
curl -I https://work.xiaoxiazi.com
```

如果需要确认某段页面文字是否真正上线，例如备案号：

```bash
grep -R "蜀ICP备2026047484号-1" app dist 2>/dev/null | head
curl -sk https://work.xiaoxiazi.com | grep -o "蜀ICP备2026047484号-1" | head -1
```

## 6. 绝对不要再踩的坑

1. 不要忽略终端红色错误。`git pull`、构建或重启中任意一步失败，都不能假设发布成功。
2. 不要用 root 直接操作属于 ubuntu 的 Git 仓库；统一使用 `sudo -u ubuntu git -C ...`。
3. 不要在没有确认最新提交的情况下反复构建和重启。
4. 不要把 DeepSeek、Supabase 或其他密钥发到聊天截图、GitHub、日志或命令输出中。
5. 不要执行 `cat .env.production`；检查环境变量时只检查变量名是否存在，不输出值。
6. 不要开放应用的 3000 端口到公网；对外只开放 80/443，应用继续绑定 `127.0.0.1:3000`。
7. 当前是 Linux 服务器，不需要开放 Windows 远程桌面端口 3389。
8. 修改 Caddy 配置前先备份并验证，避免 HTTPS 和 Supabase 代理同时中断。
9. 构建成功不等于线上已更新；还必须重启容器并通过 HTTPS 地址验证。
10. `.env.production` 只保留在服务器，不提交 GitHub。

## 7. 安全检查命令

只确认密钥变量存在，不显示密钥内容：

```bash
awk -F= '/^[A-Z0-9_]+=/ {print $1"=已配置"}' /home/ubuntu/apps/work-value-journal/.env.production
```

确认防火墙应保留：

- TCP 80：HTTP/证书验证
- TCP 443：HTTPS
- TCP 22：SSH，建议后续限制来源 IP 或改用密钥

可删除或关闭：

- TCP/UDP 3389：Windows 远程桌面，本机为 Ubuntu，不需要

## 8. 后续建议

1. 建立自动备份：Supabase 数据备份、服务器快照。
2. SSH 22 端口改为密钥登录并限制来源。
3. 为容器增加健康检查和基础监控。
4. 后续所有生产变更先确认 GitHub 提交，再执行“拉取—构建—重启—验证”四步。
