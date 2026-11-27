# 原生 PostgreSQL 與自架帳號驗收

本階段只建立獨立驗收環境。原網站、4398 的教材驗收服務及本機教材庫不切換、不覆寫；PostgreSQL 的舊資料來自先前使用者提供的 RTDB 快照，不能視為切換當日的最新 Firebase 資料。

## 程式入口

- `database.mjs`：node-postgres 連線池；一筆交易固定使用同一個 client，失敗回復後釋放連線，保留既有教材服務介面。
- `deploy/import-prepared.mjs`：檢查所有清單檔 SHA256、表名與欄位，再以單一交易匯入。每批 INSERT RETURNING 與資料庫正規化後的輸入逐欄比較；提交前檢查筆數、延遲外鍵與來源封存。清單雜湊寫入私人搬遷表，相同來源重跑不得重複，清單不同則拒絕。
- `deploy/run-postgres-import.mjs`：只接受名稱以 `_trial` 結尾的獨立資料庫，首次空庫先做失敗回復探測，再匯入與重跑核對。錯誤不輸出學生內容、email 或 SQL detail。
- `serve-postgres.mjs`：原生資料庫登入服務入口，不 seed 固定測試帳號，也沒有 `/test/teacher` 等捷徑；只監聽 localhost，AI 關閉。尚不是正式 HTTPS 發布入口。
- `mail-delivery.mjs`：啟用／重設信先進私人資料表，重啟後可續送。過期或撤回 token 不寄送；失敗有上限，最終撤回 token。已寄送或失效工作清除收件人與連結內容。SMTP 要求 TLS；`private-test` 僅接受 `@example.invalid` 合成信箱，不外寄真實帳號。

## 設定與操作

將連線設定存成網站公開目錄以外、權限 0600 的 JSON；連線可用私人 Unix socket，應用使用非 superuser 的獨立角色。不能把設定檔或資料清單提交 GitHub。

連線設定結構為 `{ "host": "/private/socket/path", "port": 55432, "user": "dedicated_owner", "database": "webavr_legacy_trial" }`。實際路徑由維護者建立，不使用範例值登入。

```sh
node deploy/run-postgres-import.mjs --config /private/database.json \
  --prepared /private/prepared --report /private/import-result.json
```

服務設定包含 `database`（上述連線物件）、`port`、`privateRoot` 與 `mail`。測試寄信可用 `mail: { mode: 'private-test', mailboxDirectory: '/private/mailbox' }`；正式 SMTP 為 `mode: 'smtp'`、`from` 及 `smtp` 連線設定。只有在 SMTP 設定、收信與身分核實通過後，才開放真實帳號啟用。

```sh
WEBAVR_POSTGRES_CONFIG=/private/service.json node serve-postgres.mjs
```

目前 launcher 強制 trial 資料庫與 localhost HTTP；要提供跨裝置 HTTPS，需另行設計受保護驗收入口，不能直接把含測試捷徑的服務公開。

## 驗證

2026-11-25 server 原生 PostgreSQL 16.16 實測：19張表共738,765列匯入；包含73門課、234個場景、366筆待核實帳號、367,693筆來源記錄與同數量封存。清單雜湊與逐批讀回核對通過，注入失敗後資料與run皆回復，重跑跳過而不新增。沒有建立舊帳號密碼、角色、session或班級關係。

另以合成資料庫通過帳號啟用、一次性連結、寄信工作重啟、重設密碼與撤回舊session；完整課程33項HTTP測試全數通過。本機既有完整回歸及建置亦通過。原站171份檔案SHA256全部不變，首頁200。這些是資料庫／HTTP驗證，不能當成實體平板或真實SMTP收信通過。

原生備份還原實測通過：以 pg_dump 自訂格式備份，還原到另一個全新 trial 資料庫，19張搬遷表的筆數與所有列內容摘要一致。此驗證只涵蓋資料庫；媒體檔案仍需連同獨立清冊另外備份。未重開整台server測試啟動，也未做正式切換。

`WEBAVR_TEST_DATABASE_CONFIG=/private/new-synthetic-database.json npm run test:postgres` 只接受全新 `webavr_test_*_trial` 資料庫；測試交易回復、首次啟用、一次性連結、寄信工作重啟、重設後舊密碼與舊 session 失效、未核實身分不寄信及一人多班。

`studio/serve-acceptance-test.mjs` 可透過 `WEBAVR_ACCEPTANCE_POSTGRES_CONFIG` 指向另一個全新合成資料庫，接續執行既有 `studio/run-acceptance-api.mjs` 的33項完整課程資料流程。此啟動器仍只供私人合成測試，不能作為真實登入服務。

## 真實帳號與歷史保留規則

1. 舊密碼與 Firebase token 不匯入。首次使用走 email 設定密碼，權限沿用可核實的對照。
2. RTDB profile 不是 Firebase Authentication 身分證明。需取得 UID、email、emailVerified、disabled 等資料及管理者核准的對照；重複 email、巢狀 profile、無法確認歸屬的帳號維持待核實，不按同名自動合併。
3. 現有資料 API 已要求身分核實與啟用核准。搬遷器不授予角色、不補造班級，不因成功匯入就開放歷史給學生。
4. 每筆來源保留私人封存，去重來源也保留；缺少時間、班級或人物依據的歷史繼續封存。新作答／小結與歷史封存分開，不把無法核實的舊紀錄當成新課堂成績。
5. 文字資料搬遷不代表全部 Storage 檔案已轉存。原媒體、縮圖、圖標與既有教材庫仍保留，媒體全量對帳及教材歸屬核准另列，不重新生成或刪除原圖片。

## 切換前仍需完成

Firebase Auth 身分清單與對照核准、真實管理員建立、真實 SMTP 收信測試、完整媒體與編輯草稿搬遷對帳、最新快照的增量／停寫方案、HTTPS、整體災難復原與裝置驗收。原生 PostgreSQL 試搬成功不能替代上述條件，也不授權切換正式站。

參考：[node-postgres 交易](https://node-postgres.com/features/transactions)、[PostgreSQL 備份與還原](https://www.postgresql.org/docs/16/app-pgdump.html)。
