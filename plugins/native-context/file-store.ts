import { promises as fs } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ClipboardDatabase, ClipboardDocument } from './index'

/** Clipboard documents have their own namespace and atomic files, never settings key validation. */
export function createClipboardFileStore(directory: string): ClipboardDatabase {
  let queue: Promise<unknown> = Promise.resolve()
  const filename = (id: string): string => {
    if (!/^CLIPBOARD\/[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new TypeError('Invalid clipboard document id')
    return path.join(directory, `${id.slice('CLIPBOARD/'.length)}.json`)
  }
  const get = async (id: string): Promise<ClipboardDocument | null> => {
    try {
      const value = JSON.parse(await fs.readFile(filename(id), 'utf8')) as ClipboardDocument
      if (value._id !== id) throw new Error('Clipboard document identity mismatch')
      return value
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  return {
    get,
    async put(document) {
      // Snapshot immediately: caller mutation must not race the queued disk write.
      const destination = filename(document._id)
      const content = JSON.stringify(document)
      const commit = queue.then(async () => {
        await fs.mkdir(directory, { recursive: true })
        const temporary = `${destination}.${randomUUID()}.tmp`
        try { await fs.writeFile(temporary, content, 'utf8'); await fs.rename(temporary, destination) }
        finally { await fs.rm(temporary, { force: true }) }
      })
      queue = commit.catch(() => {})
      return commit
    },
    async remove(id) {
      const destination = filename(id)
      const commit = queue.then(() => fs.rm(destination, { force: true }))
      queue = commit.catch(() => {})
      return commit
    },
    async allDocs(prefix) {
      if (prefix !== 'CLIPBOARD/') throw new TypeError('Invalid clipboard document prefix')
      await queue
      let names: string[]
      try { names = await fs.readdir(directory) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
      const documents: ClipboardDocument[] = []
      for (const name of names) {
        if (!/^[a-zA-Z0-9_-]{1,128}\.json$/.test(name)) continue
        const document = await get(`CLIPBOARD/${name.slice(0, -5)}`)
        if (document) documents.push(document)
      }
      return documents
    },
  }
}

/** Read only: settings owns the sole mutable settings document store. */
export async function readGeneralSettings(documentsPath: string): Promise<unknown> {
  try {
    const documents: unknown = JSON.parse(await fs.readFile(documentsPath, 'utf8'))
    if (!documents || typeof documents !== 'object' || Array.isArray(documents)) throw new TypeError('Invalid settings document store')
    return (documents as Record<string, unknown>)['settings-general'] ?? null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
