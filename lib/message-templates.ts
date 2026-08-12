/**
 * Pre-written email + push-notification templates for the admin Email and
 * Notifications pages. Picking one pre-fills the composer so common messages
 * don't have to be typed from scratch — edit the fields before sending.
 *
 * Text in [square brackets] is a placeholder: swap it for the real detail
 * before you send. Nothing here is substituted automatically.
 *
 * To add a template, append to the relevant array — the pickers pick it up
 * automatically. Email bodies use blank lines to separate paragraphs (the
 * branded renderer turns each blank-line-delimited block into a paragraph).
 */

export interface EmailTemplate {
  id: string
  /** Shown in the picker dropdown. */
  name: string
  subject: string
  body: string
}

const SCREENS = ['', 'tickets', 'friends', 'settings', 'feedback'] as const
export type NotifScreen = (typeof SCREENS)[number]

export interface NotificationTemplate {
  id: string
  /** Shown in the picker dropdown. */
  name: string
  title: string
  body: string
  /** Deep-link screen used by the single-user send (ignored for broadcasts). */
  screen?: NotifScreen
}

export const EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    id: 'welcome',
    name: 'Welcome to Salty',
    subject: 'Welcome to Salty 🎉',
    body: `Hey there,

Welcome to Salty — we're stoked to have you. Salty helps you discover the best live events near you, grab tickets, and keep up with the artists and friends you care about.

Here's how to get started:

• Browse what's on near you from the home screen
• Follow your favourite artists to get alerts when they announce shows
• Add friends to see the events they're going to

Have a question? Just reply to this email — a real human reads every one.

See you out there,
The Salty Team`,
  },
  {
    id: 'weekly-roundup',
    name: "What's new this week",
    subject: "What's new in Salty this week",
    body: `Hey,

Here's what's fresh in Salty this week:

• [Highlight one — a big event, drop, or feature]
• [Highlight two]
• [Highlight three]

Open the app to check it all out.

The Salty Team`,
  },
  {
    id: 'feature-announcement',
    name: 'New feature announcement',
    subject: 'New in Salty: [feature name]',
    body: `Hey there,

We just shipped [feature name] — [one line on what it does and why it's great].

[A sentence on how to try it.]

Update to the latest version to check it out, and let us know what you think.

The Salty Team`,
  },
  {
    id: 'event-reminder',
    name: 'Event reminder',
    subject: '[Event name] is coming up',
    body: `Hey,

Just a heads up — [event name] is happening on [date] at [venue].

Open Salty to see the details, get directions, and check who else is going.

Enjoy the show,
The Salty Team`,
  },
  {
    id: 're-engagement',
    name: 'We miss you (re-engagement)',
    subject: "There's a lot happening on Salty",
    body: `Hey,

It's been a minute! While you were away, plenty of new events dropped near you — concerts, comedy nights, and more.

Open Salty to see what's on this week. Your next great night out is a tap away.

The Salty Team`,
  },
  {
    id: 'feedback-request',
    name: 'Feedback request',
    subject: "Got 2 minutes? We'd love your feedback",
    body: `Hey,

Thanks for being part of Salty — you're helping shape the app.

We'd love to hear what's working, what's not, and what you wish Salty could do. Just reply to this email, or send feedback from Settings → Feedback in the app.

Every note goes straight to the team.

Thanks,
The Salty Team`,
  },
  {
    id: 'maintenance',
    name: 'Scheduled maintenance',
    subject: 'Scheduled maintenance on [date]',
    body: `Hey there,

We'll be doing some scheduled maintenance on [date] from [start time] to [end time] [timezone]. Salty may be briefly unavailable during this window while we make things faster and more reliable.

Thanks for your patience — we'll be back before you know it.

The Salty Team`,
  },
]

export const NOTIFICATION_TEMPLATES: NotificationTemplate[] = [
  {
    id: 'ticket-ready',
    name: 'Ticket ready',
    title: 'Your ticket is ready 🎟️',
    body: "It's in the app and ready to scan. Tap to view it.",
    screen: 'tickets',
  },
  {
    id: 'new-events',
    name: 'New events near you',
    title: 'New events near you',
    body: "Fresh shows just dropped in your area. Open Salty to see what's on.",
    screen: '',
  },
  {
    id: 'setlist',
    name: 'Setlist available',
    title: 'The setlist is in 🎶',
    body: 'See what [artist] played last night — tap for the full setlist.',
    screen: '',
  },
  {
    id: 'artist-alert',
    name: 'Artist announced a show',
    title: '[Artist] just announced a show',
    body: '[Artist] is playing near you. Grab tickets before they sell out.',
    screen: '',
  },
  {
    id: 'friend-activity',
    name: 'Friend activity',
    title: 'Your friends are making plans',
    body: 'See which events your friends are going to this week.',
    screen: 'friends',
  },
  {
    id: 'weekend-lineup',
    name: 'Weekend lineup',
    title: 'Your weekend, sorted',
    body: "Here's what's happening near you this weekend. Tap to explore.",
    screen: '',
  },
  {
    id: 'we-miss-you',
    name: 'We miss you',
    title: 'We miss you 👋',
    body: 'Loads of new events dropped near you. Come see what\'s on tonight.',
    screen: '',
  },
  {
    id: 'feedback',
    name: 'Feedback request',
    title: "How's it going?",
    body: "Got a minute? Tell us what you think of Salty — we're listening.",
    screen: 'feedback',
  },
]
