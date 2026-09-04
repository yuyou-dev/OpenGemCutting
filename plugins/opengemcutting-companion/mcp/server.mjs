#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import readline from 'node:readline'

const SERVER_VERSION = '0.1.0'
const REPOSITORY = 'yuyou-dev/OpenGemCutting'
const HUB_URI = 'ui://opengemcutting/community-hub/v1.html'
const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app'
const DISCUSSIONS_WARNING = 'GitHub Discussions are not enabled for this repository yet. Issues and Pull Requests remain available.'
const DISCUSSION_CATEGORIES = new Set(['Ideas', 'Q&A', 'Show and tell'])
const ONBOARDING_STEPS = [
  'Open https://github.com/signup in a browser.',
  'Create a free personal account with an email address and public username.',
  'Personally complete CAPTCHA and email verification; never share codes with Codex.',
  'Enable two-factor authentication and store recovery codes privately.',
  'Return to Codex, run gh auth login --web, and verify with gh auth status.',
]
const hubHtml = readFileSync(new URL('./community-hub.html', import.meta.url), 'utf8')
const stagedDrafts = new Map()

function run(command, args, timeout = 15000) {
  return spawnSync(command, args, { encoding: 'utf8', timeout })
}

function githubStatus() {
  const version = run('gh', ['--version'], 3000)
  if (version.error?.code === 'ENOENT') return { state: 'missing_cli', label: 'GitHub CLI is not installed' }

  const auth = run('gh', ['auth', 'status'], 5000)
  if (auth.status !== 0) return { state: 'signed_out', label: 'GitHub account is not connected' }

  const login = run('gh', ['api', 'user', '--jq', '.login'], 5000)
  return {
    state: 'ready',
    label: 'GitHub is connected',
    login: login.status === 0 ? login.stdout.trim() : undefined,
  }
}

const DISCUSSIONS_QUERY = `query($owner:String!,$name:String!,$first:Int!){
  repository(owner:$owner,name:$name){
    discussions(first:$first,orderBy:{field:UPDATED_AT,direction:DESC}){
      nodes{number title url updatedAt isAnswered category{name} author{login} comments{totalCount}}
    }
  }
}`

function listDiscussions(limit = 20) {
  const status = githubStatus()
  if (status.state !== 'ready') return { status, discussions: [] }

  const availability = run('gh', [
    'repo', 'view', REPOSITORY,
    '--json', 'hasDiscussionsEnabled',
    '--jq', '.hasDiscussionsEnabled',
  ], 5000)
  if (availability.status === 0 && availability.stdout.trim() === 'false') {
    return { status, discussions: [], warning: DISCUSSIONS_WARNING }
  }

  const result = run('gh', [
    'api', 'graphql',
    '-f', `query=${DISCUSSIONS_QUERY}`,
    '-F', 'owner=yuyou-dev',
    '-F', 'name=OpenGemCutting',
    '-F', `first=${Math.max(1, Math.min(Number(limit) || 20, 50))}`,
  ])
  if (result.status !== 0) return { status, discussions: [], warning: DISCUSSIONS_WARNING }

  try {
    const parsed = JSON.parse(result.stdout)
    const discussions = parsed.data?.repository?.discussions?.nodes
    if (!Array.isArray(discussions)) return { status, discussions: [], warning: DISCUSSIONS_WARNING }
    return { status, discussions }
  } catch {
    return { status, discussions: [], warning: 'Unable to read GitHub Discussions. Issues and Pull Requests remain available.' }
  }
}

function hubResult(arguments_ = {}, loadDiscussions = listDiscussions) {
  const data = loadDiscussions(arguments_.limit)
  const mode = ['community', 'onboarding', 'contribute'].includes(arguments_.mode) ? arguments_.mode : 'community'
  const structuredContent = {
    repository: REPOSITORY,
    repositoryUrl: `https://github.com/${REPOSITORY}`,
    issuesUrl: `https://github.com/${REPOSITORY}/issues`,
    pullsUrl: `https://github.com/${REPOSITORY}/pulls`,
    discussionsUrl: `https://github.com/${REPOSITORY}/discussions`,
    signupUrl: 'https://github.com/signup',
    mode,
    onboardingSteps: ONBOARDING_STEPS,
    textualFallback: 'Draft in conversation, stage the exact final content, show the preview, obtain explicit confirmation, then publish only the single-use approval ID. Pull Requests use a reviewed fork and branch workflow.',
    ...data,
  }
  return {
    structuredContent,
    content: [{
      type: 'text',
      text: data.warning
        ? `OpenGemCutting community hub loaded. ${data.warning}`
        : `OpenGemCutting community hub loaded with ${data.discussions.length} recent discussions.`,
    }],
    _meta: {
      ui: { resourceUri: HUB_URI },
      'openai/outputTemplate': HUB_URI,
    },
  }
}

const hubTool = {
  name: 'open_opengemcutting_hub',
  title: 'Open OpenGemCutting community hub',
  description: 'Open a compact OpenGemCutting community UI for GitHub onboarding, public feedback routing, and contribution drafting. The UI does not publish directly.',
  inputSchema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['community', 'onboarding', 'contribute'] },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
  _meta: {
    ui: { resourceUri: HUB_URI },
    'openai/outputTemplate': HUB_URI,
    'openai/toolInvocation/invoking': '正在打开 OpenGemCutting 社区',
    'openai/toolInvocation/invoked': 'OpenGemCutting 社区已就绪',
  },
}

const statusTool = {
  name: 'check_opengemcutting_github',
  title: 'Check OpenGemCutting GitHub connection',
  description: 'Check whether GitHub CLI is installed and authenticated without reading credential files.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true, openWorldHint: false },
}

const stageTool = {
  name: 'stage_opengemcutting_community_draft',
  title: 'Stage an OpenGemCutting community draft',
  description: 'Lock one exact Discussion, Discussion reply, or Issue draft and return a preview plus a single-use approval ID. This performs no external write.',
  inputSchema: {
    type: 'object',
    required: ['kind', 'body'],
    properties: {
      kind: { type: 'string', enum: ['discussion', 'reply', 'issue'] },
      title: { type: 'string', minLength: 1, maxLength: 160 },
      body: { type: 'string', minLength: 1 },
      category: { type: 'string', enum: ['Ideas', 'Q&A', 'Show and tell'] },
      discussionNumber: { type: 'integer', minimum: 1 },
      label: { type: 'string', description: 'Optional existing GitHub Issue label.' },
    },
    allOf: [
      { if: { properties: { kind: { const: 'discussion' } } }, then: { required: ['title', 'category'] } },
      { if: { properties: { kind: { const: 'reply' } } }, then: { required: ['discussionNumber'] } },
      { if: { properties: { kind: { const: 'issue' } } }, then: { required: ['title'] } },
    ],
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
}

const publishTool = {
  name: 'publish_opengemcutting_community_draft',
  title: 'Publish an approved OpenGemCutting community draft',
  description: 'Publish one unchanged staged draft by its single-use approval ID. Call only after showing the staged preview and receiving explicit user confirmation.',
  inputSchema: {
    type: 'object',
    required: ['approvalId'],
    properties: { approvalId: { type: 'string', minLength: 1 } },
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}

function validateDraft(draft) {
  if (!['discussion', 'reply', 'issue'].includes(draft.kind)) throw new Error('Unsupported community draft kind')
  if (typeof draft.body !== 'string' || !draft.body.trim()) throw new Error('Draft body is required')
  if (draft.kind !== 'reply' && (typeof draft.title !== 'string' || !draft.title.trim())) throw new Error('Draft title is required')
  if (draft.kind === 'discussion' && !DISCUSSION_CATEGORIES.has(draft.category)) throw new Error('Unsupported Discussion category')
  if (draft.kind === 'reply' && (!Number.isInteger(draft.discussionNumber) || draft.discussionNumber < 1)) throw new Error('Discussion number is required')
}

function buildPublishArgs(draft) {
  validateDraft(draft)
  if (draft.kind === 'discussion') {
    return ['discussion', 'create', '--repo', REPOSITORY, '--title', draft.title, '--body', draft.body, '--category', draft.category]
  }
  if (draft.kind === 'reply') {
    return ['discussion', 'comment', String(draft.discussionNumber), '--repo', REPOSITORY, '--body', draft.body]
  }
  const args = ['issue', 'create', '--repo', REPOSITORY, '--title', draft.title, '--body', draft.body]
  if (draft.label) args.push('--label', draft.label)
  return args
}

function stageDraft(arguments_, now = Date.now()) {
  validateDraft(arguments_)
  buildPublishArgs(arguments_)
  const approvalId = randomUUID()
  const expiresAt = now + 30 * 60 * 1000
  const preview = { ...arguments_ }
  stagedDrafts.set(approvalId, { preview, expiresAt })
  return {
    structuredContent: { repository: REPOSITORY, approvalId, expiresAt, preview },
    content: [{
      type: 'text',
      text: `Staged OpenGemCutting ${preview.kind} draft ${approvalId}. Show this exact preview and wait for explicit confirmation before publishing.${['discussion', 'reply'].includes(preview.kind) ? `\nAvailability note: publication will verify that Discussions are enabled; if disabled, preserve this draft or explicitly restage it as an Issue.` : ''}\n${preview.title ? `Title: ${preview.title}\n` : ''}${preview.category ? `Category: ${preview.category}\n` : ''}${preview.discussionNumber ? `Discussion: #${preview.discussionNumber}\n` : ''}Body:\n${preview.body}`,
    }],
  }
}

function takeStagedDraft(approvalId, now = Date.now()) {
  const staged = stagedDrafts.get(approvalId)
  stagedDrafts.delete(approvalId)
  if (!staged) throw new Error('Unknown or already-used approval ID; stage the draft again')
  if (staged.expiresAt < now) throw new Error('Approval ID expired; stage and preview the draft again')
  return staged.preview
}

function publishDraft({ approvalId }, dependencies = {}) {
  const statusCheck = dependencies.githubStatus || githubStatus
  const discussionCheck = dependencies.listDiscussions || listDiscussions
  const runCommand = dependencies.run || run
  const status = statusCheck()
  if (status.state !== 'ready') throw new Error('Connect a GitHub account before publishing')
  const staged = stagedDrafts.get(approvalId)
  if (!staged) throw new Error('Unknown or already-used approval ID; stage the draft again')
  if (['discussion', 'reply'].includes(staged.preview.kind)) {
    const availability = discussionCheck(1)
    if (availability.warning) throw new Error(`${DISCUSSIONS_WARNING} Preserve the staged draft or explicitly restage it as an Issue.`)
  }
  const draft = takeStagedDraft(approvalId)
  const result = runCommand('gh', buildPublishArgs(draft), 30000)
  if (result.status !== 0) throw new Error(result.stderr.trim().split('\n')[0] || 'GitHub rejected the publication')
  const output = result.stdout.trim()
  const url = output.match(/https:\/\/github\.com\/[^\s]+/)?.[0]
  return {
    structuredContent: { repository: REPOSITORY, kind: draft.kind, url, output },
    content: [{ type: 'text', text: url ? `Published to OpenGemCutting: ${url}` : `Published to OpenGemCutting. ${output}` }],
  }
}

const TOOL_REGISTRY = [
  { descriptor: hubTool, run: hubResult },
  {
    descriptor: statusTool,
    run: () => {
      const status = githubStatus()
      return {
        structuredContent: { repository: REPOSITORY, status },
        content: [{ type: 'text', text: status.login ? `${status.label} as ${status.login}.` : `${status.label}.` }],
      }
    },
  },
  { descriptor: stageTool, run: stageDraft },
  { descriptor: publishTool, run: publishDraft },
]

const RESOURCE_REGISTRY = [{
  uri: HUB_URI,
  name: 'OpenGemCutting community hub',
  description: 'Community status, GitHub onboarding, and contribution draft composer.',
  html: hubHtml,
}]

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function errorResult(error) {
  return { isError: true, content: [{ type: 'text', text: `OpenGemCutting Companion: ${error.message}` }] }
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0' || message.method?.startsWith('notifications/')) return
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'opengemcutting_companion', version: SERVER_VERSION },
        instructions: 'Use open_opengemcutting_hub for the visual community. The UI never publishes. Stage exact final content, show the preview, wait for explicit confirmation, then publish only the single-use approval ID. Pull Requests use the contribution skill and GitHub fork workflow.',
      },
    })
    return
  }
  if (message.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: message.id, result: { tools: TOOL_REGISTRY.map(({ descriptor }) => descriptor) } })
    return
  }
  if (message.method === 'tools/call') {
    const entry = TOOL_REGISTRY.find(({ descriptor }) => descriptor.name === message.params?.name)
    if (!entry) return send({ jsonrpc: '2.0', id: message.id, result: errorResult(new Error('unknown tool')) })
    try {
      send({ jsonrpc: '2.0', id: message.id, result: await entry.run(message.params?.arguments || {}) })
    } catch (error) {
      send({ jsonrpc: '2.0', id: message.id, result: errorResult(error) })
    }
    return
  }
  if (message.method === 'resources/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { resources: RESOURCE_REGISTRY.map(({ uri, name, description }) => ({ uri, name, description, mimeType: RESOURCE_MIME_TYPE })) },
    })
    return
  }
  if (message.method === 'resources/read') {
    const resource = RESOURCE_REGISTRY.find((entry) => entry.uri === message.params?.uri)
    if (!resource) return send({ jsonrpc: '2.0', id: message.id, error: { code: -32002, message: 'resource not found' } })
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        contents: [{
          uri: resource.uri,
          mimeType: RESOURCE_MIME_TYPE,
          text: resource.html,
          _meta: {
            ui: { prefersBorder: false, csp: { connectDomains: [], resourceDomains: [] } },
            'openai/widgetPrefersBorder': false,
            'openai/widgetCSP': { connect_domains: [], resource_domains: [], redirect_domains: ['https://github.com'] },
          },
        }],
      },
    })
    return
  }
  send({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32601, message: `method not found: ${message.method}` } })
}

export {
  buildPublishArgs,
  DISCUSSIONS_WARNING,
  githubStatus,
  handle,
  hubResult,
  listDiscussions,
  ONBOARDING_STEPS,
  RESOURCE_MIME_TYPE,
  RESOURCE_REGISTRY,
  SERVER_VERSION,
  publishDraft,
  stageDraft,
  takeStagedDraft,
  TOOL_REGISTRY,
}

const directRun = process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))
if (directRun) {
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return
    try {
      handle(JSON.parse(line)).catch((error) => send({ jsonrpc: '2.0', id: null, error: { code: -32603, message: error.message } }))
    } catch (error) {
      send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: error.message } })
    }
  })
}
