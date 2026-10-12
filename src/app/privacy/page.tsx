export const metadata = { title: "プライバシーポリシー" };

export default function PrivacyPage() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px", lineHeight: 1.8 }}>
      <h1 style={{ fontSize: 24, marginBottom: 16 }}>プライバシーポリシー（残業申請）</h1>
      <p>株式会社KENZO（以下「当社」）は、社内向けの残業申請システム（以下「本システム」）で取り扱う情報について、次のとおり定めます。</p>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>1. 取得する情報</h2>
      <p>Googleアカウントでのログイン時に、氏名とメールアドレスを取得します。あわせて、利用者が入力した残業の申請内容、打刻の時刻、承認の記録を保存します。</p>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>2. 利用目的</h2>
      <p>ログイン本人の確認、残業の申請・承認・打刻の管理、および残業代の計算と支払いの管理のためだけに利用します。</p>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>3. 第三者への提供</h2>
      <p>法令に基づく場合を除き、取得した情報を第三者に提供しません。本システムの運用のため、クラウド事業者（Vercel、Neon）のサービス上で情報を保管します。</p>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>4. Googleのユーザーデータの扱い</h2>
      <p>本システムはGoogleアカウントの氏名とメールアドレスのみを利用し、Googleの他のデータ（メール、ドライブ、カレンダー等）にはアクセスしません。</p>

      <h2 style={{ fontSize: 18, marginTop: 28 }}>5. お問い合わせ</h2>
      <p>本システムに関するお問い合わせは、管理者（aokiyo1208@gmail.com）までご連絡ください。</p>
    </main>
  );
}
