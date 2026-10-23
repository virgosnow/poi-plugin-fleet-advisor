# 海域地图资源

Fleet Advisor 1.0 使用资源索引按需加载地图。项目与发行包不包含以海域编号命名的开发参考大图。

## 随包内容

| 文件 | 用途 |
| --- | --- |
| `index.json` | 37 张海图的坐标、裁切、阶段偏移、连线标签锚点、资源地址与哈希 |
| `map_common.png` | Boss 与出发点图标及插值边缘，约 46 KiB |
| `map_common.json` | 公共图集的原始帧元数据 |
| `map_common.source.json` | 原始与运行文件哈希、保留帧和来源 |
| `SOURCE_LICENSE` | 上游 MIT 许可证；不授予游戏美术权利 |

`.npmignore` 与根 `.gitignore` 限制开发大图进入发行包和仓库。索引的 `image` / `imageEncoding` 标识外部开发参考图，不要求本目录存在同名图片。

## 运行加载

`src/ui/maps/map_loading.js` 请求 `src/host/map_resources.js`，由 `src/infrastructure/cache/map_resource_cache.js` 读取图片缓存、poi 静态资源或索引登记的地址。资源使用前验证 PNG 格式、尺寸和 SHA-256。

缓存位于 `~/.poi-plugin-fleet-advisor/map-cache/`，按资源哈希命名；并发请求合并，磁盘写入使用临时文件和原子替换。保存失败可继续使用内存图片；获取失败保留地图几何和重试入口，不清空编成草稿。

7-2、7-3、7-5 和 5-6 按索引加载阶段增量纹理。显示完整图片不改变推荐阶段，也不表示玩家已经解锁。节点和连线的可达判断始终采用 `data/normal_routes/`。

每条连线的 `labelGeometry` 保存从真实虚线像素提取的地图坐标 `x` / `y`、单位切向 `dx` / `dy`，以及用于引线避障的稀疏中心折线 `path: [[x,y],…]`。折线使用绝对地图坐标，保留实际弯曲并连接虚线间隙，按 2 像素误差简化，不用两节点间的直线代替。它们仅用于概率标签的引线和大图嵌入显示；概率仍按当前编成及所选路径计算。缺少可靠像素时保留普通标签，不猜测真实线条的位置。运行时不解析图片像素。

## 维护工具

开发参考图默认输出到项目旁的 `../map-references/fleet-advisor/`。可用 `FLEET_ADVISOR_MAP_REFERENCES` 或工具支持的 `--reference-dir` 指定项目外目录；工具拒绝写回工程内。

```powershell
# 校验随包公共图集，不依赖外部图片
python tools/data/optimize-map-assets.py --check

# 校验全部外部参考图的文件身份及 RGBA 像素
python tools/data/optimize-map-assets.py --check --reference-dir ../map-references/fleet-advisor

# 从固定来源生成指定海图的坐标、资源索引与外部参考图
python tools/data/import-map-assets.py 7-2 7-3 7-5 --reference-dir ../map-references/fleet-advisor

# 重新提取并核对真实连线的标签锚点；不修改原图或分岐规则
python tools/data/generate-route-label-anchors.py --reference-dir ../map-references/fleet-advisor
python tools/data/generate-route-label-anchors.py --check --reference-dir ../map-references/fleet-advisor
```

下载来源资料需要网络；图片优化和标签几何重建只读取本地参考图，需要 Pillow。5-6 使用 `tools/data/build-5-6.py`，从 `FLEET_ADVISOR_NGA_SOURCE` 指定的项目外 NGA JSON 和分阶段游戏资源生成资料。原始网页与抓取归档不随项目提供。

Node 回归检查索引、阶段覆盖、裁切边界和公共图集文件身份；Python 用构造图片验证无损压缩、路径限制和损坏拒绝。完整外部图片逐像素检查使用上面的显式命令。

## 来源与字节约束

坐标及基础图集主要来自 [KagamiChan/kcs2-mapdata](https://github.com/KagamiChan/kcs2-mapdata)，固定提交 `796a7564eac5de79d32ae0e086a673052ee65ad0`。5-6 的资源地址与哈希记录在索引中。

`map_common.png` 保持原画布和使用帧像素。`map_common.json` 的原始字节参与来源验证，不能重新格式化或改变换行；`.gitattributes` 为它保留字节。完整来源与权利范围见 [THIRD_PARTY.md](../../../THIRD_PARTY.md)。
