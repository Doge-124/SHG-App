import ChitDetailPage from './_page'

export function generateStaticParams() {
  // Returning a placeholder satisfies the static export requirement.
  // Tauri's SPA fallback serves index.html for any real chit ID.
  return [{ id: '_' }]
}

export default function Page() {
  return <ChitDetailPage />
}
