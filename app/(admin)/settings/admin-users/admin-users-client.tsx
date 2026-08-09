'use client'

import { useState, useTransition } from 'react'
import { Loader2, UserPlus, Shield, Trash2, KeyRound } from 'lucide-react'
import {
  inviteAdminAction, changeAccessLevelAction, toggleActiveAction, deleteAdminAction,
  setAdminPasswordAction,
} from './actions'
import { ACCESS_LEVEL_LABELS } from '@/types/admin'
import { useSort, SortHeader } from '@/components/ui/sortable'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

interface AdminRow {
  id: string
  email: string
  full_name: string | null
  access_level: number
  is_active: boolean
  last_login_at: string | null
  created_at: string
  invited_by_email?: string
}

const LEVEL_COLORS: Record<number, string> = {
  1: 'bg-ember-light text-ember',
  2: 'bg-[#EBF2FA] text-[#3A72A8]',
  3: 'bg-[#EAF4EE] text-[#3E8A5A]',
  4: 'bg-stone text-salty-muted',
}

const inputCls = 'w-full rounded-lg border border-salty-border bg-cream px-3 py-2 text-[13px] text-salty-text placeholder:text-salty-muted focus:border-ember focus:outline-none font-sans'
const labelCls = 'block text-[12px] font-semibold uppercase tracking-[0.06em] text-salty-muted mb-1.5'

export function AdminUsersClient({ rows, currentAdminId }: { rows: AdminRow[]; currentAdminId: string }) {
  const [showInvite, setShowInvite] = useState(false)
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [level, setLevel] = useState(4)
  const [result, setResult] = useState<{ type: 'success'|'error'; msg: string }|null>(null)
  const [pending, startTransition] = useTransition()

  const { sorted, sortState, requestSort } = useSort(rows, {
    admin: (r) => (r.full_name ?? r.email).toLowerCase(),
    level: (r) => r.access_level,
    status: (r) => (r.is_active ? 1 : 0),
    lastLogin: (r) => (r.last_login_at ? Date.parse(r.last_login_at) : null),
    invitedBy: (r) => (r.invited_by_email ?? '').toLowerCase(),
  })

  function invite() {
    if (!email || !fullName) return setResult({ type: 'error', msg: 'Email and name are required.' })
    setResult(null)
    startTransition(async () => {
      try {
        await inviteAdminAction(email, fullName, level)
        setResult({ type: 'success', msg: `${email} invited — they'll receive a password setup email.` })
        setEmail(''); setFullName(''); setLevel(4); setShowInvite(false)
      } catch (e) {
        setResult({ type: 'error', msg: (e as Error).message })
      }
    })
  }

  return (
    <div className="space-y-5">
      {/* Header actions */}
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-salty-muted">{rows.length} admin account{rows.length !== 1 ? 's' : ''}</p>
        <button
          onClick={() => setShowInvite(v => !v)}
          className="flex items-center gap-2 rounded-lg bg-ember px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#D44D15] transition-colors"
        >
          <UserPlus className="h-4 w-4" /> Invite Admin
        </button>
      </div>

      {/* Invite form */}
      {showInvite && (
        <div className="rounded-[14px] border border-salty-border bg-warm-white p-5 space-y-4 max-w-lg">
          <h3 className="font-sora text-[14px] font-bold text-salty-text">Invite new admin</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Email</label>
              <input value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@example.com" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Full Name</label>
              <input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Jane Smith" className={inputCls} />
            </div>
          </div>
          <div className="max-w-xs">
            <label className={labelCls}>Access Level</label>
            <select value={level} onChange={e => setLevel(Number(e.target.value))} className={inputCls}>
              {[2,3,4].map(l => <option key={l} value={l}>{l} — {ACCESS_LEVEL_LABELS[l]}</option>)}
            </select>
          </div>
          {result && (
            <div className={`rounded-lg border px-3 py-2.5 text-[13px] ${result.type === 'success' ? 'border-[#B8D9C5] bg-[#EAF4EE] text-[#3E8A5A]' : 'border-[#F0C4C4] bg-[#FDEDED] text-[#BF4A3A]'}`}>
              {result.msg}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={invite} disabled={pending} className="flex items-center gap-2 rounded-lg bg-ember px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#D44D15] disabled:opacity-60">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
              {pending ? 'Inviting…' : 'Send Invite'}
            </button>
            <button onClick={() => setShowInvite(false)} className="rounded-lg border border-salty-border px-4 py-2 text-[13px] text-salty-secondary hover:bg-cream">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-[14px] border border-salty-border bg-warm-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-salty-border bg-cream text-left text-[11px] font-semibold uppercase tracking-[0.06em] text-salty-muted">
              <SortHeader label="Admin" sortKey="admin" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
              <SortHeader label="Access Level" sortKey="level" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
              <SortHeader label="Status" sortKey="status" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
              <SortHeader label="Last Login" sortKey="lastLogin" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
              <SortHeader label="Invited By" sortKey="invitedBy" sortState={sortState} onSort={requestSort} className="px-4 py-3" />
              <th className="px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(row => (
              <AdminUserRow key={row.id} row={row} isSelf={row.id === currentAdminId} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AdminUserRow({ row, isSelf }: { row: AdminRow; isSelf: boolean }) {
  const [pending, startTransition] = useTransition()
  const initials = (row.full_name ?? row.email).slice(0, 2).toUpperCase()

  function changeLevel(val: string) {
    startTransition(() => changeAccessLevelAction(row.id, Number(val)))
  }
  function toggle() {
    startTransition(() => toggleActiveAction(row.id, !row.is_active))
  }

  return (
    <tr className="border-b border-salty-border last:border-0 hover:bg-cream">
      <td className="px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
            style={{ background: 'linear-gradient(135deg, #E8581A, #C8A96E)' }}>
            {initials}
          </div>
          <div>
            <p className="text-[13px] font-medium text-salty-text">{row.full_name ?? '—'}</p>
            <p className="text-[11px] text-salty-muted">{row.email}</p>
          </div>
          {isSelf && <span className="ml-1 rounded-full bg-ember-light px-2 py-0.5 text-[10px] font-semibold text-ember">You</span>}
        </div>
      </td>
      <td className="px-4 py-3">
        {isSelf ? (
          <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${LEVEL_COLORS[row.access_level]}`}>
            {ACCESS_LEVEL_LABELS[row.access_level]}
          </span>
        ) : (
          <select
            value={row.access_level}
            onChange={e => changeLevel(e.target.value)}
            disabled={pending}
            className="rounded-lg border border-salty-border bg-cream px-2 py-1 text-[12px] focus:border-ember focus:outline-none"
          >
            {[1,2,3,4].map(l => <option key={l} value={l}>{l} — {ACCESS_LEVEL_LABELS[l]}</option>)}
          </select>
        )}
      </td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${row.is_active ? 'bg-[#EAF4EE] text-[#3E8A5A]' : 'bg-[#FDEDED] text-[#BF4A3A]'}`}>
          {row.is_active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="px-4 py-3 text-[12px] text-salty-secondary">
        {row.last_login_at ? new Date(row.last_login_at).toLocaleDateString() : '—'}
      </td>
      <td className="px-4 py-3 text-[12px] text-salty-secondary">{row.invited_by_email ?? '—'}</td>
      <td className="px-4 py-3">
        {!isSelf && (
          <div className="flex items-center gap-1.5">
            <button
              onClick={toggle}
              disabled={pending}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-md border transition-colors ${
                row.is_active
                  ? 'border-[#F0C4C4] bg-[#FDEDED] text-[#BF4A3A] hover:bg-[#F5D0D0]'
                  : 'border-[#B8D9C5] bg-[#EAF4EE] text-[#3E8A5A] hover:bg-[#C9E8D6]'
              }`}
            >
              {pending ? '…' : row.is_active ? 'Deactivate' : 'Reactivate'}
            </button>
            <SetPasswordDialog adminId={row.id} adminEmail={row.email} />
            <DeleteAdminDialog adminId={row.id} adminEmail={row.email} />
          </div>
        )}
      </td>
    </tr>
  )
}

function SetPasswordDialog({ adminId, adminEmail }: { adminId: string; adminEmail: string }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [pending, startTransition] = useTransition()

  function submit() {
    if (password.length < 8) return setError('Password must be at least 8 characters.')
    if (password !== confirm) return setError('Passwords do not match.')
    setError(null)
    startTransition(async () => {
      try {
        await setAdminPasswordAction(adminId, password)
        setDone(true)
        setPassword(''); setConfirm('')
        setTimeout(() => { setOpen(false); setDone(false) }, 1200)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to set password.')
      }
    })
  }

  function reset(v: boolean) {
    setOpen(v)
    if (!v) { setPassword(''); setConfirm(''); setError(null); setDone(false) }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <button
          title="Set admin password"
          className="rounded-md border border-salty-border p-1.5 text-salty-muted transition-colors hover:bg-ember-light hover:text-ember hover:border-ember"
        >
          <KeyRound className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set admin password</DialogTitle>
          <DialogDescription>
            Sets the admin-panel password for <strong>{adminEmail}</strong>. This is separate from
            their Salty app account — it does not change any app password. They can change it later
            from their own profile page. Share it with them over a trusted channel.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <div>
            <label className={labelCls}>New password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="new-password"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Confirm password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              placeholder="Re-enter password"
              autoComplete="new-password"
              className={inputCls}
            />
          </div>
          {error && (
            <div className="rounded-lg border border-[#F0C4C4] bg-[#FDEDED] px-3 py-2.5 text-[13px] text-[#BF4A3A]">
              {error}
            </div>
          )}
          {done && (
            <div className="rounded-lg border border-[#B8D9C5] bg-[#EAF4EE] px-3 py-2.5 text-[13px] text-[#3E8A5A]">
              Password set.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={pending || done}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {pending ? 'Setting…' : 'Set password'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteAdminDialog({ adminId, adminEmail }: { adminId: string; adminEmail: string }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [auditBlock, setAuditBlock] = useState<{ auditCount: number } | null>(null)
  const [pending, startTransition] = useTransition()

  function attemptDelete(force: boolean) {
    setError(null)
    startTransition(async () => {
      try {
        const result = await deleteAdminAction(adminId, force)
        if (!result.ok) {
          setAuditBlock({ auditCount: result.auditCount })
          return
        }
        setOpen(false)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to delete admin.')
      }
    })
  }

  function reset(v: boolean) {
    setOpen(v)
    if (!v) { setError(null); setAuditBlock(null) }
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <button
          title="Delete admin"
          className="rounded-md border border-salty-border p-1.5 text-salty-muted transition-colors hover:bg-[#FDEDED] hover:text-[#BF4A3A] hover:border-[#F0C4C4]"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete admin account</DialogTitle>
          <DialogDescription>
            This will permanently remove <strong>{adminEmail}</strong> from the admin panel and delete their
            login credentials. They will lose all access immediately. This cannot be undone — invite them again
            if access needs to be restored later.
          </DialogDescription>
        </DialogHeader>

        {auditBlock && (
          <div className="rounded-lg border border-[#F0C4C4] bg-[#FDEDED] px-3 py-2.5 text-[13px] text-[#BF4A3A] space-y-1">
            <p className="font-semibold">
              This admin has {auditBlock.auditCount} audit log entr{auditBlock.auditCount === 1 ? 'y' : 'ies'}.
            </p>
            <p>
              Deleting anyway will also permanently erase {auditBlock.auditCount === 1 ? 'that entry' : 'those entries'} —
              there will be no record of what this admin did. Consider Deactivate instead if you just need to revoke access.
            </p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-[#F0C4C4] bg-[#FDEDED] px-3 py-2.5 text-[13px] text-[#BF4A3A]">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
          {auditBlock ? (
            <Button variant="destructive" onClick={() => attemptDelete(true)} disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {pending ? 'Deleting…' : `Delete anyway (purge ${auditBlock.auditCount})`}
            </Button>
          ) : (
            <Button variant="destructive" onClick={() => attemptDelete(false)} disabled={pending}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {pending ? 'Deleting…' : 'Delete permanently'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
