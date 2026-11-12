# Fleet Advisor 1.1 工程约定

先读 `README.md`、`docs/ARCHITECTURE.md`、`THIRD_PARTY.md` 和对应功能测试。本文规定工程维护边界；用户当前任务中的明确要求优先。

## 工程与接口

- 包名与宿主标识为 `poi-plugin-fleet-advisor`，中文名「舰队参谋」，英文名 Fleet Advisor。用户数据目录为 `~/.poi-plugin-fleet-advisor/`。
- 使用 CommonJS；React、ReactDOM、Electron 由 poi 提供，不引入第二份 React。
- 规则放在 `domain/`，搜索放在 `recommendation/`，编排放在 `application/`；UI 与 MCP 共用应用服务，界面不直接操作游戏。
- MCP 仅提供本机只读 Streamable HTTP `/mcp`，工具前缀为 `fleet_advisor_`。玩家只填 HTTP 地址，不增加访问令牌或适配器；保留回环监听、Host/Origin 校验和总开关。工具变化后运行 `node tools/dev/generate-mcp-reference.js`。
- README 面向玩家，以中文介绍工具用途；`docs/MCP_API.md` 面向 AI，使用英文并保持参数目录与代码同步。文档描述当前能力和约束，不积累日期式更新记录。

## 推荐与界面

- 支持普通六舰；当前舰队为只读页，常规海域与远征为可编辑工作台，高级选项集中在设置页。
- 常规路线目录保留各阶段全部预设，推荐只计算当前或指定阶段，不限制阶段内路线数量。阶段读取 `info.maps.api_gauge_num`，缺失时按第一阶段规划，不声称已解锁。其他阶段默认折叠，展开只浏览，选中路线后才计算该阶段。出击、远征和演习分别设置装备借用来源；仓库及候选舰队成员装备始终可用，其他舰娘区分未编队和编队中，远征中装备不可借用。基地装备取用尚未支持。手动保留装备有冲突时提示，不覆盖草稿。
- 路线名称须对应实际路径和编成。分岐使用 `data/normal_routes/` 的权威规则；编译工具不得覆盖 `source.authority=nga-16820397`。问号数字按数值参考，未知随机出口按 50% 处理；真正缺失的条件才待确认。敌情不能创造路线连接。
- 换图清空草稿；选路线高亮地图，有推荐时切换路线同步编成；换船自动调装并保留手动槽位。尊重指定舰娘、实例、舰位与装备，特殊攻击重排只能在约束内进行，最终重新核对带路、索敌、制空和可用性。
- 同舰娘的不同实例或形态不能同队，名称匹配复用 `src/shared/name_matching.js`。出击与远征分别应用筛选；修改设置使推荐缓存失效，不清空手动草稿。
- 默认优先空优；路线损耗是保守估算，战力评分不是胜率。有界搜索不保证最优。远征成功条件与大成功概率分开，净收益扣除燃弹补给，收益与概率差异优先采用 Wiki。
- 完整推荐缓存匹配全快照；底层缓存仅存纯计算，库存分配与最终核对每次重做。完整推荐、底层计算、游戏数据和日志统一管理磁盘容量；性能日志仅由后台开发诊断参数控制，不在玩家设置页显示开关。

## 执行与交付

- 默认离线测试，其次只读后台核验。不操作桌面鼠标；没有相应授权时，不执行游戏编成、换装或出击。流量只能被动观察，不能拦截、吞掉、改写或伪造。
- 执行保留预览、实时状态核对、执行锁、幂等与最终核对；不以等级文字识别为前提。应用期间固定现有 UI，只更新进度、计时和停止入口，暂停隐藏页面推导，完成后统一刷新。
- 自动操作默认控件优先、图像兜底，识别方式不在玩家设置页显示，后台调试仍可手动切换为仅图像识别。控件方式只读游戏渲染树，通过原版鼠标事件操作，输入前重新核对控件及实例。控件识别失败时仅在提交已核对、状态一致的边界单向切换一次；通过图像确认安全返回入口后，按原固定实例方案重算剩余步骤，丢弃控件列表上下文并显示切换进度。不明提交、状态变化、歧义和无法识别的恢复入口仍停止。禁止调用游戏处理函数或变更接口；两种方式共用请求和状态守卫，实际操作测试后恢复舰队与装备。
- 后台热更新遵循下方流程，保留草稿与游戏状态。发布 npm 或推送远程仓库需要明确授权。
- 保护已有修改，不执行 `git reset`、`git clean` 或全量覆盖。按目录或文件提交，共享文件整体提交前核对其他任务写入。
- 运行相关回归；完整交付验证 Node、Python、发行包检查与冒烟测试。区分离线通过、加载成功、只读核验和真实操作验收。
- 不提交账号快照、凭据、完整截图、原始网页、缓存、日志、临时文件或 Git 备份。报告写入忽略的 `reports/`，原始资料存项目外。
- 识别素材仅保留 `tests/fixtures/privacy.json` 允许的像素，修改后检查隐私与识别，不降低观察阈值。不删除被引用的工具、数据来源或许可证。

## poi 后台热更新

- poi 启动时需加 `--remote-debugging-port=9222`，例如 `& 'D:\Game\poi\poi.exe' --remote-debugging-port=9222`；路径和端口以现场为准。端口仅供本机访问，与 MCP 端口无关。已运行的 poi 无法通过再次启动补加参数；需要重启时先和用户确认。
- 先完成相关离线测试，确认插件已启用且面板打开，没有自动操作、计算或其他 AI 正在使用调试器。只读检查 `src/host/control_reader.js` 的 `readControlSnapshot`，确认游戏处于 `valid: true`、`scene: 'home'`、`blocked: false`；不能确认时不要更新。
- 用 `curl.exe --noproxy '*' http://127.0.0.1:9222/json/list` 找到 poi 主窗口的 CDP WebSocket（`page` 且 URL 以 `/index.html` 结尾），不要选 `index-plugin.html` 或游戏 `webview`。通过 CDP `Runtime.evaluate` 在主窗口执行 `tools/dev/hot-reload.js` 全文，安装 `window.__hotReload`；可使用 Node.js 22 的内置 `WebSocket` 或现有 CDP 客户端。
- 先调用 `__hotReload({dryRun:true,sourceRoot:"D:/Game/KancolleAI/poi-plugin-fleet-advisor"})`，核对实际源路径、安装路径、`changedFiles` 和 `workbenchDrafts`；确认范围符合本次修改后，调用 `__hotReload({sourceRoot:"D:/Game/KancolleAI/poi-plugin-fleet-advisor"})`。更新器按 `package.json` 的 `files` 清单备份、停用插件、复制并校验文件，再启用插件并恢复草稿；`changedFiles` 仅列出内容不同的文件，清单之外的旧文件不会自动删除。依赖、入口或目录布局变化时使用完整本地安装。
- 更新结果须确认 `ok`、`freshComponent`、`preview`、`draftPreserved`、`gameUnchanged`、`debuggerDetached` 均为 `true`，再做相关只读检查；出错时检查 `rollback` 和备份，勿盲目重试。备份可能含草稿，不提交或公开。不要手动调用 `pluginDidLoad`、覆盖安装目录或执行实际编成；只读检查不等于实机操作验收。
