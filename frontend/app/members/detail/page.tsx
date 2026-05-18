// Static route — no dynamic segment, so no generateStaticParams needed.
// The id is passed via ?id= query param.
import MemberDetailPage from '../[id]/_page'

export default function Page() {
  return <MemberDetailPage />
}
