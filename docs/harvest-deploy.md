# 部署到现有服务器（含 AI 收成预测）

> 2026-09-24 起服务器已改用 PostgreSQL（提交 `addf920`）。旧版文档里那份 `harvest-deploy-files.txt` 固定文件清单和"tar 恢复 server.js"的回退方式都**不再适用**，会漏传 `lib/`、`providers/`、`node_modules`，回退时还会把线上改回 JSON 版、看不到迁移后的数据。请按下面的步骤操作。

代码通过 Git 保存（`origin/main`）；生产服务器用 rsync 上传到 `root@47.116.46.214:/var/www/agri-monitor/`，然后 PM2 重启。不在服务器上 `git pull`，也不用 `--delete`。

以下命令在 Mac 终端依次执行，某一步失败就先处理错误，不要继续。

## 0. 部署前检查

- 本地代码基于最新的 `main`：`git log --oneline -3` 应能看到 `addf920`（PostgreSQL 迁移）及之后的提交。
- 测试全部通过：`npm test`。数据库集成测试需要设置 `TEST_DATABASE_URL` 才会运行，否则自动跳过。
- 先提交，再部署，这样线上始终对应一个可以回退的提交。

## 1. 记下当前线上对应的提交

```sh
git log --oneline -1
```

把这次部署前线上所对应的提交号记下来，作为回退点。

## 2. 预览并上传代码

先预览，确认只会传你改过的文件：

```sh
cd /Users/woodstock/Documents/agri-monitor
rsync -a --dry-run --itemize-changes --exclude-from=docs/deploy-exclude.txt ./ root@47.116.46.214:/var/www/agri-monitor/
```

确认无误后正式上传（同一条命令去掉 `--dry-run --itemize-changes`）：

```sh
rsync -a --exclude-from=docs/deploy-exclude.txt ./ root@47.116.46.214:/var/www/agri-monitor/
```

`docs/deploy-exclude.txt` 会排除线上数据 `server-data`、数据库密码 `.env`、`.git`、`node_modules`、本机 `.venv-soil`、小程序、文档和测试。**不要**绕开这份排除清单手动上传这些内容。

## 3. 安装依赖、检查、重启

```sh
ssh root@47.116.46.214 'bash -se' <<'REMOTE'
cd /var/www/agri-monitor
npm ci --omit=dev --no-audit --no-fund
node --check server.js
pm2 restart agri-monitor
curl --fail --show-error --retry 5 --retry-connrefused --retry-delay 1 http://127.0.0.1:3000/api/v1/health
REMOTE
```

- 如果 `package.json` 没变，`npm ci` 可以省略，但执行一次也没有坏处。
- 数据库表结构有变化（新增了 `db/migrations/*.sql`）时，服务启动会自动迁移，也可以先手动执行 `node scripts/migrate.js`。
- **不要**在已经 `source .env` 的 shell 里执行 `pm2 restart --update-env`。只有更换数据库密码时才需要这样做，具体见 `WORKER_CHANGELOG.md`。

完成后打开 http://47.116.46.214/?page=harvest ，登录原账号，选一个国内地点，确认能读取土壤并完成试算。

## 4. 土壤数据与 Python 环境（仅在新服务器或数据有更新时）

线上已经准备好 `server-data/china-soil/`（6 个表层文件加 manifest）和 `.venv-soil`，平时部署**不需要**这一步。只有重建服务器或更新土壤数据时才做：

```sh
rsync -avz \
  --include='*-surface.nc' \
  --include='manifest.json' \
  --exclude='*' \
  /Users/woodstock/Documents/agri-monitor/server-data/china-soil/ \
  root@47.116.46.214:/var/www/agri-monitor/server-data/china-soil/

ssh root@47.116.46.214 'bash -se' <<'REMOTE'
cd /var/www/agri-monitor
python3 -m venv .venv-soil
.venv-soil/bin/python -m pip install -r scripts/requirements-soil.txt
node -e 'require("./china-soil").createSoilService().lookup("20.045","110.198").then(r => { if (!r.ok) { console.error(r); process.exit(1); } console.log("China soil query OK"); })'
REMOTE
```

注意：`lookup` 的经纬度参数必须是**字符串**，因为接口从查询参数里拿到的就是字符串。个别格子本身就没有数据（比如 `19.5,109.5` 会返回 `no_data`），检查失败时先换一个点再判断。

## 回退

在一个临时 worktree 里取出第 1 步记下的提交再上传。这样不会碰当前目录里还没提交的改动（比如小程序）：

```sh
cd /Users/woodstock/Documents/agri-monitor
git worktree add /tmp/agri-rollback <回退点提交号>
rsync -a --exclude-from=docs/deploy-exclude.txt /tmp/agri-rollback/ root@47.116.46.214:/var/www/agri-monitor/
ssh root@47.116.46.214 'cd /var/www/agri-monitor && npm ci --omit=dev --no-audit --no-fund && pm2 restart agri-monitor'
git worktree remove /tmp/agri-rollback
```

没有 `--delete` 时，新版本多出来的文件会留在服务器上，但旧代码不会调用它们，不影响运行。

**回退点不能早于 `addf920`**。更早的版本读的是 JSON 文件，迁移后写入 PostgreSQL 的读数、照片和标注在那些版本里都看不到。确实需要退回 JSON 版时，按 `WORKER_CHANGELOG.md` 里"回滚"一节操作，要用到切换前的数据备份。
