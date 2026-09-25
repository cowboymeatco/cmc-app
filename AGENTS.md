<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Time zone: Mountain Time

Cowboy Meat Co runs on Mountain Time (`America/Denver`: MDT, UTC−6, in summer; MST, UTC−7, in winter). When talking to the team, give times, dates and "today" in Mountain Time, not UTC. Timestamps in the database are UTC, so convert them before quoting them. A 1:30 PM UTC feedback note is 7:30 AM MDT. Late-evening Mountain work lands on the next UTC date. In code, use `America/Denver` for anything date- or shift-based, as the rest of the app already does.
