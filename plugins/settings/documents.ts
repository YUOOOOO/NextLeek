import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

// Plugin-owned JSON documents. Atomic replacement never acknowledges an unpersisted edit.
export class SettingsDocuments {
  private documents: Record<string, unknown>
  constructor(private readonly path: string) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('Invalid settings document store')
      this.documents = parsed as Record<string, unknown>
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.documents = {}
    }
  }
  keys(): string[] { return Object.keys(this.documents) }
  get(key: string): unknown { this.validateKey(key); return this.documents[key] === undefined ? null : structuredClone(this.documents[key]) }
  put(key: string, value: unknown): void {
    this.validateKey(key)
    const copy = JSON.parse(JSON.stringify(value))
    const next = { ...this.documents, [key]: copy }
    this.commit(next)
  }
  delete(key: string): void { this.validateKey(key); const next = { ...this.documents }; delete next[key]; this.commit(next) }
  clear(): void { this.commit({}) }
  private validateKey(key: string): void {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(key) || key === '__proto__' || key === 'constructor') throw new TypeError('Invalid document key')
  }
  private commit(next: Record<string, unknown>): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.tmp`
    writeFileSync(temporary, JSON.stringify(next), 'utf8')
    renameSync(temporary, this.path)
    this.documents = next
  }
}
