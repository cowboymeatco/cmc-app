'use client'
import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { installNavLog, recordNav } from '@/lib/navLog'

// Renders nothing. Mounted once in the root layout so every page view lands in
// nav_events — see lib/navLog.ts for why this is separate from the feedback
// widget's breadcrumbs.
//
// Deliberately NOT folded into FeedbackButton: page-view logging should not stop
// working the day somebody changes or hides the 💬 button.
export default function NavLogger() {
  useEffect(() => { installNavLog() }, [])

  const pathname = usePathname()
  useEffect(() => { if (pathname) recordNav(pathname) }, [pathname])

  return null
}
