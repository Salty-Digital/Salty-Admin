export interface AdminUser {
  id: string
  email: string
  full_name: string | null
  access_level: 1 | 2 | 3 | 4
  /** Per-admin page allowlist (hrefs). null = unrestricted; see lib/pages.ts canAccessPage(). */
  allowed_pages: string[] | null
  is_active: boolean
  invited_by: string | null
  last_login_at: string | null
  created_at: string
}

export interface AppUser {
  id: string
  email: string
  username: string | null
  full_name: string | null
  avatar_url: string | null
  created_at: string
}

export interface Ticket {
  id: string
  user_id: string
  title: string | null
  venue_name: string | null
  date_str: string | null
  time_str: string | null
  seat: string | null
  category: string
  tint: string
  image_url: string
  confidence: number
  source: string
  status: string
  is_past: boolean
  created_at: string
}

export interface PendingImport {
  id: string
  user_id: string
  source: string
  status: 'pending' | 'approved' | 'rejected'
  confidence: number
  raw_data: {
    title: string | null
    venue: string | null
    date: string | null
    time: string | null
    seat: string | null
    category: string
    tint: string
    image_url: string
    subject: string
  }
  created_at: string
}

export interface Feedback {
  id: string
  user_id: string | null
  category: string
  rating: number
  message: string
  status: 'unread' | 'read' | 'actioned'
  created_at: string
}

export const ACCESS_LEVEL_LABELS: Record<number, string> = {
  1: 'Super Admin',
  2: 'Admin',
  3: 'Moderator',
  4: 'Support',
}
