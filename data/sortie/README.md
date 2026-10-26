# 常规海域数据

本目录提供 Fleet Advisor 1.0 的节点敌情、战斗属性、Boss 血条和地图资源。路线连接及分岐判断由 `../normal_routes/` 定义；敌编成或地图图片不能据此新增出口。

## 文件职责

| 路径 | 内容 |
| --- | --- |
| `encounters/<海域>.json` | 逐节点、阶段和编成模式的敌情，schemaVersion 2 |
| `enemy_catalog.json` | 敌舰 ID、舰种、属性、装备、搭载和制空 |
| `adjudications.json` | 来源差异、待确认项与裁定结果 |
| `maps/` | 地图坐标、图片资源索引和公共图集 |

每图保存来源地址、原文 SHA-256 和必要的定位字段。完整网页与抓取输入存项目外。来源与权利范围见 [THIRD_PARTY.md](../../THIRD_PARTY.md)。

## 敌情结构

顶层字段包括 `area`、`source`、`operationName`、`gauges`、`sortieRequirement`、`remarksRaw`、`bossNodes`、`nodes` 及验证结果。

| 层级／字段 | 含义 |
| --- | --- |
| `source` | 页面、取得信息、原文与敌编成段落哈希、表头 |
| `gauges` | 阶段、原文、击破次数、Boss 点及其依据；`mechanism` 区分击破与到达 |
| `nodes.*.kind` | 水上战、对潜、夜战、航空战、空袭、资源、漩涡、无战斗、能动分歧或航空侦察 |
| `nodes.*.phases` | 默认 `base`，按资料区分 `beforeClear` / `afterClear` |
| `nodes.*.appearanceRates` | 节点级编成出现率；保留清图前后作用域、模式、比例与不确定性 |
| `patterns[].enemyShips` | 舰名、Wiki 目标、回填 API ID 和识别状态 |
| `patterns[].formation` / `formationStatus` | 原表阵形及直读／继承状态 |
| `patterns[].enemyAirPower` / `airSuperiority` / `airSupremacy` | 敌制空与空优、空确线；冲突保留来源值并登记 |
| `patterns[].rowRef` / `sameAsPattern` | 原表行号与模式复用关系 |
| `patterns[].hqLevelRange` / `availability` / `finalForm` | 等级区间、可用阶段和最终形态 |
| `patterns[].escortFleet.enemyShips` | 联合敌舰队的护卫成员 |
| `fuelFraction` / `ammoFraction` | 明确记载的消耗；未知为 `null`，不按零处理 |
| `effect` | 非战斗节点效果及原文 |

模式还可包含经验、制空注释、出现率和陆航半径。血条原文没有点位且全图仅有一个 Boss 时，可从 `bossNodes` 回填，并明确记录回填依据；多 Boss 不作猜测。

## 更新与验证

在配置好项目外来源目录后运行维护工具；输入位置和网络行为以工具配置为准。

```powershell
python tools/data/update-encounters.py 1-5 2-5 5-5 6-5 7-5
python tools/data/update-encounters.py 3-1 3-2
```

流水线依次解析、回填敌舰 ID、交叉核对和生成报告。`--sync-ledger` 只把新差异登记为待裁定，不等于确认其正确。

数据必须满足以下检查：

1. 原表 `~` 按列继承，阵形和三列制空分别处理；标为继承的字段不能为空。
2. 分岐图节点与敌情双向核对；没有路线依据的敌情节点须登记差异。
3. 敌舰 ID 全部完成回填；歧义或未解析舰名不能作为有效输入。
4. 出现率挂在节点级并保留原文阶段，不由出现率推断模式归属。
5. 空优参考为敌制空的 1.5 倍向上取整，空确为 3 倍；冲突保留原值并登记，不静默覆盖。
6. 中文 Wiki 与日文 Wiki 的字段或编成差异逐项进入裁定表。
7. 原表有血条而解析结果为空时失败；击破型与到达型分别记录。

## 缺失值与来源冲突

交叉核对优先比较敌舰 API ID 序列。序列相同且双方共同记载的字段一致，才认定为字段一致；仅名称相同不能视为完整一致。字段、编成和结构差异分别保留双方依据。

没有记载的概率、等级边界和消耗填 `null`。带问号的原文保留在 raw；敌情统计不替代带路规则。`pending` 可留在资料台账中，但不能作为已确认事实。

维护时检查 `validation`、`coverageCheck`、`crossCheck` 和 `apiIdBackfill`，以 JSON 中的现行记录为准，不在文档重复维护疑点数量或修复清单。测试入口见[架构文档](../../docs/ARCHITECTURE.md#开发环境与验证)。
