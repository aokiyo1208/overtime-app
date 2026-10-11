# 残業申請アプリ

Googleアカウントでログインし、残業の申請・打刻、管理者の承認、月次集計、残業代の自動計算を行うWebアプリです。
締めは末日、支払いは翌月25日（土日・休日なら前営業日）です。要件定義書・仕様書に沿って作っています。

| 画面 | 社員 | 管理者 |
| --- | --- | --- |
| ログイン（Google SSO） | ○ | ○ |
| 打刻（残業開始・終了） / 残業申請 / 自分の履歴 | ○ | ○ |
| 承認待ち（承認・却下・一括承認・予定超過の判断・打刻修正依頼） | | ○ |
| 月次集計（残業時間・残業代・36協定の到達率、月次確定、CSV出力） | | ○ |
| 社員別詳細（日別の打刻修正、承認の取消、変更履歴） | | ○ |
| 社員マスタ / 給与マスタ（改定履歴つき） / システム設定・休日 | | ○ |

## 技術構成

Next.js 15（App Router・Server Actions）/ TypeScript / PostgreSQL / Drizzle ORM / Auth.js v5（Google）

## ローカルで動かす

必要なもの：Node.js 22 以上、Docker（PostgreSQL 用）

```bash
npm install
cp .env.example .env     # AUTH_SECRET を `openssl rand -base64 32` で作って入れる
npm run db:up            # PostgreSQL を起動
npm run db:migrate       # テーブルを作成
npm run db:seed          # 設定・祝日・管理者（SEED_ADMIN_EMAIL）とサンプル社員を投入
npm run dev              # http://localhost:3000
```

Googleの設定をする前でも、`.env` の `DEV_LOGIN="true"` で、画面から社員を選んでログインできます
（ローカル専用。`NODE_ENV=production` では常に無効です）。サンプル社員が不要なら `SEED_SAMPLE=false` で投入します。

### Googleログインの設定

1. [Google Cloud Console](https://console.cloud.google.com/) > APIとサービス > 認証情報 > OAuthクライアントID（ウェブアプリ）を作成
2. 承認済みのリダイレクトURIに `http://localhost:3000/api/auth/callback/google` を追加（本番は本番のURLで追加）
3. クライアントIDとシークレットを `.env` の `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` に設定
4. `ALLOWED_DOMAIN` に自社のドメインを設定

ログインできるのは、許可ドメインのGoogleアカウントで、かつ社員マスタに登録済み・在籍中の人だけです。
社員の追加は管理者が「社員」画面で行います。

## テスト

```bash
npm test            # 残業代の計算ロジック（区分・割増・60時間超・支払日）
npm run typecheck
```

計算の例（月給340,000円・時間外32時間のうち深夜2時間 → 84,306円）がテストに入っています。

## 計算ルール（仕様書 3章の要約）

- 時間単価 ＝（基本給＋算入手当）÷ 月平均所定労働時間。月平均所定労働時間 ＝（365 − 年間休日）× 1日の所定労働時間 ÷ 12
- 割増率：時間外 1.25／月60時間超 1.50／法定休日 1.35／深夜（22〜5時）は＋0.25／法定内残業 1.00（設定で1.25）
- 月の判定は申請の対象日で行い、日をまたぐ残業は開始日の月に計上します
- 月合計の残業代で1円未満を四捨五入します（区分ごとには丸めません）
- 週40時間の判定は、通常勤務を記録しないため行いません。所定休日の労働を時間外として扱います

割増率・36協定の上限・所定労働時間・休日は、管理者の「システム設定」で変更できます。
実際の運用の前に、自社の就業規則・36協定に合っているか、社会保険労務士などに確認してください。

## 本番に出すときの注意

- `AUTH_SECRET` と Google の認証情報は、ホスティング側の環境変数に設定します（Gitに入れません）
- `DEV_LOGIN` は本番では設定しません（設定しても無効です）
- DBは日次バックアップを取り、変更履歴（`change_logs`）は5年間保存してください
- 承認・却下のメール通知は、`.env` の `SMTP_*` / `MAIL_FROM` を設定するとSMTPで送信します（Google Workspace の SMTP リレーなどが使えます）。未設定ならログ出力のみで、送信に失敗しても承認処理は止まりません

## ディレクトリ

```
src/app/(member)/   社員の画面（打刻・申請・履歴）
src/app/admin/      管理者の画面
src/lib/overtime.ts 残業の区分と金額の計算（DBに依存しない純粋関数）
src/lib/payroll.ts  DBから月次を集計
src/db/schema.ts    テーブル定義
drizzle/            マイグレーションSQL
scripts/            migrate / seed
```

## Vercel にデプロイする

1. Vercel でこのリポジトリをインポートする（Framework は Next.js。ビルドは `vercel-build` が使われ、マイグレーションと初期データ投入（管理者・設定・祝日）を自動で行います）
2. PostgreSQL（Neon など）を用意し、環境変数を設定する：`DATABASE_URL`（プール接続のURL）、`AUTH_SECRET`、`AUTH_GOOGLE_ID`、`AUTH_GOOGLE_SECRET`、`ALLOWED_DOMAIN`、`SEED_ADMIN_EMAIL`、`SEED_ADMIN_NAME`、`AUTH_TRUST_HOST=true`（必要に応じて `SMTP_*`）
3. Google の OAuth クライアントに、承認済みのリダイレクトURI `https://<本番のドメイン>/api/auth/callback/google` を追加する
4. `DEV_LOGIN` は本番では設定しない
