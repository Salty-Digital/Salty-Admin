#!/usr/bin/env node
/**
 * Builds the knowledge-base corpus the AI assistant reasons over.
 *
 * WHY A BUILD STEP: the deployed admin is a compiled Next.js app on Vercel — neither repo's source
 * is on disk at runtime, so the assistant cannot read files live. This script walks both repos
 * locally and emits a committed JSON snapshot, which ships with the build.
 *
 * WHAT IT EXTRACTS: structure and intent, not source. Each edge function contributes its name and
 * the leading doc comment (this codebase documents the "why" at the top of every function, which is
 * exactly what a question-answerer needs); migrations contribute filenames and their header
 * comment; docs contribute title + status. That keeps the corpus in the low tens of thousands of
 * tokens instead of the millions a full source dump would be, and keeps it useful — the headers say
 * why something exists, which the code itself usually does not.
 *
 * Re-run after meaningful changes:  npm run kb:index
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ADMIN = join(HERE, '..')
// Both repos sit side by side under .../Salty/. Overridable for a different layout.
const MOBILE = process.env.SALTY_MOBILE_PATH ?? join(ADMIN, '..', '..', 'salty-mobile')

const ls = (p) => (existsSync(p) ? readdirSync(p) : [])
const isDir = (p) => existsSync(p) && statSync(p).isDirectory()
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : '')

/**
 * The file's "why this exists" comment.
 *
 * Takes the FIRST comment block in the opening stretch of the file, whether it is a `//` run (the
 * edge functions' style) or a `/** *\/` block (the admin libs' style, which sits after the imports).
 * An earlier version only looked at line 1 and silently found nothing for 20 of 25 admin libs.
 */
function leadingComment(src, maxLines = 16) {
  const lines = src.split(/\r?\n/).slice(0, 60)

  // Block comment anywhere in the opening stretch.
  const start = lines.findIndex((l) => l.trim().startsWith('/*'))
  if (start !== -1) {
    const out = []
    for (const raw of lines.slice(start)) {
      const line = raw.trim()
      if (line.startsWith('/*') && line.length <= 3) continue
      const cleaned = line.replace(/^\/\*+\s?/, '').replace(/^\*+\/?\s?/, '').replace(/\*\/\s*$/, '')
      if (cleaned) out.push(cleaned)
      if (line.endsWith('*/') || out.length >= maxLines) break
    }
    if (out.length) return out.join(' ').replace(/\s+/g, ' ').trim().slice(0, 900)
  }

  // Otherwise the first run of `//` lines.
  const out = []
  for (const raw of lines) {
    const line = raw.trim()
    if (line.startsWith('//')) out.push(line.replace(/^\/\/\s?/, ''))
    else if (out.length > 0) break
    if (out.length >= maxLines) break
  }
  return out.join(' ').replace(/\s+/g, ' ').trim().slice(0, 900)
}

/** First `--` header block of a .sql migration. */
function sqlHeader(src, maxLines = 12) {
  const out = []
  for (const raw of src.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('--')) out.push(line.replace(/^--\s?/, ''))
    else if (out.length > 0) break
    if (out.length >= maxLines) break
  }
  return out.join(' ').replace(/\s+/g, ' ').trim().slice(0, 700)
}

// ── mobile: edge functions ───────────────────────────────────────────────────
const fnDir = join(MOBILE, 'supabase', 'functions')
const edgeFunctions = ls(fnDir)
  .filter((n) => !n.startsWith('_') && isDir(join(fnDir, n)))
  .map((name) => {
    const index = read(join(fnDir, name, 'index.ts'))
    const core = read(join(fnDir, name, 'core.ts'))
    return {
      name,
      purpose: leadingComment(index) || leadingComment(core),
      hasCore: !!core,
      // Which providers it touches — answers "what calls Ticketmaster?" directly.
      providers: [...new Set(
        [...`${index}${core}`.matchAll(/external_api:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]),
      )],
    }
  })
  .filter((f) => f.purpose)

// ── mobile: shared helpers ───────────────────────────────────────────────────
const sharedDir = join(fnDir, '_shared')
const sharedModules = ls(sharedDir)
  .filter((n) => n.endsWith('.ts') && !n.includes('.test.'))
  .map((n) => ({ name: n, purpose: leadingComment(read(join(sharedDir, n))) }))
  .filter((m) => m.purpose)

// ── migrations, both repos ───────────────────────────────────────────────────
function migrations(root, label) {
  const dir = join(root, 'supabase', 'migrations')
  return ls(dir)
    .filter((n) => n.endsWith('.sql'))
    .sort()
    .map((n) => ({ repo: label, file: n, summary: sqlHeader(read(join(dir, n))) }))
}

// ── mobile: planning docs ────────────────────────────────────────────────────
const docsDir = join(MOBILE, 'docs')
const planningDocs = ls(docsDir)
  .filter((n) => n.endsWith('.md'))
  .map((n) => {
    const src = read(join(docsDir, n))
    const title = (src.match(/^#\s+(.+)$/m) ?? [])[1] ?? basename(n, '.md')
    const status = (src.match(/^\**Status:?\**\s*(.+)$/im) ?? src.match(/^>\s*Status:?\s*(.+)$/im) ?? [])[1] ?? ''
    return { file: n, title: title.trim(), status: status.replace(/\*/g, '').trim().slice(0, 220) }
  })

// ── mobile: legal / compliance docs ──────────────────────────────────────────
// Separate from planningDocs on purpose: these are high-stakes (COPPA, GDPR-K, privacy labels,
// CASA) and answered today by opening files. Walked recursively — docs/legal has subfolders.
function walkMarkdown(dir, depth = 0) {
  if (depth > 3) return []
  const out = []
  for (const entry of ls(dir)) {
    const full = join(dir, entry)
    if (isDir(full)) out.push(...walkMarkdown(full, depth + 1))
    else if (entry.endsWith('.md')) out.push(full)
  }
  return out
}
const legalDir = join(MOBILE, 'docs', 'legal')
const legalDocs = walkMarkdown(legalDir).map((full) => {
  const src = read(full)
  const title = (src.match(/^#\s+(.+)$/m) ?? [])[1] ?? basename(full, '.md')
  // Headings carry the shape of a compliance doc better than a prose excerpt would.
  const headings = [...src.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 14)
  return {
    file: full.slice(full.indexOf('docs')).replace(/\\/g, '/'),
    title: title.trim().slice(0, 140),
    headings,
  }
})

// ── mobile: app surface ──────────────────────────────────────────────────────
const modulesDir = join(MOBILE, 'modules')
const appModules = ls(modulesDir).filter((n) => isDir(join(modulesDir, n)))

// ── admin: libs + routes ─────────────────────────────────────────────────────
const libDir = join(ADMIN, 'lib')
const adminLibs = ls(libDir)
  .filter((n) => n.endsWith('.ts') && !n.includes('.test.'))
  .map((n) => ({ name: n, purpose: leadingComment(read(join(libDir, n))) }))
  .filter((m) => m.purpose)

function routeWalk(dir, prefix = '') {
  const out = []
  for (const entry of ls(dir)) {
    const full = join(dir, entry)
    if (!isDir(full)) continue
    if (entry.startsWith('_')) continue
    const seg = entry.startsWith('(') ? '' : `/${entry}`
    if (existsSync(join(full, 'page.tsx'))) out.push(`${prefix}${seg}` || '/')
    out.push(...routeWalk(full, `${prefix}${seg}`))
  }
  return out
}
const adminRoutes = [...new Set(routeWalk(join(ADMIN, 'app')))].sort()

const corpus = {
  generatedAt: new Date().toISOString(),
  repos: {
    mobile: { path: 'salty-mobile', role: 'Expo app + every edge function + the database schema' },
    admin: { path: 'Salty-Admin', role: 'Next.js control plane reading the same Supabase project' },
  },
  edgeFunctions,
  sharedModules,
  migrations: [...migrations(MOBILE, 'salty-mobile'), ...migrations(ADMIN, 'Salty-Admin')],
  planningDocs,
  legalDocs,
  appModules,
  adminLibs,
  adminRoutes,
}

const outDir = join(ADMIN, 'lib', 'kb')
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, 'corpus.generated.json')
writeFileSync(outFile, JSON.stringify(corpus, null, 2) + '\n', 'utf8')

const approxTokens = Math.round(JSON.stringify(corpus).length / 4)
console.log(`Wrote ${outFile}`)
console.log(
  `  ${edgeFunctions.length} edge functions · ${sharedModules.length} shared modules · ` +
  `${corpus.migrations.length} migrations · ${planningDocs.length} docs · ` +
  `${legalDocs.length} legal docs · ${adminRoutes.length} admin routes · ${adminLibs.length} admin libs`,
)
console.log(`  ~${approxTokens.toLocaleString()} tokens of context`)
if (!existsSync(fnDir)) {
  console.warn(`\n  WARNING: salty-mobile not found at ${MOBILE} — set SALTY_MOBILE_PATH.`)
}
