# AI收成预测：国内土壤接入

## 已接入现有网站

启动 `node server.js`，登录原网站后从左侧「AI收成预测」进入，或访问 `/?page=harvest`。
原网站沿用原账号和权限；GET `/api/v1/harvest/soil?lat=20.045&lng=110.198` 要求登录。
`harvest-demo.html` 保留用于独立人工示例，国内土壤查询请进入主网站。

## 实际数据来源

- 国家青藏高原科学数据中心，戴永久、上官微《面向陆面模拟的中国土壤数据集》。
- DOI: https://doi.org/10.11888/Soil.tpdc.270281
- 官方详情页: https://data.tpdc.ac.cn/en/data/8ba0a731-5b0b-4e2f-8b95-8b29cc3c0f3a/
- 官方页面提供免登录 FTP 下载；2026-09-07 从页面提供的备用节点 ftp3.tpdc.ac.cn 获取。连接信息从官方页面读取，不写入项目。
- 约1km（30弧秒），土壤背景来源1980年代第二次全国土壤普查，原始8个土层至2.3m。
- 官方数据许可为 **CC BY-NC-SA 4.0**，与 AKILIMO 代码的 MIT 许可不同。当前仅本地 demo；若将数据或衍生结果作商业发布，需要另行确认数据授权。
- 必须引用：Shangguan et al. (2013), A China Dataset of Soil Properties for Land Surface Modeling, doi:10.1002/jame.20026。

## 本版范围

实际接入 AN/AP/AK/PH/BD/SOM 的完整 **0–4.5cm表层格网**，不是完整根区。每个原始nc含8层数据和8层QC，展开约2GB；当前只从官方ZIP的前部流中提取完整第一层，压缩存为独立 surface.nc，6项约46MB。
缺少独立QC层，没有使用其质量等级；已使用原文件 missing_value=-999 掩膜。
ZIP仅下载了前部，无法做整包CRC校验。只在完整第一层字节到齐后原子发布，绝不填零补缺，也不将尚未下载的区域当成已有覆盖。
`*.zip.part` 是原始不完整下载，不能当作完整ZIP解压。查询使用已完成的 `*-surface.nc`。

服务只支持原中国栅格范围内的点；用最近格网单元中心取值，最大半格距离约0.00417°，不向远处寻找有值的替代点。
范围外/水体/缺失值明确返回无数据。后台无国内值时不回落到 SoilGrids 或固定 NPK。

## 单位和试算

- AN/AP/AK原始单位 `ppm of weight` → mg/kg（数值不变）。
- BD原始 `g/cm3` → g/cm³；PH无量纲。
- SOM原始 `% of weight` → g/kg（乘10）。
- 原始浓度与计算用养分供应量分别展示。
- 表层存量 kg/ha = 浓度 mg/kg × 容重 g/cm³ × 厚度 m × 10。
- demo供应量 = 表层存量 × 用户设置的假设利用比例（N默认0.3、P 0.2、K 0.4）。这些比例**不是经验证的农艺转换系数**；只为情景试算，不推断未采样的深层土壤。
- 该估算不是完整根区养分供应。红薯仍使用马铃薯代理参数，产量未做当地标定。
- 天气保留 Open-Meteo ERA5 中国点位历史同期数据；本次「国内数据」接入针对报告中的国内土壤数据。

## 运行与迁移

本地数据位于 `server-data/china-soil/`（沿用被忽略的数据目录，不加入 Git）。迁移现有网站时必须一起拷贝6个 surface.nc 和 manifest.json。现有服务器的 rsync 上传步骤见 [harvest-deploy.md](harvest-deploy.md)。

```sh
python3 -m venv .venv-soil
.venv-soil/bin/python -m pip install -r scripts/requirements-soil.txt
node server.js
```

服务器可用环境变量 `SOIL_PYTHON` 指定已有 Python。没有文件或依赖时接口返回明确错误，其他页面继续工作。

原始数据重新处理（下载后，脚本只需完整第一层压缩流）：

```sh
.venv-soil/bin/python scripts/prepare-china-soil.py --directory server-data/china-soil
.venv-soil/bin/python scripts/china-soil-query.py server-data/china-soil 20.045 110.198
```

## 验证

```sh
node --test tests/harvest-model.test.js tests/china-soil.test.js
.venv-soil/bin/python tests/china-soil-query.test.py
```

覆盖养分转换、单位错误、缺失掩膜、查询范围、零预算、冷害/缺水、面积单位、边界和异常值。
