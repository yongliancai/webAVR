# GitHub 版本與獨立驗收部署

此版本 v0.7.2 只建立隔離驗收服務，不能用作正式站切換工具。GitHub 的 `next-preview` 分支把新版放在 `next/`，原本根目錄的舊程式仍保留；server 使用固定完整 commit SHA，避免直接追著變動分支更新。

## Server 更新

以部署帳號執行：

```sh
python3 /home/webavr-deploy/webavr-next/current/next/deploy/update-acceptance.py --commit 完整40字元commitSHA
```

首次部署由維護者將此腳本放到部署帳號的私人目錄再執行。腳本會從公開 GitHub 只讀抓取 `next-preview`，核對 commit 屬於分支歷史，在新的 release 目錄安裝依賴、建置，停止**獨立驗收程序**後備份其合成資料，再啟動並檢查健康狀態。失敗時恢復前一版程式與備份的驗收資料。備份不含正式 Firebase 資料庫，不能當成正式備份方案。

固定使用部署帳號家目錄中的 `webavr-next/`：

- `repository/`：GitHub 只讀副本。
- `releases/<commit>/next/`：每個版本獨立程式與依賴。
- `shared/acceptance/`：合成驗收資料，更新程式時不刪除。
- `shared/pm2/`：驗收專用 PM2，不與舊站共用。
- `backups/`：更新前關閉驗收程序後複製的資料。
- `current`：目前健康檢查通過的程式版本。

服務只綁定 `127.0.0.1:4398`，不修改正式 Nginx、DNS 或原站目錄。SSH 通道轉送本機4398到server4398後，以 `http://localhost:4398/test/teacher`、`/test/student` 使用合成帳號；不可直接把測試登入／故障注入路由公開。實體平板與語音權限需要另外建立受保護的 HTTPS 驗收入口，目前此工具不會建立。

驗收環境維持 PGlite 以驗證新版整合，尚不是正式 PostgreSQL／真實帳號遷移。AI 固定關閉；不複製正式站金鑰或本機 `.env.local`。

## 版本政策

每次改動先測試、提交新 commit，再明確選擇該 SHA 更新驗收服務。這不是排程自動拉取，也不會自動更新正式網站。正式部署需另行完成身分、PostgreSQL、郵件、備份還原與完整畫面驗收。完整 SHA 與 `shared/version.json` 可用於辨認實際運行版本。
