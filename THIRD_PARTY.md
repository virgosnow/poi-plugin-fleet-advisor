# 来源、依赖与权利声明

本文说明 Fleet Advisor 1.0 使用的软件依赖、规则数据与游戏素材。来源版本、取得信息和校验值以数据文件、锁文件及随附许可证为准。

## 许可证范围

本项目自有源码采用 MIT License，Copyright (c) 2026 virgosnow，全文见 [LICENSE](LICENSE)。第三方软件保留其许可证和署名。游戏图片、画面识别模板、提取轮廓及第三方文字的原有权利，不因存入本项目而转为本项目的 MIT 授权。

## 软件依赖

| 依赖 | 用途 | 许可与分发方式 |
| --- | --- | --- |
| `pngjs` 7.0.0 | PNG 编解码 | MIT；根锁文件固定版本，插件包保留代码和许可证 |
| React、ReactDOM、Electron | 界面与运行宿主 | 由 poi 提供，不由插件捆绑 |
| Pillow | 开发素材处理与图片测试 | HPND；版本见 `requirements-test.txt`，由 Python 安装包提供许可证，不进入插件包 |

MCP 服务采用 Node.js 内置 HTTP 实现，不捆绑协议 SDK 或客户端适配器。

## 远征资料

远征收益、补给与大成功概率根据日文 Wiki 独立实现，入口为 `src/domain/expeditions/expedition_income.js` 和 `expeditions.js`。数值存在差异时优先采用 Wiki。

| 内容 | 来源 |
| --- | --- |
| 成功条件、大成功条件和参考概率 | [远征：成功・大成功条件](https://wikiwiki.jp/kancolle/遠征#success) |
| 奖励、时长和消耗 | [远征](https://wikiwiki.jp/kancolle/遠征)及详细列表 |
| 大发系、鬼怒改二与改修收益 | [远征：大发动艇相关](https://wikiwiki.jp/kancolle/遠征#daihatsu) |
| 合计属性、装备蓝字、远征改修和飞机搭载补正 | [远征：要求属性时的改修与舰载机](https://wikiwiki.jp/kancolle/遠征#about_stat)；`expedition_stats.js` 独立实现，未确认的飞机贡献使用保守下限 |
| 特大发组合加成 | [特大発動艇](https://wikiwiki.jp/kancolle/特大発動艇) |
| 婚舰补给修正 | [ケッコンカッコカリ](https://wikiwiki.jp/kancolle/ケッコンカッコカリ) |

`tools/data/import-expedition-wiki.py` 解析奖励、装备加成、特大发组合和大成功参考表，保存地址、取得信息及原文 SHA-256。完整 Wiki 原文只存项目外。

普通成功条件与大成功概率分开。概率采用参考表和旗舰等级公式；普通远征不足四舰的数值由 Wiki 四／五舰示例作线性参考，属于估计。基础／改修收益与特大发额外收益分别取整；婚舰补给在基础消耗取整后应用 85% 修正。社区估计不等同游戏官方公布值。

## 海域、攻略与敌情

| 本项目资料 | 来源与记录方式 |
| --- | --- |
| `data/normal_routes/*.json` | [NGA 地图配置2.0](https://bbs.nga.cn/read.php?tid=16820397)整理资料；逐图记录中文 Wiki、NGA 回复地址和哈希 |
| `data/normal_route_guides.json` | [舰娘百科](https://zh.kcwiki.cn/)攻略、NGA 带路和核对后的路径；逐条保留来源 |
| `data/sortie/encounters/*.json` | [日文 Wiki](https://wikiwiki.jp/kancolle/)敌编成及血条，保留中文 Wiki 交叉核对 |
| `data/sortie/enemy_catalog.json` | 敌舰身份、装备与属性资料 |
| `data/sortie/adjudications.json` | 来源冲突、依据和裁定状态 |
| `data/expedition_requirements.json` | 日文 Wiki 远征条件与解锁关系 |

项目分发整理后的程序数据、必要说明、来源地址和哈希，不包含完整论坛回复、原始网页或登录信息。来源原文保持原权利；更新资料须保留来源及尚未解决的差异。

## 地图图片与坐标

主要坐标与公共图集来自 [KagamiChan/kcs2-mapdata](https://github.com/KagamiChan/kcs2-mapdata)，固定提交 `796a7564eac5de79d32ae0e086a673052ee65ad0`。上游 MIT 声明为 Copyright (c) 2018 かがみ，全文保留在 [SOURCE_LICENSE](data/sortie/maps/SOURCE_LICENSE)；游戏美术仍归原权利人。

`data/sortie/maps/index.json` 记录 37 张海图的坐标、裁切、资源路径、阶段偏移、来源地址和 SHA-256。5-6 的分阶段游戏资源单独记录在索引中。运行图片从缓存、poi 或登记地址获取，使用前验证尺寸和哈希。

项目不分发海域开发参考大图。公共 `map_common.png` 只保留 Boss、出发点及必要插值边缘，保持画布尺寸和使用帧像素；来源、原始哈希、运行哈希和保留帧见 `map_common.source.json`。`map_common.json` 的原始字节参与来源校验，不能改变换行或格式。

生成与像素核对使用 `tools/data/import-map-assets.py`、`build-5-6.py` 和 `optimize-map-assets.py`；说明见[地图资源](data/sortie/maps/README.md)。

## 装备、资源与识别图像

| 范围 | 来源与处理 |
| --- | --- |
| `data/icons/t3/` | 游戏装备分类图标切片，图集与帧见 `data/equip_icon_index.json` |
| 机制标签轮廓 | 从游戏装备图标提取，位于 `src/ui/components/mechanism_badges.js`；飞机轮廓包含 AI 辅助重绘 |
| `data/icons/material/` | poi 安装资源中的游戏资源图标，运行时使用随包文件 |
| `data/icons/items/59.png` | [游戏静态资源中的伊良湖图标](https://w16s.kancolle-server.com/kcs2/resources/useitem/card/059.png)，SHA-256：`401e1007a1b16d02e00265a4baa916e8b35a102257b5a67024c712e7f381f49c` |
| 数字与控件 JSON 模板 | 从游戏画面提取，消费者位于 `src/vision/` |
| `tests/fixtures/` | 只保留 `privacy.json` 允许区域的脱敏游戏画面，不分发完整截图 |
| `docs/images/` | 通过 npm 安装的 Fleet Advisor 1.0.0 在 poi 中的实际运行截图，裁去窗口边框，仅保留插件界面 |

这些图像、模板和轮廓不构成游戏美术的独立 MIT 授权。识别使用本地像素模板与游戏状态核对，不捆绑 OCR 引擎。

## 装备适配与蓝字

`data/equipment_rules.json` 保存舰种分类、装备条件和槽位例外；运行时可用时优先采用 poi 选择器表。

蓝字事实来自 [noro6/kc-web](https://github.com/noro6/kc-web) 的 `src/classes/item/ItemBonus.ts` 及对应舰级／国家信息：

| 数据 | 固定来源提交 |
| --- | --- |
| `data/asw_bonuses.json` | `975da86160f35f0fdecb924f0d686630911851da` |
| `data/combat_bonuses.json` | `ac680f36ab2bd6e39dff4fe6b844a4e818882122` |

表内保留数值、改修、数量、搭配条件和输入哈希，不捆绑上游应用或求值器。提取工具为 `tools/data/import-asw-bonuses.js`，独立计算入口为 `src/domain/combat/equipment_bonuses.js`。

33 式换装计算从观测面板扣除原装备素值与蓝字，还原本体，再加入新装备的已确认有效蓝字，普通槽和增设均参与。带路有效性依据[日文 Wiki 索敌装备加成表](https://wikiwiki.jp/kancolle/ルート分岐#equipment_bonus)。SG 初期型、紫雲与 SOC Seagull 按已确认事实处理；SG 后期型等未确认项保留上下界。紫雲与 SOC Seagull 的验证链接分别为[紫雲验证](https://twitter.com/CC_jabberwock/status/1383499343798276096)、[SOC Seagull 验证](https://twitter.com/CC_jabberwock/status/1389570408609767433)，本项目依据 Wiki 收录，不声称直接取得原帖全文。

零式小型水上机及熟练型的蓝字按[ぜかまし的说明](https://zekamashi.net/kancolle-kouryaku/igousensuikan-kakuzyuu/comment-page-1/)计入本体索敌。舰上侦察机通用改修蓝字参考同类规则，并保留 [PL101(侦察)通用／专属表](https://wikiwiki.jp/kancolle/PL101%28%E5%81%B5%E5%AF%9F%29)作为依据；通用蓝字有效不表示所有专属蓝字均有效。舰型、改修档位与叠加条件仍受事实表约束。具体海域门槛和判定顺序采用分岐资料，不由显示系数替代。

## 战斗机制

对地、对空、对潜、夜战和特殊攻击的独立实现位于 `src/domain/combat/`，对地参数还保存在 `data/installation_effects.json`。参考资料：

- [对地攻击](https://wikiwiki.jp/kancolle/対地攻撃)、[对空特殊攻击](https://wikiwiki.jp/kancolle/対空砲火/対空カットイン一覧表)、[对潜攻击](https://wikiwiki.jp/kancolle/対潜攻撃)。
- [伤害与适重](https://wikiwiki.jp/kancolle/戦闘について/与ダメージの算定に関わる要素の考察)、[改修效果](https://wikiwiki.jp/kancolle/改修工廠)、[夜战](https://wikiwiki.jp/kancolle/夜戦)、[甲板人员](https://wikiwiki.jp/kancolle/熟練甲板要員＋航空整備員)。
- 各舰日文 Wiki 特殊攻击章节及[英文 Wiki Special Attacks](https://en.kancollewiki.net/Special_Attacks)。
- 金刚型参考发动率及榛名电探修正依据 [NGA 41784769](https://bbs.nga.cn/read.php?tid=41784769)与第 26 楼；大和三舰齐射按前两舰计算，保留参考性质。模型细节见 `src/domain/combat/special_attacks.js`。

参考攻击力按已实现的固定条件计算，未扣敌甲，不等同最终伤害或胜率。资料不足的条件、系数及发动率保留“待确认”或“参考”标记。
