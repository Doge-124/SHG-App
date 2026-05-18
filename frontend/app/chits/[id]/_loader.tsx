'use client'
import dynamic from 'next/dynamic'
const ChitDetailPage = dynamic(() => import('./_page'), { ssr: false })
export default function ChitDetailLoader() { return <ChitDetailPage /> }
