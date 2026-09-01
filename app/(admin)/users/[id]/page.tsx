import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdmin, logAudit } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { maskEmail } from '@/lib/privacy'
import { formatPrice } from '@/lib/format'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ClickableRow } from '@/components/ui/clickable-row'
import { DeleteUserButton } from './delete-user-button'
import { SendNotificationDialog } from './send-notification-dialog'
import { SendEmailDialog } from './send-email-dialog'
import { ResetPasswordButton } from './reset-password-button'
import { ForceSignOutButton } from './force-signout-button'
import { TierSelect } from './tier-select'
import { BanUserDialog } from './ban-user-dialog'
import { PermissionsPanel } from './permissions-panel'
import { ArrowLeft, ShieldCheck } from 'lucide-react'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function UserDetailPage({ params }: PageProps) {
  const admin = await requireAdmin(3)
  const { id } = await params
  const db = createServiceClient()

  const canViewImports = admin.access_level <= 2
  const canViewEvent = admin.access_level <= 2 // /events/[id] requires level <= 2

  const [
    { data: user },
    { data: tickets },
    { data: allFriendships },
    { data: gmail },
    { data: pendingImports },
    { data: userFeedback },
    { data: privacy },
    photosCountRes,
    authUserResult,
    { data: permissionState },
    { data: scanSchedule },
    { data: emailScanRuns },
    { data: photoScanJobs },
  ] = await Promise.all([
    db.from('users').select('*, banned_until').eq('id', id).single(),
    db.from('tickets').select('*').eq('user_id', id).order('imported_at', { ascending: false }).limit(1000),
    db.from('friendships').select('requester_id, addressee_id, status').or(`requester_id.eq.${id},addressee_id.eq.${id}`),
    db.from('gmail_connections').select('email, last_synced_at, connected_at').eq('user_id', id).maybeSingle(),
    canViewImports
      ? db.from('pending_imports').select('*').eq('user_id', id).eq('status', 'pending').order('created_at', { ascending: false }).limit(20)
      : Promise.resolve({ data: [] }),
    db.from('feedback').select('id, category, rating, message, status, created_at').eq('user_id', id).order('created_at', { ascending: false }),
    db.from('privacy_settings').select('profile_visibility, share_events, allow_tagging, appear_in_search, share_event_photos, updated_at').eq('user_id', id).maybeSingle(),
    // Count only — never fetch a user's photo URLs into the admin app.
    db.from('photos').select('id', { count: 'exact', head: true }).eq('user_id', id),
    db.auth.admin.getUserById(id),
    // Whether they ever granted photo access, and whether a scan has ever actually run for
    // them. See permissions-panel.tsx for why this is on the page at all.
    db.from('user_permission_state').select('*').eq('user_id', id).maybeSingle(),
    db.from('scan_schedules').select('enabled, frequency, day_of_week, day_of_month, hour, minute, last_run_at').eq('user_id', id).maybeSingle(),
    db.from('scan_runs').select('source, started_at, finished_at, outcome, error_message, accepted, pending, listed').eq('user_id', id).order('started_at', { ascending: false }).limit(1),
    db.from('photo_scan_jobs').select('status, started_at, completed_at, matched_count, new_ticket_count, error_message, access_privileges').eq('user_id', id).order('started_at', { ascending: false }).limit(1),
  ])

  if (!user) notFound()

  const photoCount = photosCountRes.count ?? 0

  const lastSignIn: string | null = authUserResult.data?.user?.last_sign_in_at ?? null

  const { data: matchingAdmin } = await db
    .from('admin_users')
    .select('id')
    .eq('email', user.email)
    .maybeSingle()

  await logAudit(admin.id, 'view_user_profile', 'user', id)

  // Resolve friend profiles
  const friendIds = (allFriendships ?? [])
    .filter(f => f.status === 'accepted')
    .map(f => f.requester_id === id ? f.addressee_id : f.requester_id)

  const { data: friendUsers } = friendIds.length > 0
    ? await db.from('users').select('id, email, display_name, username').in('id', friendIds)
    : { data: [] }

  const canDelete = (admin?.access_level ?? 5) <= 2
  const canNotify = (admin?.access_level ?? 5) <= 3
  const canChangeTier = (admin?.access_level ?? 5) <= 2
  const canManageAuth = (admin?.access_level ?? 5) <= 2
  const canBan = (admin?.access_level ?? 5) <= 2
  const showFullPii = (admin?.access_level ?? 5) <= 2

  const isBanned = user.banned_until !== null && new Date(user.banned_until) > new Date()
  const isPermBan = isBanned && user.banned_until && new Date(user.banned_until).getFullYear() >= 2099

  const displayName = user.display_name ?? user.username ?? user.email
  const displayEmail = showFullPii ? user.email : maskEmail(user.email)

  return (
    <div className="p-7 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/users" className="text-salty-muted hover:text-salty-text transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="font-sora text-[20px] font-bold text-salty-text">{displayName}</h1>
          <p className="text-[13px] text-salty-muted">{displayEmail}</p>
        </div>
      </div>

      {/* Profile + Stats */}
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Profile card */}
        <div className="rounded-[14px] border border-salty-border bg-warm-white p-5 space-y-3 lg:col-span-1">
          <h2 className="font-sora text-[13px] font-bold text-salty-text border-b border-salty-border pb-2">Profile</h2>
          <InfoRow label="Email" value={displayEmail} />
          <InfoRow label="Username" value={user.username ?? '—'} />
          <InfoRow label="Display name" value={user.display_name ?? '—'} />
          <InfoRow label="Zip code" value={user.zip_code ?? '—'} />
          <InfoRow label="Joined" value={new Date(user.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} />
          <InfoRow
            label="Last sign-in"
            value={lastSignIn
              ? <span title={new Date(lastSignIn).toLocaleString()}>{relativeTime(lastSignIn)}</span>
              : <span className="text-salty-muted">Never</span>
            }
          />
          <InfoRow
            label="Gmail"
            value={gmail
              ? <span className="text-[#3E8A5A] font-medium">{showFullPii ? gmail.email : maskEmail(gmail.email)} · synced {gmail.last_synced_at ? new Date(gmail.last_synced_at).toLocaleDateString() : 'never'}</span>
              : <span className="text-salty-muted">Not connected</span>
            }
          />
          <div className="flex items-center justify-between">
            <span className="text-[13px] text-salty-muted">Tier</span>
            {canChangeTier
              ? <TierSelect userId={id} currentTier={user.tier ?? 'free'} />
              : <span className="capitalize text-[13px] font-medium text-salty-text">{user.tier ?? 'free'}</span>
            }
          </div>
          {isBanned && (
            <InfoRow
              label="Status"
              value={
                <span className="font-semibold text-[#BF4A3A]">
                  {isPermBan ? 'Permanently banned' : `Banned until ${new Date(user.banned_until!).toLocaleDateString()}`}
                </span>
              }
            />
          )}
        </div>

        {/* Stats */}
        <div className="lg:col-span-2 grid grid-cols-3 gap-3 content-start">
          {[
            { label: 'Tickets', value: tickets?.length ?? 0 },
            { label: 'Photos', value: photoCount },
            { label: 'Friends', value: friendIds.length },
            ...(canViewImports ? [{ label: 'Pending imports', value: pendingImports?.length ?? 0 }] : []),
            { label: 'Feedback submitted', value: userFeedback?.length ?? 0 },
          ].map(s => (
            <div key={s.label} className="rounded-[14px] border border-salty-border bg-warm-white p-4">
              <p className="text-[12px] text-salty-muted">{s.label}</p>
              <p className="mt-1 font-sora text-[24px] font-bold text-salty-text">{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Privacy & safety — read-only; explains visibility/tagging for support & moderation */}
      <div className="rounded-[14px] border border-salty-border bg-warm-white p-5">
        <div className="flex items-center gap-2 border-b border-salty-border pb-2">
          <ShieldCheck className="h-4 w-4 text-ember" />
          <h2 className="font-sora text-[13px] font-bold text-salty-text">Privacy &amp; safety</h2>
          {privacy?.updated_at && <span className="text-[11px] text-salty-muted">· updated {new Date(privacy.updated_at).toLocaleDateString()}</span>}
        </div>
        {privacy ? (
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            <PrivacyStat label="Profile visibility" value={<span className="capitalize">{privacy.profile_visibility ?? 'default'}</span>} />
            <PrivacyStat label="Share events" value={<Toggle on={privacy.share_events} />} />
            <PrivacyStat label="Allow tagging" value={<Toggle on={privacy.allow_tagging} />} />
            <PrivacyStat label="Appear in search" value={<Toggle on={privacy.appear_in_search} />} />
            <PrivacyStat label="Share event photos" value={<Toggle on={privacy.share_event_photos} />} />
          </div>
        ) : (
          <p className="mt-3 text-[13px] text-salty-muted">No custom privacy settings saved — the app is using its defaults for this user.</p>
        )}
      </div>

      <PermissionsPanel
        permissions={permissionState ?? null}
        schedule={scanSchedule ?? null}
        lastEmailScan={emailScanRuns?.[0] ?? null}
        lastPhotoScan={photoScanJobs?.[0] ?? null}
      />

      {/* Actions */}
      {(canNotify || canDelete || canManageAuth) && (
        <div className="flex gap-2 flex-wrap">
          {canNotify && <SendNotificationDialog userId={id} />}
          {canManageAuth && <SendEmailDialog userId={id} userEmail={displayEmail} />}
          {canManageAuth && <ResetPasswordButton userId={id} userEmail={user.email} />}
          {canManageAuth && <ForceSignOutButton userId={id} userEmail={user.email} />}
          {canBan && <BanUserDialog userId={id} userEmail={user.email} bannedUntil={user.banned_until ?? null} />}
          {canDelete && <DeleteUserButton userId={id} userEmail={user.email} alsoAdmin={!!matchingAdmin} />}
        </div>
      )}

      {/* Tabs */}
      <Tabs defaultValue="tickets">
        <TabsList className="bg-stone">
          <TabsTrigger value="tickets">Tickets ({tickets?.length ?? 0})</TabsTrigger>
          <TabsTrigger value="friends">Friends ({friendIds.length})</TabsTrigger>
          {canViewImports && <TabsTrigger value="imports">Pending Imports ({pendingImports?.length ?? 0})</TabsTrigger>}
          <TabsTrigger value="feedback">Feedback ({userFeedback?.length ?? 0})</TabsTrigger>
        </TabsList>

        {/* Tickets */}
        <TabsContent value="tickets">
          <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
            <Table>
              <TableHeader>
                <TableRow>
                  {['Title','Category','Date','Source','Price','Status'].map(h => <TableHead key={h}>{h}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(tickets ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-salty-muted py-6">No tickets</TableCell></TableRow>
                ) : (
                  (tickets ?? []).map(t => {
                    const cells = (
                      <>
                        <TableCell className="font-medium">{t.title ?? '—'}</TableCell>
                        <TableCell><Badge variant="secondary" className="text-xs capitalize">{t.category}</Badge></TableCell>
                        <TableCell className="text-salty-muted text-sm">{t.date_str ?? '—'}</TableCell>
                        <TableCell className="text-salty-muted text-sm capitalize">{t.source}</TableCell>
                        <TableCell className="text-sm font-medium">{formatPrice(t.price_paid, t.price_currency)}</TableCell>
                        <TableCell><Badge variant="outline" className="text-xs capitalize">{t.status}</Badge></TableCell>
                      </>
                    )
                    return canViewEvent ? (
                      <ClickableRow key={t.id} href={`/events/${t.id}`} ariaLabel={`View ${t.title ?? 'event'} details`} className="border-b transition-colors hover:bg-muted/50">
                        {cells}
                      </ClickableRow>
                    ) : (
                      <TableRow key={t.id}>{cells}</TableRow>
                    )
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Friends */}
        <TabsContent value="friends">
          <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
            <Table>
              <TableHeader>
                <TableRow>
                  {['Email','Display Name','Username',''].map(h => <TableHead key={h}>{h}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(friendUsers ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={4} className="text-center text-salty-muted py-6">No friends</TableCell></TableRow>
                ) : (
                  (friendUsers ?? []).map(f => (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">{showFullPii ? f.email : maskEmail(f.email)}</TableCell>
                      <TableCell className="text-salty-muted">{f.display_name ?? '—'}</TableCell>
                      <TableCell className="text-salty-muted">{f.username ?? '—'}</TableCell>
                      <TableCell>
                        <Link href={`/users/${f.id}`} className="text-[12px] font-medium text-ember hover:underline">View</Link>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        {/* Pending imports — Admin and above only */}
        {canViewImports && <TabsContent value="imports">
          <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
            <Table>
              <TableHeader>
                <TableRow>
                  {['Subject / Title','Category','Confidence','Status','Date'].map(h => <TableHead key={h}>{h}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(pendingImports ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-salty-muted py-6">No pending imports</TableCell></TableRow>
                ) : (
                  (pendingImports ?? []).map(imp => (
                    <TableRow key={imp.id}>
                      <TableCell className="text-sm max-w-xs">
                        <p className="truncate">{imp.raw_data?.subject ?? imp.raw_data?.title ?? '—'}</p>
                      </TableCell>
                      <TableCell className="capitalize text-sm text-salty-muted">{imp.raw_data?.category ?? '—'}</TableCell>
                      <TableCell>{Math.round((imp.confidence ?? 0) * 100)}%</TableCell>
                      <TableCell><Badge variant="outline" className="text-xs capitalize">{imp.status}</Badge></TableCell>
                      <TableCell className="text-salty-muted text-sm">{new Date(imp.created_at).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>}

        {/* Feedback */}
        <TabsContent value="feedback">
          <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
            <Table>
              <TableHeader>
                <TableRow>
                  {['Category','Rating','Message','Status','Date'].map(h => <TableHead key={h}>{h}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {(userFeedback ?? []).length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center text-salty-muted py-6">No feedback submitted</TableCell></TableRow>
                ) : (
                  (userFeedback ?? []).map(f => (
                    <TableRow key={f.id}>
                      <TableCell className="font-medium">{f.category}</TableCell>
                      <TableCell>{'★'.repeat(f.rating)}<span className="text-salty-muted">{'☆'.repeat(5-f.rating)}</span></TableCell>
                      <TableCell className="max-w-sm"><p className="truncate text-sm">{f.message}</p></TableCell>
                      <TableCell><Badge variant="outline" className="text-xs">{f.status}</Badge></TableCell>
                      <TableCell className="text-salty-muted text-sm">{new Date(f.created_at).toLocaleDateString()}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function relativeTime(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins  <  1)  return 'Just now'
  if (mins  < 60)  return `${mins}m ago`
  if (hours < 24)  return `${hours}h ago`
  if (days  <  7)  return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-[13px] text-salty-muted shrink-0">{label}</span>
      <span className="text-[13px] text-right text-salty-text">{value}</span>
    </div>
  )
}

function Toggle({ on }: { on: boolean | null }) {
  if (on == null) return <span className="text-salty-muted">default</span>
  return <span className={on ? 'font-medium text-[#3E8A5A]' : 'text-salty-muted'}>{on ? 'On' : 'Off'}</span>
}

function PrivacyStat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-salty-muted">{label}</p>
      <p className="mt-0.5 text-[13.5px] text-salty-text">{value}</p>
    </div>
  )
}
