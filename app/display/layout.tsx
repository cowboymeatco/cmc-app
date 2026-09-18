import type { Metadata, Viewport } from 'next'

export const metadata: Metadata = {
  title: 'Cut Room Screens | Cowboy Meat Company',
  description: 'Wall displays for the cutting table, packing kiosk and burger setup',
}

export const viewport: Viewport = {
  themeColor: '#1A0A04',
}

export default function DisplayLayout({ children }: { children: React.ReactNode }) {
  return children
}
