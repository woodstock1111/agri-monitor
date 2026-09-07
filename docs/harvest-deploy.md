# AI收成预测：部署到现有服务器

代码通过 Git 保存；生产服务器沿用 rsync 上传到 `root@47.116.46.214:/var/www/agri-monitor/`，然后 PM2 重启，不使用服务器 Git 拉取，也不使用 `--delete`。

以下命令在 Mac 的终端中依次执行；某一步失败时先处理错误，再继续下一步。

## 1. 备份即将替换的现有入口

```sh
ssh root@47.116.46.214 'mkdir -p /var/backups/agri-monitor && tar -czf /var/backups/agri-monitor/before-harvest-$(date +%Y%m%d-%H%M%S).tgz -C /var/www/agri-monitor app.js index.html server.js'
```

## 2. 上传本次功能代码

```sh
rsync -avz \
  --files-from=/Users/woodstock/Documents/agri-monitor/docs/harvest-deploy-files.txt \
  /Users/woodstock/Documents/agri-monitor/ \
  root@47.116.46.214:/var/www/agri-monitor/
```

文件清单包含现有网站入口、预测页面及模型、土壤接口、必需的 Python 查询脚本和依赖清单。其余文件不参与本次上传，包括 `.git`、`.env`、本机 `.venv-soil`、小程序改动和服务器运行数据。`scripts/china-soil-query.py` 是运行必需文件，不能继续把整个 `scripts` 目录排除。

## 3. 单独上传土壤数据

```sh
rsync -avz \
  --include='*-surface.nc' \
  --include='manifest.json' \
  --exclude='*' \
  /Users/woodstock/Documents/agri-monitor/server-data/china-soil/ \
  root@47.116.46.214:/var/www/agri-monitor/server-data/china-soil/
```

只同步6个已完成的表层数据文件和清单，约47 MB。不会上传不完整的 `*.zip.part`，也不会覆盖服务器的账号、设备和历史数据 `server-data/app-state.json`。土壤文件被 Git 忽略，因此只推代码不足以启用国内土壤查询。

## 4. 安装服务器依赖、检查数据，再重启

服务器需要 Python 3.9 或更新版本，并支持 `venv`。必须在 Linux 服务器创建环境，不能上传 Mac 的虚拟环境。

```sh
ssh root@47.116.46.214 'bash -se' <<'REMOTE'
cd /var/www/agri-monitor
python3 -m venv .venv-soil
.venv-soil/bin/python -m pip install -r scripts/requirements-soil.txt
node -e 'require("./china-soil").createSoilService().lookup("20.045","110.198").then(result => { if (!result.ok) { console.error(result); process.exit(1); } console.log("China soil query OK"); })'
node --check server.js
pm2 restart agri-monitor
curl --fail --show-error --retry 5 --retry-connrefused --retry-delay 1 http://127.0.0.1:3000/api/v1/health
REMOTE
```

成功时应看到 `China soil query OK` 和 `{"ok":true}`。如果提示缺少 `venv`，在 Ubuntu/Debian 上先安装 `python3-venv`，再重试本步；如系统 Python 低于3.9，应先准备合适的 Python 版本。

完成后打开 http://47.116.46.214/?page=harvest ，登录原账号，选一个国内地点，确认能读取土壤并完成试算。页面登录不需要创建新账号。健康接口只能确认服务存活，登录后的页面操作用于确认完整功能。

## 回退入口

若上线后原网站入口出现问题，在服务器用第1步生成的实际备份文件名执行 `tar -xzf /var/backups/agri-monitor/实际备份文件名.tgz -C /var/www/agri-monitor`，然后 `pm2 restart agri-monitor`。新加的数据和独立文件可以保留，旧入口不会调用它们。
