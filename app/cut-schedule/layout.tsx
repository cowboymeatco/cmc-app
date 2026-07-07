import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Cut Schedule | Cowboy Meat Company',
  description: 'Daily cut schedule for the processing crew',
}

// Paints the phone status bar / browser chrome to match the app when the crew
// bookmarks this page to their home screen.
export const viewport: Viewport = {
  themeColor: '#1A0A04',
}

export default function CutScheduleLayout({ children }: { children: React.ReactNode }) {
  return children
}
