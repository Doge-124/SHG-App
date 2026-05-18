// Static route — no dynamic segment, so no generateStaticParams needed.
// The id is passed via ?id= query param.
import ChitDetailPage from '../[id]/_page'

export default function Page() {
  return <ChitDetailPage />
}
