import Link from 'next/link'
import {
  BookOpen, Boxes, Inbox, Sparkles, KeyRound, Clock, LayoutGrid, TriangleAlert,
  Rocket, Map, Plug, ShieldCheck,
} from 'lucide-react'
import { requireAdmin } from '@/lib/auth'
import { ENRICHMENT_KINDS } from '../enrichment/kinds'
import { createServiceClient } from '@/lib/supabase/server'
import { corpusMeta } from '@/lib/kb/ask'
import { AppSwitcher } from './app-switcher'
import { AskPanel, type SavedAnswer } from './ask-panel'

export const dynamic = 'force-dynamic'

/**
 * Engineering reference for how Salty works, split by codebase via the ?app= switcher.
 *
 * Deliberately STATIC prose rather than live queries: this is the document you read when something
 * is broken, and a knowledge base that itself depends on a healthy database is useless exactly when
 * you need it. The one exception is ENRICHMENT_KINDS, imported from the constant the pipeline uses,
 * so that list cannot silently go stale.
 *
 * Grounded in the running system (prod project lzhrntjwnmrpwebmqyha) and the repos' own planning
 * docs. When you change one of these mechanisms, change the matching section.
 */

type AppKey = 'mobile' | 'admin'

interface PageProps {
  searchParams: Promise<{ app?: string }>
}

// ── shared presentation ──────────────────────────────────────────────────────

function Section({ id, title, icon: Icon, sub, children }: {
  id: string; title: string; icon: React.ElementType; sub?: string; children: React.ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-6 overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
      <div className="border-b border-salty-border px-5 py-3.5">
        <h2 className="flex items-center gap-2 font-sora text-[15px] font-bold text-salty-text">
          <Icon className="h-4 w-4 text-ember" /> {title}
        </h2>
        {sub && <p className="mt-0.5 text-[12px] text-salty-muted">{sub}</p>}
      </div>
      <div className="space-y-4 px-5 py-4 text-[13px] leading-relaxed text-salty-secondary">{children}</div>
    </section>
  )
}

const Code = ({ children }: { children: React.ReactNode }) => (
  <code className="rounded bg-cream px-1 py-0.5 font-mono text-[11.5px] text-salty-text">{children}</code>
)

function Rule({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-salty-border bg-cream/40 p-3.5">
      <p className="mb-1 font-sora text-[12.5px] font-bold text-salty-text">{title}</p>
      <p className="text-[12.5px] text-salty-secondary">{children}</p>
    </div>
  )
}

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-[10px] border border-salty-border">
      <table className="w-full">
        <thead>
          <tr className="border-b border-salty-border bg-cream">
            {head.map((h) => (
              <th key={h} className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-salty-border last:border-0">
              {r.map((c, j) => (
                <td key={j} className="px-3 py-2 align-top text-[12.5px] text-salty-secondary">{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const STATE_TONE: Record<string, string> = {
  Shipped: 'bg-[#E3F1E8] text-[#3E8A5A]',
  Built: 'bg-[#E3F1E8] text-[#3E8A5A]',
  Partial: 'bg-[#FBF1DE] text-[#8A6830]',
  Inert: 'bg-[#FBF1DE] text-[#8A6830]',
  Scoped: 'bg-[#EEF1F8] text-[#5B6190]',
  Planned: 'bg-[#EEF1F8] text-[#5B6190]',
  Blocked: 'bg-[#F7E4E1] text-[#BF4A3A]',
}

const State = ({ v }: { v: keyof typeof STATE_TONE | string }) => (
  <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATE_TONE[v] ?? 'bg-cream text-salty-secondary'}`}>{v}</span>
)

// ── navigation ───────────────────────────────────────────────────────────────

const NAV: Record<AppKey, { id: string; label: string; icon: React.ElementType }[]> = {
  mobile: [
    { id: 'ask', label: 'Ask AI', icon: Sparkles },
    { id: 'overview', label: 'Progress', icon: Rocket },
    { id: 'architecture', label: 'Architecture', icon: Boxes },
    { id: 'ingestion', label: 'Ingestion', icon: Inbox },
    { id: 'enrichment', label: 'Enrichment', icon: Sparkles },
    { id: 'credentials', label: 'Credentials', icon: KeyRound },
    { id: 'cron', label: 'Cron', icon: Clock },
    { id: 'services', label: 'Services', icon: Plug },
    { id: 'roadmap', label: 'Roadmap', icon: Map },
    { id: 'invariants', label: 'Traps', icon: TriangleAlert },
  ],
  admin: [
    { id: 'ask', label: 'Ask AI', icon: Sparkles },
    { id: 'overview', label: 'Progress', icon: Rocket },
    { id: 'architecture', label: 'Architecture', icon: Boxes },
    { id: 'surfaces', label: 'Pages', icon: LayoutGrid },
    { id: 'access', label: 'Access model', icon: ShieldCheck },
    { id: 'services', label: 'Services', icon: Plug },
    { id: 'roadmap', label: 'Roadmap', icon: Map },
    { id: 'invariants', label: 'Traps', icon: TriangleAlert },
  ],
}

export default async function KnowledgeBasePage({ searchParams }: PageProps) {
  await requireAdmin(2)
  const params = await searchParams
  const app: AppKey = params.app === 'admin' ? 'admin' : 'mobile'

  // Bounded well below the 1000-row PostgREST cap, so a plain select is safe here.
  const { data: savedRows } = await createServiceClient()
    .from('kb_saved_answers')
    .select('id, question, answer, tools_used, corpus_generated_at, created_at')
    .order('created_at', { ascending: false })
    .limit(25)

  return (
    <div className="p-7 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 font-sora text-[20px] font-bold text-salty-text">
            <BookOpen className="h-5 w-5 text-ember" /> Knowledge Base
          </h1>
          <p className="text-[13px] text-salty-muted">
            {app === 'mobile'
              ? 'The Expo app and the engine behind it — every edge function, the database schema, and the providers it depends on.'
              : 'This Next.js control plane — what each page reads, who can see it, and what is still missing.'}
          </p>
        </div>
        <AppSwitcher current={app} />
      </div>

      <nav className="flex flex-wrap gap-2">
        {NAV[app].map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="flex items-center gap-1.5 rounded-lg border border-salty-border bg-warm-white px-3 py-1.5 text-[12.5px] font-medium text-salty-secondary transition-colors hover:border-ember hover:text-ember"
          >
            <s.icon className="h-3.5 w-3.5" /> {s.label}
          </a>
        ))}
      </nav>

      <AskPanel app={app} corpus={corpusMeta()} saved={(savedRows ?? []) as SavedAnswer[]} />

      {app === 'mobile' ? <MobileView /> : <AdminView />}

      <p className="text-[11.5px] text-salty-muted">
        Engineering reference. If you change one of these mechanisms, update the matching section —
        a knowledge base that has quietly gone stale is worse than none.
      </p>
    </div>
  )
}

// ── salty-mobile ─────────────────────────────────────────────────────────────

function MobileView() {
  return (
    <>
      <Section id="overview" title="Where things stand" icon={Rocket} sub="The Expo app — iOS + Android, in beta.">
        <p>
          Beta since 2026-07-15 (TestFlight + Play internal) on a wiped-clean production database.
          Production build 36 (iOS 36 / Android versionCode 19) shipped 2026-07-31 carrying roughly
          two weeks and 244 commits.
        </p>
        <Table
          head={['Area', 'State', 'Notes']}
          rows={[
            ['Core capture — scan, import, enrich', <State key="a" v="Shipped" />, 'Email, photo, forward and CSV all land tickets'],
            ['UI rebuild on the design system', <State key="b" v="Shipped" />, 'Every major screen restyled (~40 PRs)'],
            ['Direct messaging + notifications feed', <State key="c" v="Shipped" />, 'Push on message, unread badge'],
            ['Privacy settings', <State key="d" v="Shipped" />, 'Enforced at the query-read layer, not decorative'],
            ['Kids / family (13+ age gate)', <State key="e" v="Blocked" />, 'In the binary — hold public promo until COPPA/GDPR-K sign-off'],
            ['Scan pipeline pillars 1–5', <State key="f" v="Partial" />, 'Pillars 1–4 shipped; pillar 5 (email OAuth) partly built'],
            ['Store listing', <State key="g" v="Planned" />, 'No public App Store / Play listing yet'],
          ]}
        />
        <Rule title="The standing risk is device verification">
          Work merges behind a full local gate (typecheck + eslint --max-warnings 0 + jest) but that
          proves nothing about a device. A native module imported at the top of a screen once
          crashed the whole Tickets tab on every existing build, and it was only found by running it.
          Build and smoke-test before believing a feature works.
        </Rule>
        <Rule title="Inbox connection is the real adoption problem">
          Historically ~9% of accounts ever connected an inbox despite Gmail being one tap. That is
          why forward-to-scan exists — forward any ticket email to a per-user address, no OAuth, and
          it becomes a ticket.
        </Rule>
      </Section>

      <Section id="architecture" title="Architecture" icon={Boxes} sub="Two repos, one database.">
        <p>
          <Code>salty-mobile</Code> owns the Expo app, <strong className="text-salty-text">every
          edge function</strong>, and the entire database schema. <Code>Salty-Admin</Code> is a
          separate Next.js panel reading the same Supabase project (<Code>lzhrntjwnmrpwebmqyha</Code>)
          with the service role. Local development points at production — there is no separate dev
          database.
        </p>
        <Rule title="Migrations are applied out of band">
          <Code>supabase db push</Code> is broken (remote history drifted from the files). Apply via
          the Supabase MCP <Code>apply_migration</Code> or the dashboard, then commit the matching
          delta file. The real drift gate is <Code>npm run types:check</Code>, not the history table.
        </Rule>
        <p>
          Edge functions keep prompts, tool schemas and parsing in a Deno-free <Code>core.ts</Code>{' '}
          so jest can test them, with <Code>index.ts</Code> holding the I/O. Shared helpers in{' '}
          <Code>_shared/</Code> avoid SDK imports for the same reason.
        </p>
      </Section>

      <Section id="ingestion" title="Ingestion" icon={Inbox} sub="How tickets get in.">
        <Table
          head={['Source', 'Mechanism', 'Telemetry']}
          rows={[
            ['gmail', 'OAuth + Gmail API, swept by scan-gmail', 'scan_runs source=gmail'],
            ['imap', 'App password or Microsoft XOAUTH2, swept by scan-imap', 'scan_runs source=imap'],
            ['photo', 'On-device library scan; only matched thumbnails upload', 'photo_scan_jobs'],
            ['forward', 'User forwards mail to a per-user address', <span key="f" className="text-[#BF4A3A]">writes no scan_runs row in practice</span>],
            ['csv', 'Order-history import (Ticketmaster / SeatGeek / TickPick / Songkick)', 'pending_imports'],
          ]}
        />
        <Rule title="Scheduled scanning is opt-in and defaults to OFF">
          A <Code>scan_schedules</Code> row is only created when a user changes the setting in the
          app. <Code>DEFAULT_SCAN_SCHEDULE.enabled</Code> is <Code>false</Code>, and the cron{' '}
          <Code>run-scheduled-scans</Code> iterates that table — so connecting an inbox alone never
          gets you a scheduled scan. By design, but it surprises people.
        </Rule>
        <Rule title="Photos stay client-thin — a hard constraint">
          The library is never bulk-uploaded. Matching, dedup and AI verification may move
          server-side; raw pixels may not. App Store privacy labels depend on this.
        </Rule>
      </Section>

      <Section id="enrichment" title="Enrichment pipeline" icon={Sparkles} sub="One queue, one worker, N kinds.">
        <p>
          Every derived field used to be fetched opportunistically when a user opened an event, so
          anything never opened stayed empty forever. The fix is a single queue drained every 10
          minutes:
        </p>
        <pre className="overflow-x-auto rounded-[10px] border border-salty-border bg-cream px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-salty-text">
{`pg_cron → trigger_enrichment_worker() → pg_net POST → enrichment-worker
   → enqueue_enrichment_jobs()   discover work for every incomplete ticket
   → claim_enrichment_jobs(kind) lease a paced batch (FOR UPDATE SKIP LOCKED)
   → handler                     sibling-copy first, then the external call
   → complete_enrichment_job()   done | transient retry (15m·4^n, 4 attempts)`}
        </pre>
        <p>Kinds currently registered ({ENRICHMENT_KINDS.length}):</p>
        <div className="flex flex-wrap gap-1.5">
          {ENRICHMENT_KINDS.map((k) => (
            <span key={k} className="rounded-full border border-salty-border bg-cream px-2.5 py-0.5 font-mono text-[11.5px] text-salty-text">{k}</span>
          ))}
        </div>
        <Rule title="Adding a kind">
          A discovery predicate in <Code>enqueue_enrichment_jobs()</Code>, a handler in the worker, a{' '}
          <Code>BATCH</Code> cap, and the kind added to the admin&apos;s <Code>enrichment/kinds.ts</Code>{' '}
          (which drives both the pipeline matrix and the retry buttons). No new cron.
        </Rule>
        <Rule title="Sibling-copy before any external call">
          The first ticket at a canonical event pays the provider cost; later tickets at the same
          event copy it (<Code>copy_*_from_sibling</Code>). Skipping this multiplies spend by the
          number of attendees.
        </Rule>
        <Rule title="&quot;Done&quot; means attempted, not successful">
          <Code>done</Code> = data found <em>or</em> definitively none. A transient failure must be a{' '}
          <Code>retry</Code>. Getting this backwards is how a resolvable item silently converges to
          &quot;nothing here&quot; forever.
        </Rule>
      </Section>

      <Section id="credentials" title="Credentials & encryption" icon={KeyRound} sub="AES-256-GCM at rest, with a survivable rotation.">
        <p>
          Mailbox passwords and OAuth tokens are encrypted in <Code>_shared/crypto.ts</Code> with a
          key that exists only in the edge runtime. A database dump reveals ciphertext only.
        </p>
        <Table
          head={['Format', 'Meaning']}
          rows={[
            [<Code key="1">enc:v2:&lt;kid&gt;:&lt;data&gt;</Code>, 'Current. The kid identifies which key encrypted it — answerable from SQL.'],
            [<Code key="2">enc:v1:&lt;data&gt;</Code>, 'Legacy. Decrypts, but its key is unknowable. Rewrap when convenient.'],
            ['no prefix', 'Pre-encryption plaintext. Returned as-is; re-encrypted on next write.'],
          ]}
        />
        <Rule title="Rotating the key">
          Set the new key as <Code>TOKEN_ENCRYPTION_KEY</Code> and the old one as{' '}
          <Code>TOKEN_ENCRYPTION_KEY_PREVIOUS</Code>. Both are tried on decrypt, so nothing breaks;
          values migrate as they are rewritten. Drop the previous key only once nothing reports{' '}
          <Code>needsRewrap</Code>. Rotating <em>without</em> setting the previous key permanently
          destroys every stored credential — this happened on 2026-08-08 and killed six mailbox
          connections at once.
        </Rule>
        <Rule title="decryptSecret throws — deliberately">
          It never returns null on failure, because a caller receiving null would authenticate with
          an empty password. Every call site must catch it and record a failure.
        </Rule>
      </Section>

      <Section id="cron" title="Cron topology" icon={Clock} sub="Everything scheduled, in one place (UTC).">
        <Table
          head={['Job', 'Schedule', 'Does']}
          rows={[
            ['scheduled-scans', '*/15 * * * *', 'Dispatches scan-gmail + scan-imap per scheduled user'],
            ['enrichment-worker', '*/10 * * * *', 'Drains the enrichment queue, then reconciles canonical events'],
            ['enrich-sweep-6h', '30 */6 * * *', 'Legacy sweep, largely subsumed by the queue'],
            ['reap-abandoned-photo-scans', '17 * * * *', 'Fails photo_scan_jobs stuck running >6h'],
            ['purge-expired-statuses', '17 * * * *', 'Deletes expired status rows'],
            ['daily-digest / saved-event-reminders / streak-nudge / monthly-recap', 'various', 'User notifications'],
            ['prune-api-usage-log', '20 3 * * *', 'api_usage_log >90d'],
            ['prune-llm-call-log', '35 3 * * *', 'llm_call_log >365d'],
            ['prune-app-tables', '50 3 * * *', 'search_cache >7d · read notifications >180d · scan_runs >90d · rejected proposals >90d'],
          ]}
        />
      </Section>

      <Section id="services" title="Applications & services" icon={Plug} sub="Everything the app talks to. Usage is ledgered in api_usage_log.">
        <Table
          head={['Service', 'Used for', 'Secret']}
          rows={[
            ['Supabase', 'Postgres, auth, storage, edge functions, Realtime, pg_cron, pg_net', 'SUPABASE_* / SERVICE_ROLE_JWT'],
            ['Anthropic (Claude)', 'Ticket extraction from email + photo, cast/lineup recall, setlist fallback, categorisation, ask-memory', 'ANTHROPIC_API_KEY'],
            ['Ticketmaster', 'Event/attraction/venue search, price estimates, geo+date discovery', 'TICKETMASTER_API_KEY'],
            ['TheSportsDB', 'Game resolution, scores, match lineups, team rosters, badges', 'THESPORTSDB_API_KEY'],
            ['setlist.fm', 'Real setlists + venue pivot for support acts', 'SETLISTFM_API_KEY'],
            ['phish.net', 'Authoritative sets/encores for the Phish family', 'PHISHNET_API_KEY'],
            ['MLB Stats API', 'Baseball box scores + highlights', 'keyless'],
            ['ESPN', 'NFL / NBA / NHL box scores + highlights', 'keyless'],
            ['NBA Stats', 'G-League scoreboard fallback', 'keyless'],
            ['Sportradar', 'Supplementary sports data', 'SPORTRADAR_API_KEY'],
            ['Spotify', 'Artist search + playlist export', 'SPOTIFY_CLIENT_ID / _SECRET'],
            ['MusicBrainz', 'Artist fallback when Spotify has no match', 'keyless (UA required)'],
            ['Nominatim / Photon', 'Venue geocoding, with typo-tolerant fallback', 'keyless (UA required, 1 req/s)'],
            ['Google OAuth', 'Gmail read scope for inbox scanning', 'GOOGLE_CLIENT_ID / _SECRET'],
            ['Microsoft OAuth', 'Outlook/Hotmail IMAP via XOAUTH2', 'MICROSOFT_CLIENT_ID'],
            ['Resend', 'Inbound forward-to-scan + child invites', 'RESEND_API_KEY'],
            ['Expo / EAS', 'Builds, OTA updates, push delivery', 'EAS credentials'],
            ['PostHog', 'Product analytics + $exception error tracking', 'project key'],
            ['Airtable', 'Beta feedback intake', 'AIRTABLE_API_KEY'],
          ]}
        />
        <Rule title="Personal Microsoft mailboxes cannot use a password">
          Outlook / Hotmail / Live / MSN permanently lost Basic Auth for IMAP in Sep 2024 — regular
          and app passwords both. They are deliberately absent from the IMAP provider list and must
          go through OAuth. Yahoo, iCloud and AOL still work with an app-specific password.
        </Rule>
      </Section>

      <Section id="roadmap" title="Roadmap" icon={Map} sub="From the repo's own planning docs.">
        <Table
          head={['Plan', 'State', 'What it does']}
          rows={[
            ['Pillar 5 — email OAuth', <State key="a" v="Partial" />, 'Gmail fail-fast scope validation built; Microsoft XOAUTH2 code built but INERT until an Azure app exists'],
            ['Photo-scanner seam refactor', <State key="b" v="Partial" />, 'Decomposing the 1,498-line client scanner into testable stages. ScanStatePort, PhotoScanJobStore and MediaPort landed'],
            ['Perf / data layer', <State key="c" v="Scoped" />, 'React Query + MMKV persisted cache + expo-image everywhere; replaces hand-built caches'],
            ['Season tickets', <State key="d" v="Scoped" />, 'Handling a season-long block of games as one purchase'],
            ['Tag accept', <State key="e" v="Scoped" />, 'Accept/decline flow for being tagged into someone else’s event'],
            ['OS widgets', <State key="f" v="Scoped" />, 'Home-screen widgets for upcoming events'],
            ['Forward-to-scan v2', <State key="g" v="Planned" />, 'Deeper provider coverage on top of the shipped forward path'],
            ['Store listing + public launch', <State key="h" v="Planned" />, 'Blocked on kids/COPPA sign-off for public promotion'],
          ]}
        />
        <Rule title="Known gaps in enrichment coverage">
          <Code>comedy</Code>, <Code>talk</Code>, <Code>restaurant</Code>, <Code>trip</Code> and{' '}
          <Code>other</Code> have no enrichment at all. Deciding what &quot;enriched&quot; means for
          a comedy set or a dinner is a product question, not a missing handler.
        </Rule>
      </Section>

      <Section id="invariants" title="Invariants & traps" icon={TriangleAlert} sub="Each of these has already caused a real bug.">
        <Rule title="Deploying an edge function resets verify_jwt to true">
          Any function that authenticates itself (cron secret, webhook signature) must be pinned in{' '}
          <Code>supabase/config.toml</Code>, and you must deploy from the repo root so it is read.
          Missing this once took the scan cron down for three weeks.
        </Rule>
        <Rule title="Every terminal failure must write its telemetry row">
          A throw that escapes before <Code>persistScanRun</Code> produces no record at all, which
          reads as &quot;never scheduled&quot; rather than &quot;failing constantly&quot; — strictly
          worse than a bad error message.
        </Rule>
        <Rule title="Empty and throttled are not the same answer">
          Providers return empty results under load. Treating that as &quot;no data exists&quot;
          marks good records permanently unresolvable. The AI enrichers signal the difference with a{' '}
          <Code>transient</Code> flag; geocode retries rather than converging.
        </Rule>
        <Rule title="create or replace swaps the WHOLE function body">
          <Code>enqueue_enrichment_jobs()</Code> is restated in full by every migration that touches
          it. Copy from the most recent version or you silently revert a predicate and a whole kind
          stops being discovered.
        </Rule>
        <Rule title="Never let a provider URL reach a log or ledger">
          Ticketmaster and others carry the API key in the query string, and fetch errors embed the
          full URL. <Code>sanitizeApiError</Code> strips URLs before anything is persisted.
        </Rule>
        <Rule title="tickets.date_str is free text">
          There is no real date column and <Code>is_past</Code> is unreliable. Parse with{' '}
          <Code>toIsoDate()</Code> rather than trusting either.
        </Rule>
      </Section>
    </>
  )
}

// ── salty-admin ──────────────────────────────────────────────────────────────

function AdminView() {
  return (
    <>
      <Section id="overview" title="Where things stand" icon={Rocket} sub="Next.js 16 control plane on Vercel.">
        <p>
          The panel covers roughly 35 app tables across ~40 routes. The 2026-08 parity pass closed
          the largest gaps — the canonical-events layer and the enrichment queue had no surface at
          all before it.
        </p>
        <Table
          head={['Area', 'State', 'Notes']}
          rows={[
            ['Users · tickets · imports · email connections', <State key="a" v="Shipped" />, 'Including bulk actions and CSV export'],
            ['Canonical events + enrichment pipeline', <State key="b" v="Shipped" />, 'P0 of the parity plan'],
            ['Data quality + UGC moderation', <State key="c" v="Shipped" />, 'P1 — App Store guideline 1.2'],
            ['Health, alerts, auto-remediation', <State key="d" v="Shipped" />, 'Daily cron + tiered email escalation'],
            ['API usage + LLM cost ledgers', <State key="e" v="Shipped" />, 'Per-provider and per-feature attribution'],
            ['Support chat', <State key="f" v="Blocked" />, 'Built but locked behind UnfinishedOverlay; mobile half not started'],
            ['Kids / child profiles', <State key="g" v="Planned" />, 'COPPA-sensitive, Super-Admin only'],
          ]}
        />
        <Rule title="One DB addition of its own">
          <Code>get_enrichment_worker_runs(int)</Code> — a SECURITY DEFINER bridge so the panel can
          read <Code>net._http_response</Code> (the <Code>net</Code> schema is not exposed to
          PostgREST). Locked to <Code>service_role</Code>. The later aggregation RPCs for API usage
          and LLM cost follow the same pattern.
        </Rule>
      </Section>

      <Section id="architecture" title="Architecture" icon={Boxes} sub="App Router, server components, service-role reads.">
        <Table
          head={['Piece', 'Detail']}
          rows={[
            ['Framework', 'Next.js 16.2.6 · React 19 · App Router only · Tailwind 3 + shadcn/ui · recharts'],
            [<Code key="p">proxy.ts</Code>, 'Next 16 replacement for middleware.ts — session gate with a public-path allowlist'],
            [<Code key="s">createServiceClient()</Code>, 'Service role, bypasses RLS. The default for app-data reads'],
            [<Code key="a">createAuthClient()</Code>, 'Cookie-scoped user session, for identifying the admin'],
            [<Code key="e">createEdgeFunctionClient()</Code>, 'Uses SERVICE_ROLE_JWT — the sb_secret_ key is not a JWT and PostgREST rejects it as a bearer'],
            [<Code key="v">createV2Client()</Code>, 'Read-only client for a separate "v2" Supabase project (beta signups, v2 analytics)'],
          ]}
        />
        <p>
          Server actions live in a co-located <Code>actions.ts</Code>, and every one re-checks{' '}
          <Code>requireAdmin(level)</Code> independently — the page gate is not the boundary. Mutating
          actions write to <Code>admin_audit_log</Code>.
        </p>
      </Section>

      <Section id="surfaces" title="Pages" icon={LayoutGrid} sub="What each operational page reads.">
        <Table
          head={['Page', 'Reads', 'Use it when']}
          rows={[
            [<Link key="h" href="/health" className="font-medium text-ember hover:underline">Health</Link>,
              'Edge pings, scan_cron_health, ingestion funnel, enrichment backlog, PostHog $exception',
              'Something feels wrong and you do not know where'],
            [<Link key="e" href="/enrichment?tab=pipeline" className="font-medium text-ember hover:underline">Enrichment</Link>,
              'enrichment_jobs matrix, get_enrichment_worker_runs',
              'A derived field is missing, or to retry failed jobs'],
            [<Link key="a" href="/api-usage" className="font-medium text-ember hover:underline">API Usage</Link>,
              'api_usage_log via Postgres rollups',
              'A provider is slow, failing, or nearing a quota'],
            [<Link key="l" href="/llm-costs" className="font-medium text-ember hover:underline">LLM Costs</Link>,
              'llm_call_log via Postgres rollups + optional org spend',
              'Attributing AI spend to a feature'],
            [<Link key="d" href="/data-quality" className="font-medium text-ember hover:underline">Data Quality</Link>,
              'Enrichment completeness + canonical-event integrity',
              'Auditing coverage rather than failures'],
            [<Link key="m" href="/manual-edit" className="font-medium text-ember hover:underline">Manual Edit</Link>,
              'Ticket core/tags/notes/cast/setlist + AI lookup suggestions',
              'Fixing an individual ticket by hand'],
            [<Link key="p" href="/pending-imports" className="font-medium text-ember hover:underline">Pending Imports</Link>,
              'pending_imports with rejection_reason',
              'Triaging what the scanners produced'],
            [<Link key="g" href="/gmail-connections" className="font-medium text-ember hover:underline">Email Connections</Link>,
              'gmail_connections + imap_connections (tokens excluded)',
              'A user says their inbox is not scanning'],
          ]}
        />
      </Section>

      <Section id="access" title="Access model" icon={ShieldCheck} sub="Four levels; lower number means more privilege.">
        <Table
          head={['Level', 'Role', 'Typical reach']}
          rows={[
            ['1', 'Super Admin', 'Health, alerts, config, feature flags, admin users, audit log, CSV exports'],
            ['2', 'Admin', 'Mutating ticket/user data, unmasked PII, enrichment retries, manual edit'],
            ['3', 'Moderator', 'Moderation queues and read-only data quality'],
            ['4', 'Support', 'Read-only, PII masked'],
          ]}
        />
        <Rule title="The server action is the boundary">
          <Code>proxy.ts</Code> only checks that a session exists. Page-level{' '}
          <Code>requireAdmin(n)</Code> redirects. Sidebar filtering is cosmetic. The real enforcement
          is every action re-checking independently — never rely on the nav hiding a link.
        </Rule>
        <Rule title="PII masking is explicit">
          The idiom is <Code>const showPii = admin.access_level &lt;= 2</Code>, then{' '}
          <Code>maskEmail()</Code> for everyone else. It is applied per page, so a new page inherits
          nothing.
        </Rule>
      </Section>

      <Section id="services" title="Applications & services" icon={Plug} sub="What the admin itself connects to.">
        <Table
          head={['Service', 'Used for', 'Env']}
          rows={[
            ['Supabase (prod)', 'Every app-data read/write via the service role', 'NEXT_PUBLIC_SUPABASE_URL · SUPABASE_SERVICE_KEY · SUPABASE_SERVICE_ROLE_JWT'],
            ['Supabase (v2)', 'Read-only second project for beta signups + v2 analytics', 'V2_SUPABASE_URL · V2_SUPABASE_SERVICE_KEY'],
            ['Resend', 'Admin email, campaigns, beta invites, suppressions, delivery webhooks', 'RESEND_API_KEY · RESEND_WEBHOOK_SECRET'],
            ['PostHog', 'Build adoption, product analytics, $exception error tracking', 'POSTHOG_API_KEY · POSTHOG_PROJECT_ID'],
            ['Airtable', 'Beta feedback base — the only source for /feedback', 'AIRTABLE_API_KEY · AIRTABLE_BETA_FEEDBACK_BASE_ID'],
            ['Anthropic', 'Manual-edit AI lookup, category verification, remediation triage', 'ANTHROPIC_API_KEY · ANTHROPIC_ADMIN_KEY (org spend)'],
            ['Gemini / Groq', 'Free tiers of the LLM fallback ladder, activated by key presence', 'GEMINI_API_KEY · GROQ_API_KEY (optional)'],
            ['Vercel', 'Hosting + one daily cron hitting /api/cron/health', 'vercel.json'],
            ['Mobile config bridge', 'Reads which secrets are set in the app runtime, presence only', 'CONFIG_STATUS_SECRET'],
          ]}
        />
        <Rule title="Never add a Supabase PAT here">
          Mobile secret presence is read through a shared-secret <Code>config-status</Code> edge
          function that returns booleans, not values. That exists specifically so the panel never
          holds a token that could read another project.
        </Rule>
      </Section>

      <Section id="roadmap" title="Roadmap" icon={Map} sub="From the parity plan, plus what this session surfaced.">
        <Table
          head={['Item', 'State', 'Notes']}
          rows={[
            ['Reports queue', <State key="a" v="Planned" />, 'Needs its own table — user_blocks has no reason/action, so moderation shows blocks only'],
            ['Kids / child profiles view', <State key="b" v="Planned" />, 'Super-Admin only, COPPA-sensitive, audit every read'],
            ['Support chat', <State key="c" v="Blocked" />, 'Admin side built and locked; the mobile half is not started'],
            ['Festival plan inspector', <State key="d" v="Planned" />, 'tickets.category_metadata.festival — days, stages, acts caught'],
            ['Artist alert delivery view', <State key="e" v="Planned" />, 'followed_artists + sent_artist_alerts — who got alerted for which show'],
            ['App Store Connect / Google Play', <State key="f" v="Blocked" />, 'Needs API credentials. Would give review status, crash-free rate, real version adoption'],
            ['EAS build status', <State key="g" v="Blocked" />, 'Needs an Expo token. /build-adoption currently infers from the database'],
            ['Forward-to-scan telemetry', <State key="h" v="Planned" />, '33 addresses and 10 real tickets, but zero scan_runs rows — the feature works, the telemetry does not'],
          ]}
        />
      </Section>

      <Section id="invariants" title="Invariants & traps" icon={TriangleAlert} sub="Admin-specific failure modes.">
        <Rule title="PostgREST truncates every response at 1000 rows">
          Regardless of <Code>.limit()</Code>. Any total computed by reducing rows in JS silently
          becomes &quot;the most recent 1000&quot;. Aggregate in Postgres and expose an RPC — see{' '}
          <Code>get_api_usage_summary</Code>. Plain selects are fine only for bounded listings.
        </Rule>
        <Rule title="Realtime needs setAuth before subscribe">
          <Code>supabase.realtime.setAuth(session.access_token)</Code> must run before subscribing,
          or the socket registers as <Code>anon</Code> and RLS silently drops every change.
        </Rule>
        <Rule title="Health checks feed real alerting">
          A non-advisory <Code>warn</Code> or <Code>down</Code> in <Code>runHealthChecks()</Code>{' '}
          opens a <Code>health_incidents</Code> row and can email contacts, depending on{' '}
          <Code>notify_min_severity</Code>. Adding a check is not a read-only change.
        </Rule>
        <Rule title="Keep the two lint-adjacent lists in sync">
          <Code>EDGE_FUNCTIONS</Code> in <Code>lib/health.ts</Code> and{' '}
          <Code>EDGE_FUNCTION_HINT</Code> in <Code>lib/remediation.ts</Code> mirror each other — a
          function present in one but not the other gets a check with no runbook.
        </Rule>
      </Section>
    </>
  )
}
