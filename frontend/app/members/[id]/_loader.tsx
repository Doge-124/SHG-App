'use client'
import dynamic from 'next/dynamic'
const MemberDetailPage = dynamic(() => import('./_page'), { ssr: false })
export default function MemberDetailLoader() { return <MemberDetailPage /> }
