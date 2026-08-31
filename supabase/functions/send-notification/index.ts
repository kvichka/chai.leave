// =============================================================================
// send-notification
//
// Email is OPTIONAL. In-app notifications are the product; this function is the
// single, isolated place where email could later be wired to CHAI's mail relay
// without touching the application.
//
// It is off unless app_settings.email_notifications_enabled is true AND a relay
// is configured. With the flag off it does nothing and says so, which is the
// correct behavior until CHAI IT has approved sending leave data by email.
//
// Deploy:  supabase functions deploy send-notification
// Secrets: supabase secrets set MAIL_RELAY_URL=... MAIL_RELAY_TOKEN=... MAIL_FROM=...
// =============================================================================

import { createClient } from 'jsr:@supabase/supabase-js@2'

interface Payload {
  /** notifications.id values to send. */
  notification_ids?: number[]
  /** Or: send everything unsent from the last N minutes. */
  since_minutes?: number
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })

  // Only the platform may invoke this: it reads other people's notifications.
  const auth = req.headers.get('Authorization') ?? ''
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!serviceKey || auth !== `Bearer ${serviceKey}`) {
    return json({ error: 'Unauthorized.' }, 401)
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey, {
    auth: { persistSession: false },
  })

  const { data: settings, error: settingsError } = await db
    .from('app_settings')
    .select('email_notifications_enabled')
    .eq('id', 1)
    .single()
  if (settingsError) return json({ error: settingsError.message }, 500)

  const relayUrl = Deno.env.get('MAIL_RELAY_URL')
  const relayToken = Deno.env.get('MAIL_RELAY_TOKEN')
  const from = Deno.env.get('MAIL_FROM')

  if (!settings.email_notifications_enabled) {
    return json({ sent: 0, skipped: 'email_notifications_enabled is false' })
  }
  if (!relayUrl || !from) {
    return json({ sent: 0, skipped: 'no mail relay configured (MAIL_RELAY_URL, MAIL_FROM)' })
  }

  let payload: Payload = {}
  try {
    payload = (await req.json()) as Payload
  } catch {
    /* an empty body is fine */
  }

  let query = db
    .from('notifications')
    .select('id, title, body, created_at, recipient_id, employees!inner(email, full_name)')
    .order('created_at', { ascending: true })
    .limit(200)

  if (payload.notification_ids?.length) {
    query = query.in('id', payload.notification_ids)
  } else {
    const since = new Date(Date.now() - (payload.since_minutes ?? 15) * 60_000).toISOString()
    query = query.gte('created_at', since).eq('is_read', false)
  }

  const { data: rows, error } = await query
  if (error) return json({ error: error.message }, 500)

  let sent = 0
  const failures: string[] = []

  for (const row of rows ?? []) {
    const employee = (row as unknown as { employees: { email: string; full_name: string } }).employees
    try {
      const response = await fetch(relayUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(relayToken ? { Authorization: `Bearer ${relayToken}` } : {}),
        },
        body: JSON.stringify({
          from,
          to: employee.email,
          subject: `[CHAI Leave] ${row.title}`,
          text: [
            `Hello ${employee.full_name.split(' ')[0]},`,
            '',
            row.title,
            row.body ?? '',
            '',
            'Open the leave app to see the detail.',
            '',
            'This is an automated message. Do not reply.',
          ].join('\n'),
        }),
      })
      if (!response.ok) throw new Error(`relay returned ${response.status}`)
      sent++
    } catch (e) {
      failures.push(`${row.id}: ${(e as Error).message}`)
    }
  }

  return json({ sent, considered: rows?.length ?? 0, failures })
})
