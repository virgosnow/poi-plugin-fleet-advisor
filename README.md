# 舰队参谋 / Fleet Advisor

**1.0 使用指南**

舰队参谋是 poi 的舰队编成与配装插件，包名为 `poi-plugin-fleet-advisor`。它根据玩家持有的舰娘和装备推荐常规海域、远征编成，并提供当前舰队状态和本地 AI 接口。

作者：[virgosnow](https://github.com/virgosnow)。

## 界面预览

以下为通过 npm 安装的 1.0.0 版本在 poi 中的实际运行画面。

**常规海域**：在地图上查看所选路线、Boss 进度与敌情，在同一工作台核对编成、配装、制空和索敌。

![常规海域工作台：3-5 下路、路线地图与舰队配装](https://raw.githubusercontent.com/virgosnow/poi-plugin-fleet-advisor/main/docs/images/normal-map.png)

<details>
<summary>查看当前舰队与远征界面</summary>

**当前舰队**：查看四支舰队概况，以及各舰的装备、搭载、耐久和战斗机制。

![当前舰队：四支舰队总览、装备和战斗机制](https://raw.githubusercontent.com/virgosnow/poi-plugin-fleet-advisor/main/docs/images/current-fleet.png)

**远征**：核对出航条件、大成功参考概率、收益装备和补给后的净收益。

![远征工作台：出航条件、大成功概率、净收益与装备方案](https://raw.githubusercontent.com/virgosnow/poi-plugin-fleet-advisor/main/docs/images/expedition.png)

</details>

## 功能与使用

| 页面 | 用途 | 操作方式 |
| --- | --- | --- |
| 当前舰队 | 查看四支实际舰队及游戏编成预设的舰娘、装备、搭载数、属性和机制 | 左侧选择舰队或预设，右侧查看详情；页面只读 |
| 常规海域 | 为 37 张常规图（含 5-6）推荐舰娘和装备 | 选择海域与路线，按需放入指定舰娘，再点击一键补全 |
| 远征 | 按大成功或普通成功目标推荐编成 | 选择远征和目标，查看条件、大成功参考概率及补给后净收益 |
| 设置 | 调整筛选、计算、缓存和 MCP | 修改后自动保存；恢复默认保留 MCP 开关和端口 |

常规海域左侧显示路线、节点敌情、Boss 血条、抵达概率和带路条件；右侧显示编成、路线制空和具体节点的索敌门槛。点击地图节点查看附近敌情，放大按钮用于查看详细路线。

已有舰娘会在补全时保留。玩家可以更换舰娘、手动换装、拖拽换位或直接移除；换船会重新推荐装备，手动保留的装备不会被覆盖。更换海域会清空该页草稿；已有推荐后切换路线会同步更新编成。

月度远征会按火力、对空、对潜和索敌缺口自动调装，优先满足出航条件，再利用剩余槽位配置收益装备。运输桶、手动装备及手动空槽优先保留。换装后的属性重新核算本体、装备蓝字和远征改修补正；飞机资料不完整时按可确认的保守下限核对，数值前以“≥”标明。

第一轮调装未达标时，会再按裸装属性与可用装备槽位筛选备用舰娘，避免只因当前配装较弱而漏选。额外大成功运输桶挤占必要属性装备时，优先退回能满足出航条件的桶数；手动指定的装备不变。

远征没有找到达标方案时，会在有可用候选的情况下显示最接近的参考编成，并在左侧列出未满足的条件及数值差额。参考编成不代表可以成功远征；请调整至条件达标。有界搜索没有找到方案也不等于持有舰娘和装备一定不足。

界面调整只改变草稿。选择目标舰队并点击“应用编成”后，插件才修改游戏舰队和装备。运行中可停止后续操作，已完成的变更不会自动回滚。插件支持普通六舰编成，不提供出击、派遣远征或战斗操作。

远征条件未达标，或常规海域确定无法按所选路线抵达 Boss 时，应用按钮以警告色和文字提醒，仍可主动应用当前参考编成并自行调整；未知条件或非零随机概率不会当作不可达。

## 安装与运行

在 poi 的插件安装流程中安装 `poi-plugin-fleet-advisor` 插件包。使用本地发行包时，选择构建得到的 `.tgz` 文件。React、ReactDOM 和 Electron 由 poi 宿主提供。

插件数据保存在 `~/.poi-plugin-fleet-advisor/`，运行日志位于安装目录的 `logs/`。首次查看海域地图需要已有图片缓存或可用网络；资源加载失败不会清空草稿。

## 筛选、计算与缓存

出击与远征分别保存筛选条件。出击默认使用 30 级以上、已改造且可用的舰娘，并排除未锁定、大破和疲劳等状态；远征默认不限等级和改造，但排除远征中、入渠中、未锁定和第一舰队的舰娘。明确手动选入的舰娘可覆盖自动偏好，实际可用性和装备合法性仍会核对。

常规海域默认最多推荐 5 条路线，可调整为 1–20 条。多阶段海域每阶段至少保留一条，其余名额优先用于当前阶段。常规与远征分别设置计算线程，自动模式按本机可用资源选择线程数。

| 缓存 | 内容 | 使用边界 |
| --- | --- | --- |
| 完整推荐缓存 | 相同快照和参数下的推荐结果 | 舰娘、装备或设置变化后重新计算 |
| 底层计算缓存 | 依赖明确的装备适配、带路等纯计算 | 可跨海域、跨快照复用；实例分配和最终核对仍重新执行 |
| 编成方案缓存 | AI 计算时临时保存的完整方案 | 不是长期预设；关闭后不能保存，已有方案仍可查询和删除 |

三类缓存共用一个磁盘容量上限，各有独立开关，可单独清理或全部清理。缓存清理不修改游戏舰队与游戏编成预设。

## AI 工具接入（MCP）

poi 运行并载入游戏数据后，在设置页启用 MCP，将显示的 HTTP 地址填入 AI 工具。默认地址为 `http://127.0.0.1:47615/mcp`，传输方式为 Streamable HTTP，只需地址，无需认证请求头或适配器。修改端口后需同步更新客户端地址。

服务仅监听 `127.0.0.1`，检查 Host 并拒绝带浏览器 Origin 的请求。远程电脑或云端工具不能通过自己的本机地址访问玩家的 poi。

以下 26 个工具共用页面的查询、推荐与执行服务。查询、评估、推荐和预览不修改游戏；实际编成需要先预览，再执行计划。

| 函数 | 用途 |
| --- | --- |
| `fleet_advisor_get_status` | 查看数据是否就绪、接口开关、编成方案缓存开关和当前执行任务。 |
| `fleet_advisor_get_contract` | 查询编成 JSON 格式、参数约定、调用流程和限制。 |
| `fleet_advisor_create_snapshot` | 将 poi 已获取的账号数据建立为只读快照，供后续查询和推荐使用。 |
| `fleet_advisor_query_fleets` | 查看四支实际舰队的成员、远征、补给、损伤和疲劳等状态。 |
| `fleet_advisor_query_fleet_presets` | 查看游戏中的编成预设及其同步状态。 |
| `fleet_advisor_query_fleet_status` | 查看实际舰队、游戏预设或候选方案的装备、机制标签、制空、索敌等详情。 |
| `fleet_advisor_query_ships` | 按名称、舰种、舰队等条件筛选舰娘，支持排序和分页。 |
| `fleet_advisor_query_equipment` | 查询持有装备实例、所在位置、属性、改修和熟练度。 |
| `fleet_advisor_query_equipment_options` | 查看某个装备槽可换用的装备，合并相同效果的实例并标出当前装备。 |
| `fleet_advisor_save_scheme` | 将完整编成方案写入临时缓存，不修改游戏舰队。 |
| `fleet_advisor_query_schemes` | 按名称查询临时缓存中的编成方案。 |
| `fleet_advisor_delete_scheme` | 删除临时缓存中的编成方案，不删除游戏预设。 |
| `fleet_advisor_evaluate_fleet` | 核对候选编成、舰娘和装备可用性，并评估制空、索敌、速力和先制对潜。 |
| `fleet_advisor_query_expeditions` | 查询远征条件、时间、奖励、解锁与运行状态。 |
| `fleet_advisor_evaluate_expedition` | 检查舰队是否满足远征条件，估算大成功概率及补给后的净收益。 |
| `fleet_advisor_recommend_expedition_fleet` | 按成功或大成功目标推荐远征舰娘与装备。 |
| `fleet_advisor_recommend_expedition_equipment` | 保留指定舰娘及顺序，只调整远征配装。 |
| `fleet_advisor_query_normal_maps` | 查看支持的常规海域、带路规则和基础资料。 |
| `fleet_advisor_query_normal_map` | 查看某张海图的推荐路线、节点敌情、Boss 进度和主要威胁。 |
| `fleet_advisor_evaluate_normal_route` | 检查候选编成的带路条件、抵达概率、节点索敌门槛及路线制空。 |
| `fleet_advisor_recommend_normal_fleet` | 为常规海域或指定路线推荐舰娘和装备，遵守筛选与手动保留条件。 |
| `fleet_advisor_recommend_normal_equipment` | 保留指定舰娘及顺序，只调整常规海域配装并核对路线。 |
| `fleet_advisor_preview_fleet` | 预览应用编成后的舰娘、装备和借装变更，生成可执行计划。 |
| `fleet_advisor_execute_plan` | 执行已预览的计划，实际调整游戏舰队与装备。 |
| `fleet_advisor_get_job` | 查询执行进度、结果、最终核对和是否存在部分完成的变更。 |
| `fleet_advisor_cancel_job` | 停止后续自动操作；已完成的游戏变更不会回滚。 |

完整英文参数、结果和调用流程见 [MCP API](docs/MCP_API.md)。

## 开发与验证

开发需要 Node.js 20 或更新版本。Python 3.10 及 Pillow 用于数据工具和图片回归，插件运行不需要 Python。

```powershell
npm ci --ignore-scripts
python -m pip install -r requirements-test.txt
npm test
python -m unittest discover -s tests/python -p 'test_*.py'

New-Item -ItemType Directory -Force dist | Out-Null
$packageName = npm pack --ignore-scripts --pack-destination dist | Select-Object -Last 1
node tools/package/check_package.js "dist/$packageName"
node tools/package/smoke_package.js "dist/$packageName"
```

Node 入口递归执行规则、推荐、执行、UI、缓存、MCP 和隐私测试。发行包检查验证文件范围；冒烟测试在禁止网络的独立目录中验证 Worker、缓存和识别。后台热更新入口是 `tools/dev/hot-reload.js`；依赖、入口或目录布局变化时使用完整本地安装。

源码测试、发行包加载、poi 只读核验和实际游戏操作是不同的验证范围。发布 npm 和推送仓库均需单独授权。

## 工程与数据

| 路径 | 内容 |
| --- | --- |
| `index.js` | poi 生命周期与服务装配 |
| `src/application/` | 快照、查询、预览和任务编排 |
| `src/domain/` | 舰队、战斗、带路及远征规则 |
| `src/recommendation/` | 候选生成、配装、评分和搜索 |
| `src/execution/`、`src/host/`、`src/vision/` | 游戏操作、宿主适配和图像识别 |
| `src/infrastructure/` | 缓存、存储和线程 |
| `src/config/`、`src/shared/` | 设置与共用函数 |
| `src/ui/`、`src/bridge/` | 界面和本地 MCP |
| `data/` | 整理后的规则、敌情、模板和必要图片 |
| `tests/`、`tools/` | 回归测试与分类维护工具 |

详细边界见 [架构与维护](docs/ARCHITECTURE.md)。海域资料格式见 [出击数据](data/sortie/README.md)，地图资源见 [地图资源](data/sortie/maps/README.md)，图片隐私规则见 [测试素材](tests/fixtures/README.md)。

常规图分岐以 NGA 整理资料为主，逐图保存来源与哈希；攻略流派保存在 `data/normal_route_guides.json`。远征收益、补给与大成功概率依据日文 Wiki 独立实现，差异优先使用 Wiki。维护命令：

```powershell
python tools/data/import-expedition-wiki.py --source-dir <项目外目录> --fetch --write
```

不传 `--write` 时仅查看差异。导入更新奖励、基础等级／舰数／合计属性和大成功参数；舰种组合与解锁关系按 Wiki 单独维护。原始网页、账号快照、缓存和临时文件不进入仓库。

推荐采用有界搜索，不保证全局最优。抵达概率不包含战斗撤退，制空损耗和攻击力为参考估算。索敌判断使用所选路线具体节点的系数；不确定条件保留待确认。

源码许可证见 [LICENSE](LICENSE)，依赖、游戏素材与数据权利范围见 [第三方来源](THIRD_PARTY.md)。

仓库：[virgosnow/poi-plugin-fleet-advisor](https://github.com/virgosnow/poi-plugin-fleet-advisor) · 反馈：[GitHub Issues](https://github.com/virgosnow/poi-plugin-fleet-advisor/issues)
