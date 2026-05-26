import type { Metadata } from 'next'
import './globals.css'
import FeedbackButton from './components/FeedbackButton'

export const metadata: Metadata = {
  title: 'CMC Operations | Cowboy Meat Company',
  description: 'Processing management for Cowboy Meat Company, Forsyth MT',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">
        {children}
        <FeedbackButton />
      </body>
    </html>
  )
}
