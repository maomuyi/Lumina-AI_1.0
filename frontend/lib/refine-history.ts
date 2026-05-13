export type NumericLightroomParams = Record<string, number>

export interface RefineReportSnapshot {
  score: {
    total: number
    grade: "S" | "A" | "B" | "C" | "D"
    tag: string
    title: string
    subtitle: string
    confidence: string
    dimensions: {
      label: string
      value: number
      note: string
    }[]
  }
  thinkingSteps: {
    label: string
    completed: boolean
  }[]
  module1: {
    headline: string
    summary: string
    cards: {
      title: string
      value: string
      description: string
      status: "good" | "warning" | "danger"
    }[]
  }
  module2: {
    headline: string
    description: string
    metrics: {
      label: string
      value: string
      note: string
    }[]
    riskItems: {
      label: string
      value: string
      severity: "safe" | "warning" | "danger"
      note: string
    }[]
  }
  module3: {
    headline: string
    description: string
    coreActions: {
      param: string
      value: string
      reason: string
    }[]
  }
}

export interface ChangedParam {
  key: string
  before: number
  after: number
  reason?: string
}

export type RefineVersion = {
  id: string
  parentId?: string
  userIntent: string
  assistantSummary: string
  changedParams: ChangedParam[]
  params?: NumericLightroomParams
  reportSummary: string
  report?: RefineReportSnapshot
  downloadUrl: string
  createdAt: string
}

export interface RefineBaseVersion {
  id: "V1"
  params: NumericLightroomParams
  report?: RefineReportSnapshot
  downloadUrl: string
  createdAt: string
}

export interface RefineHistoryState {
  sessionId: string
  baseVersion: RefineBaseVersion
  versions: RefineVersion[]
  currentVersionId: string
  redoVersionId?: string | null
  sceneLabel?: string
  quickChips: string[]
  updatedAt: string
  expiresAt: string
}

const DB_NAME = "lumina-refine-history"
const STORE_NAME = "histories"
const DB_VERSION = 1
const TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_REFINES = 50
const LAST_SESSION_KEY = "lumina:last-refine-session-id"

function nowIso(): string {
  return new Date().toISOString()
}

function expiresAtIso(): string {
  return new Date(Date.now() + TTL_MS).toISOString()
}

function parseVersionNumber(versionId: string): number | null {
  const match = /^V(\d+)$/.exec(versionId)
  return match ? Number(match[1]) : null
}

export function getNextRefineVersionId(history: RefineHistoryState): string {
  const maxVersion = history.versions.reduce((max, version) => {
    const value = parseVersionNumber(version.id)
    return value ? Math.max(max, value) : max
  }, 1)
  return `V${maxVersion + 1}`
}

function getLatestChildVersionId(history: RefineHistoryState, parentId: string): string | null {
  const child = [...history.versions]
    .reverse()
    .find((version) => version.parentId === parentId)
  return child?.id ?? null
}

function getSequentialNextVersionId(history: RefineHistoryState, versionId: string): string | null {
  if (versionId === history.baseVersion.id) return history.versions[0]?.id ?? null

  const versionIndex = history.versions.findIndex((version) => version.id === versionId)
  if (versionIndex < 0) return null

  return history.versions[versionIndex + 1]?.id ?? null
}

function isBrowserStorageAvailable(): boolean {
  return typeof window !== "undefined" && typeof window.indexedDB !== "undefined"
}

function openHistoryDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "sessionId" })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"))
  })
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | void> {
  if (!isBrowserStorageAvailable()) return undefined

  const db = await openHistoryDb()
  return new Promise<T | void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)
    const request = run(store)

    if (request) {
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"))
    } else {
      tx.oncomplete = () => resolve(undefined)
    }

    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"))
    tx.oncomplete = () => {
      if (!request) resolve(undefined)
    }
  }).finally(() => db.close())
}

function trimForPersistence(history: RefineHistoryState): RefineHistoryState {
  if (history.versions.length <= MAX_REFINES) return history

  const versions = history.versions.slice(-MAX_REFINES)
  const firstKept = versions[0]
  const rebaseVersionId = firstKept.parentId ?? history.baseVersion.id
  const rebasedBaseParams = rebuildParamsForVersion(history, rebaseVersionId)
  const rebasedBaseDownloadUrl = getVersionDownloadUrl(history, rebaseVersionId)
  const currentVersionRetained =
    history.currentVersionId === history.baseVersion.id ||
    versions.some((version) => version.id === history.currentVersionId)
  const redoVersionRetained = history.redoVersionId
    ? versions.some((version) => version.id === history.redoVersionId)
    : history.redoVersionId

  return {
    ...history,
    baseVersion: {
      ...history.baseVersion,
      params: rebasedBaseParams,
      downloadUrl: rebasedBaseDownloadUrl,
    },
    versions: versions.map((version, index) =>
      index === 0 ? { ...version, parentId: history.baseVersion.id } : version
    ),
    currentVersionId: currentVersionRetained ? history.currentVersionId : history.baseVersion.id,
    redoVersionId: redoVersionRetained ? history.redoVersionId : null,
  }
}

export function createRefineHistory(
  sessionId: string,
  params: NumericLightroomParams,
  downloadUrl: string,
  quickChips: string[] = [],
  sceneLabel?: string,
  report?: RefineReportSnapshot
): RefineHistoryState {
  const createdAt = nowIso()
  return {
    sessionId,
    baseVersion: {
      id: "V1",
      params,
      report,
      downloadUrl,
      createdAt,
    },
    versions: [],
    currentVersionId: "V1",
    sceneLabel,
    quickChips,
    updatedAt: createdAt,
    expiresAt: expiresAtIso(),
  }
}

export function appendRefineVersion(
  history: RefineHistoryState,
  input: {
    parentId: string
    userIntent: string
    assistantSummary: string
    changedParams: ChangedParam[]
    params: NumericLightroomParams
    reportSummary: string
    report?: RefineReportSnapshot
    downloadUrl: string
  }
): RefineHistoryState {
  const id = getNextRefineVersionId(history)
  const createdAt = nowIso()
  const version: RefineVersion = {
    id,
    parentId: input.parentId,
    userIntent: input.userIntent,
    assistantSummary: input.assistantSummary,
    changedParams: input.changedParams,
    params: { ...input.params },
    reportSummary: input.reportSummary,
    report: input.report,
    downloadUrl: input.downloadUrl,
    createdAt,
  }

  return {
    ...history,
    versions: [...history.versions, version],
    currentVersionId: id,
    redoVersionId: null,
    updatedAt: createdAt,
    expiresAt: expiresAtIso(),
  }
}

export function updateHistoryScene(
  history: RefineHistoryState,
  sceneLabel?: string,
  quickChips: string[] = []
): RefineHistoryState {
  return {
    ...history,
    sceneLabel: sceneLabel ?? history.sceneLabel,
    quickChips: quickChips.length ? quickChips : history.quickChips,
    updatedAt: nowIso(),
    expiresAt: expiresAtIso(),
  }
}

export function diffNumericParams(
  before: NumericLightroomParams,
  after: NumericLightroomParams
): ChangedParam[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)])
  return [...keys]
    .sort()
    .flatMap((key) => {
      const beforeValue = before[key]
      const afterValue = after[key]
      if (!Number.isFinite(beforeValue) || !Number.isFinite(afterValue)) return []
      if (Math.abs(beforeValue - afterValue) < 0.01) return []
      return [{ key, before: beforeValue, after: afterValue }]
    })
}

export function rebuildParamsForVersion(
  history: RefineHistoryState,
  versionId = history.currentVersionId
): NumericLightroomParams {
  const params: NumericLightroomParams = { ...history.baseVersion.params }
  if (versionId === history.baseVersion.id) return params

  const byId = new Map(history.versions.map((version) => [version.id, version]))
  const targetVersion = byId.get(versionId)
  if (targetVersion?.params) return { ...targetVersion.params }

  const path: RefineVersion[] = []
  let current = targetVersion

  while (current) {
    path.unshift(current)
    if (!current.parentId || current.parentId === history.baseVersion.id) break
    current = byId.get(current.parentId)
  }

  for (const version of path) {
    for (const change of version.changedParams) {
      params[change.key] = change.after
    }
  }

  return params
}

export function getCurrentRefineVersion(history: RefineHistoryState | null): RefineVersion | null {
  if (!history || history.currentVersionId === history.baseVersion.id) return null
  return history.versions.find((version) => version.id === history.currentVersionId) ?? null
}

export function getParentVersionId(
  history: RefineHistoryState,
  versionId = history.currentVersionId
): string | null {
  if (versionId === history.baseVersion.id) return null
  const versionIndex = history.versions.findIndex((item) => item.id === versionId)
  if (versionIndex < 0) return null

  const version = history.versions[versionIndex]
  if (version.parentId) return version.parentId

  return versionIndex === 0 ? history.baseVersion.id : history.versions[versionIndex - 1].id
}

export function getForwardVersionId(
  history: RefineHistoryState,
  versionId = history.currentVersionId
): string | null {
  if (versionId === history.currentVersionId && history.redoVersionId) {
    const redoVersion = history.versions.find((version) => version.id === history.redoVersionId)
    if (redoVersion?.parentId === versionId) return redoVersion.id
    if (redoVersion?.id === getSequentialNextVersionId(history, versionId)) return redoVersion.id
  }

  return getLatestChildVersionId(history, versionId) ?? getSequentialNextVersionId(history, versionId)
}

export function getChildVersionId(history: RefineHistoryState, parentId: string): string | null {
  return getLatestChildVersionId(history, parentId) ?? getSequentialNextVersionId(history, parentId)
}

export function getVersionDownloadUrl(history: RefineHistoryState, versionId = history.currentVersionId): string {
  if (versionId === history.baseVersion.id) return history.baseVersion.downloadUrl
  return history.versions.find((version) => version.id === versionId)?.downloadUrl ?? history.baseVersion.downloadUrl
}

export function getVersionReport(
  history: RefineHistoryState,
  versionId = history.currentVersionId
): RefineReportSnapshot | null {
  if (versionId === history.baseVersion.id) return history.baseVersion.report ?? null
  return history.versions.find((version) => version.id === versionId)?.report ?? null
}

export function setCurrentRefineVersion(
  history: RefineHistoryState,
  versionId: string,
  options: { redoVersionId?: string | null } = {}
): RefineHistoryState {
  return {
    ...history,
    currentVersionId: versionId,
    redoVersionId:
      Object.prototype.hasOwnProperty.call(options, "redoVersionId")
        ? options.redoVersionId
        : history.redoVersionId,
    updatedAt: nowIso(),
    expiresAt: expiresAtIso(),
  }
}

export async function saveRefineHistory(history: RefineHistoryState): Promise<void> {
  if (!isBrowserStorageAvailable()) return
  const persisted = trimForPersistence(history)
  await withStore("readwrite", (store) => store.put(persisted))
  window.localStorage.setItem(LAST_SESSION_KEY, history.sessionId)
}

export async function loadRefineHistory(sessionId: string): Promise<RefineHistoryState | null> {
  if (!isBrowserStorageAvailable()) return null
  const history = await withStore<RefineHistoryState>("readonly", (store) => store.get(sessionId))
  if (!history) return null

  if (new Date(history.expiresAt).getTime() <= Date.now()) {
    await withStore("readwrite", (store) => store.delete(sessionId))
    return null
  }

  return {
    ...history,
    updatedAt: history.updatedAt ?? nowIso(),
    expiresAt: history.expiresAt ?? expiresAtIso(),
  }
}

export async function loadLastRefineHistory(): Promise<RefineHistoryState | null> {
  if (!isBrowserStorageAvailable()) return null
  const sessionId = window.localStorage.getItem(LAST_SESSION_KEY)
  return sessionId ? loadRefineHistory(sessionId) : null
}
