# 艦隊參謀 / Fleet Advisor

[简体中文](README.md) | [繁體中文](README.zh-TW.md) | [日本語](README.ja-JP.md)

<img src="https://raw.githubusercontent.com/virgosnow/poi-plugin-fleet-advisor/main/docs/images/fleet-advisor-icon.png" alt="艦隊參謀圖示" width="128">

『提督、艦隊の編成と装備は、私にお任せください。』<br>
（提督，艦隊編成和配裝，就交給我吧。）

艦隊參謀是艦隊收藏專用瀏覽器 poi 的編成與配裝外掛。它會根據你持有的艦娘和裝備，為出擊、遠征與演習推薦編成，並協助確認路線、制空、索敵及遠征收益。

作者：[virgosnow](https://github.com/virgosnow)。

## 安裝

在 poi 的外掛管理中安裝並啟用 `poi-plugin-fleet-advisor`，載入遊戲資料後開啟「舰队参谋」。已安裝的外掛可透過 poi 更新。也可參閱 [npm 頁面](https://www.npmjs.com/package/poi-plugin-fleet-advisor)。

## 介面預覽

以下為 poi 中的運行畫面，截圖使用簡體中文介面。

![常規海域工作台：路線地圖、艦隊與配裝](https://raw.githubusercontent.com/virgosnow/poi-plugin-fleet-advisor/main/docs/images/normal-map.png)

<details>
<summary>查看遠征與演習介面</summary>

![遠征工作台：出航條件、大成功機率、淨收益與裝備方案](https://raw.githubusercontent.com/virgosnow/poi-plugin-fleet-advisor/main/docs/images/expedition.png)

![演習工作台：對手艦隊、戰況預測與推薦編成](https://raw.githubusercontent.com/virgosnow/poi-plugin-fleet-advisor/main/docs/images/practice.png)

</details>

## 開始使用

| 頁面 | 功能 |
| --- | --- |
| 目前艦隊 | 查看艦隊、裝備、戰鬥機制和任務進度 |
| 常規海域 | 查看路線與敵情，推薦編成和配裝，確認帶路、制空與索敵 |
| 遠征 | 按成功或大成功目標推薦編成，確認出航條件與淨收益 |
| 演習 | 查看對手艦隊，兼顧戰鬥能力與練級推薦編成 |

1. 選擇海域、遠征或演習對手，依需求指定艦娘和任務。
2. 點擊「一鍵補全」產生方案；之後仍可調整艦娘、裝備和順序。
3. 確認方案條件和頁面提示。

手動保留的裝備會在推薦時保留。出擊推薦預設允許借用其他艦娘的裝備，可在設定中關閉；遠征中艦娘和基地航空隊占用的裝備無法借用。遠征艦隊執行任務時，可以提前規劃下一次編成。

登入後，外掛會在背景同步任務、海域進度、基地航空隊、遊戲預設和遠征狀態；開啟演習頁面後也會同步對手艦隊。操作或網路繁忙時，同步會等待並重試。

在 6-4、6-5 和 7-4，可以規劃基地航空隊的飛機、行動方式和攻擊目標，並參考其對制空與戰況的影響。飛機轉場和補給可能消耗時間及資源。

推薦不保證最佳方案，「待確認」表示資料不足，請核對方案條件和提示。抵達機率不包含戰鬥撤退；制空損耗、演習戰況、遠征大成功機率和交戰遠征修理費用均為參考估算。演習預測使用假設的對手配裝，實際裝備和戰果可能不同；任務歷史進度以遊戲內狀態為準。

## 設定與 AI 接入

設定頁可調整介面語言、艦娘篩選、裝備借用、計算執行緒和快取容量。介面語言支援簡體中文、繁體中文和日文；首次啟動時優先採用 poi 的語言設定，之後可在外掛設定中切換。遊戲原名保持原樣，部分動態規則和診斷說明仍可能顯示原文。清除遊戲資料快取會刪除本機任務進度紀錄。

需要連接 AI 工具時，在設定頁啟用 MCP，並將顯示的網址填入同一台電腦上的 AI 工具；預設網址為 `http://127.0.0.1:47615/mcp`。MCP 提供唯讀查詢、評估與推薦。詳細接入方式請參閱 [MCP API](docs/MCP_API.md)。

**風險提醒**：設定中的「實驗功能」提供自動操作。啟用後可透過模擬點擊遊戲介面，將推薦的艦隊編成和裝備方案套用到遊戲中。此功能預設關閉，僅供開發與測試；自動操作可能違反遊戲規定並使帳號面臨風險，請了解相關風險後謹慎使用。關閉自動操作不影響查詢、推薦、預覽和編輯方案。

## 文件與回饋

- [架構與維護](docs/ARCHITECTURE.md)：計算規則、實作與開發方法。
- [資料來源與同步](docs/DATA_SOURCES.md)：遊戲、poi 和內建資料的來源。
- [MCP API](docs/MCP_API.md)：AI 工具清單、參數和呼叫流程。
- [GitHub Issues](https://github.com/virgosnow/poi-plugin-fleet-advisor/issues)：問題回報與建議。

原始碼採用 [MIT License](LICENSE)，相依套件、遊戲素材與資料來源請參閱[第三方聲明](THIRD_PARTY.md)。
