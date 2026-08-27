export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { feedbackSpec } from '@/lib/feedbackTypes'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('feedback')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body.type || !body.description?.trim() || !body.submitter?.trim()) {
    return NextResponse.json({ error: 'type, description and your name are required' }, { status: 400 })
  }
  // Stamp diagnostic context server-side so the client can't forge it and so we
  // always know which code version + browser the report came from.
  const commitSha = process.env.VERCEL_GIT_COMMIT_SHA ?? null
  const userAgent = req.headers.get('user-agent') ?? null

  const { data, error } = await supabase
    .from('feedback')
    .insert([{
      type:           body.type,
      description:    body.description,
      submitter:      body.submitter.trim(),
      page_url:       body.page_url ?? null,
      // diagnostics (see migration add_feedback_diagnostics)
      full_url:       body.full_url ?? null,
      app_context:    body.app_context ?? null,
      viewport:       body.viewport ?? null,
      console_errors: body.console_errors ?? null,
      breadcrumbs:    body.breadcrumbs ?? null,
      commit_sha:     commitSha,
      user_agent:     userAgent,
    }])
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Fire Zapier webhook to alert via MessageDesk — non-blocking, failure doesn't affect the submission
  const webhookUrl = process.env.ZAPIER_FEEDBACK_WEBHOOK
  if (webhookUrl) {
    const who  = body.submitter ? body.submitter : 'Anonymous'
    const page = body.page_url  ? body.page_url  : 'unknown page'
    fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // Label off the shared spec — this said '💡 Idea' for anything that
        // wasn't a bug, which would have relabelled a safety report.
        type:        feedbackSpec(body.type).chip,
        submitter:   who,
        page_url:    page,
        description: body.description,
      }),
    }).catch(() => { /* webhook failure is silent — submission already saved */ })
  }

  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data, error } = await supabase
    .from('feedback')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
