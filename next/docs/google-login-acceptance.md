# Google 主登入、email 備用 — 驗收紀錄

使用者已選擇 Google 為主要登入方式，email／密碼保留備用。Google 只負責身分驗證；應用程式 session、帳號對照、教材、班級與歷史仍由自架服務處理。此方案不再是「所有身分驗證完全自架」，但不需要 Firebase Authentication 承接新版的登入。

## 本輪已完成

- `google-login.mjs`：伺服器 OAuth code flow、PKCE S256、十分鐘 state、瀏覽器 cookie 綁定與 nonce，使用 Google 官方套件驗證 ID token，單次消耗 state。只要求 `openid email profile`，不要求離線存取、Gmail 或 Drive。
- 只允許已核准的 Google subject 對應啟用帳號；不按 email 自動認領舊資料，不建立老師／學生角色。尚未核准者只留下私人申請並顯示待核准，沒有教材或歷史存取權。
- callback 的跨站允許只限該 GET 路由，仍必須通過 state、cookie、nonce 與 token 驗證；其他 API 仍拒絕跨站請求。
- `/api/auth/options` 決定是否顯示 Google 按鈕。未設定有效用戶端時只保留 email。順便修正原本登入畫面的合成帳號提示：只有明確啟用 `demoAccounts` 的 demo 才顯示，真實 PostgreSQL 入口預設不顯示。
- 17項合成 OAuth 安全測試、既有完整回歸與建置通過；測試包含錯誤／過期／重用 state、錯誤 cookie／nonce、未驗證 email、同 email 不同 subject、停用帳號及未核實歷史身分的隔離。

## 真實設定與驗收狀態

2026-11-25 經使用者當下同意，已在正確 webAVR 專案建立「webAVR 獨立驗收登入」網頁用戶端。唯一重新導向 URI 為 `http://localhost:4400/api/auth/google/callback`；未增加正式站 URI、JavaScript origins 或額外 Google 資料權限。憑證只存私人設定檔，不提交 GitHub。

已在 Chrome 以使用者本人的 Google 帳號實際完成：Google 身分驗證、未核准時的隔離提示、核准後登入工作室、登出及再次登入。該身分沒有相符的舊 email profile，故經使用者登入驗收授權建立獨立的新帳號並稽核綁定；零角色、零班級、不連結任何舊紀錄。首頁顯示零班級／紀錄屬此新帳號的資料範圍，並非原資料消失。舊366筆 profile 未修改。

設定只放 server 私人服務 JSON：`google: { clientId, clientSecret, redirectUri }`。只啟用4400試驗服務，4398及正式站維持。Google 同意畫面的應用名稱目前仍顯示專案代號，正式上線前需整理品牌資訊及 HTTPS 回呼。

## Firebase 身分對照

2026-11-25 已只讀匯出389筆 UID、email、驗證／停用狀態及供應商資料到server私人目錄，不匯出密碼雜湊，不修改來源。匿名統計：13組重複 email，389筆 emailVerified 均為 false。與366筆舊 profile 對照：3筆有精確 UID 候選、346筆有唯一 email 候選、12筆有多個 email 候選、8筆無 email 候選；兩種候選統計可能重疊，不能相加視為核准數。

全部清單仍待核實，未自動合併、啟用或授權。新版 PostgreSQL 只有先前 RTDB 快照試搬內容；原正式站仍使用 Firebase，完整媒體、六份編輯草稿及最新增量尚待接回。不得宣稱所有資料已搬離 Firebase。

## email 備用寄信

Google 登入本身不需要 SMTP。email 啟用／忘記密碼仍需要 SMTP；可提供寄信服務名稱與既有私人設定檔路徑，由維護者讀取設定。若尚未有服務，先完成 Google 登入，再選寄信服務。密碼、應用程式密碼與用戶端秘密不貼聊天；真實收信驗收需確認使用者自己的測試收件地址。目前仍是只收合成 `.invalid` 地址的私人寄信測試模式，尚未驗證真實收信。已讓「已核准 Google 綁定、啟用且身分已核實」的帳號透過一次性重設連結建立 email 備用密碼；無憑證且無核准綁定或身分未核實者仍不可取得連結。17項合成測試包含建立備用密碼及 email 登入；不能把此結果稱為真實 email 備援已可用。

參考：[Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)、[後端驗證與subject識別](https://developers.google.com/identity/sign-in/web/backend-auth)。
