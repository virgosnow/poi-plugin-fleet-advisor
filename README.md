# 舰队参谋 / Fleet Advisor

舰队参谋是 poi 的编成与配装插件。它根据你持有的舰娘和装备推荐常规海域、远征方案，并帮助核对路线、制空、索敌和远征收益。

作者：[virgosnow](https://github.com/virgosnow)。

## 安装

在 poi 的插件管理中安装并启用 `poi-plugin-fleet-advisor`，载入游戏数据后打开「舰队参谋」。已有插件可通过 poi 更新。

[npm 页面](https://www.npmjs.com/package/poi-plugin-fleet-advisor)

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

## 开始使用

| 页面 | 可以做什么 |
| --- | --- |
| 当前舰队 | 查看四支舰队、游戏编成预设、装备和战斗机制；此页只读 |
| 常规海域 | 查看路线与敌情，推荐舰娘和装备，核对带路、制空与索敌 |
| 远征 | 按成功或大成功目标推荐编成，核对条件与补给后的净收益 |

1. 在「常规海域」选择海域和路线，或在「远征」选择目标远征。
2. 按需指定舰娘，再点击「一键补全」生成方案。
3. 查看条件是否满足；可以继续换船、换装或拖拽调整顺序。

补全会保留你已指定的舰娘和手动保留的装备。更换海域会清空该页草稿，切换推荐路线会同步更新编成。

远征可选择「成功即可」或「优先大成功」。净收益已经扣除补给消耗，展开明细可查看各项收入与支出。

「相关任务」会显示已同步的可受领和进行中任务，并核对当前编成要求。如果没有任务资料，可以在游戏中打开任务列表同步。

## 应用编成

页面中的调整先保存在草稿里。需要实际换船、换装时，在「设置 → 实验功能」开启「自动操作」，确认方案并选择目标舰队，再点击应用编成。自动操作默认关闭。

运行中可以停止后续操作；已经完成的变更不会回滚。插件支持普通六舰编成，不代为出击、派遣远征或领取任务奖励。

## 设置与 AI 接入

设置页可调整舰娘筛选、推荐路线数量、计算线程和缓存。计算缓慢时可临时开启「性能调试」帮助排查，用完后关闭。

需要连接 AI 工具时，在设置页启用 MCP，将页面显示的地址填入同一台电脑上的 AI 工具；默认地址为 `http://127.0.0.1:47615/mcp`。远程工具不能直接使用这个本机地址。详细接入方式见 [MCP API](docs/MCP_API.md)。

## 使用说明

- 抵达概率只表示带路结果，不包含战斗撤退；制空损耗、攻击力和大成功概率均为参考估算。
- 显示「待确认」表示资料不足，显示参考编成也不代表条件已经满足。应用前请核对页面提示。
- 推荐不保证最优；如果没有找到合适方案，可调整指定舰娘、装备或设置后重试。

## 文档与反馈

- [架构与维护](docs/ARCHITECTURE.md)：配装策略、计算规则、缓存实现、开发与打包方法。
- [MCP API](docs/MCP_API.md)：AI 工具目录、参数和调用流程。
- [GitHub Issues](https://github.com/virgosnow/poi-plugin-fleet-advisor/issues)：问题反馈与建议。

源码采用 [MIT License](LICENSE)，依赖、游戏素材与数据来源见 [第三方声明](THIRD_PARTY.md)。
