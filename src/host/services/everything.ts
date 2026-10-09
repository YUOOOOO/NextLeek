import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { EverythingAction, EverythingItem, EverythingSearchRequest } from '../../shared/contracts'
import { everythingAction, everythingResultId, everythingSearchRequest } from '../../shared/validation'
import type { EverythingService } from './contracts'

export interface EverythingEnvironment {
  executable: string
  platform?: NodeJS.Platform
  openPath(path: string): Promise<string>
  revealPath(path: string): void
  copyPath(path: string): void
}
interface ProcessOptions {
  encoding: 'utf8'
  windowsHide: boolean
  shell: false
  timeout: number
  maxBuffer: number
}
export interface EverythingPorts {
  execute(executable: string, args: string[], options: ProcessOptions, done: (error: Error | null, stdout: string) => void): { kill(): boolean }
  stat(path: string): Promise<{ isDirectory(): boolean }>
}

function failure(error: Error): Error {
  const code = (error as Error & { code?: string | number }).code
  if (code === 'ENOENT') return new Error('未找到随 NextLeek 安装的 ES.exe，请重新安装 NextLeek。')
  if (code === 8 || code === '8') return new Error('未连接到 Everything。请安装并启动 Everything，然后重试。')
  if (code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return new Error('Everything 返回的数据过大，请缩小搜索范围。')
  if ((error as Error & { killed?: boolean }).killed) return new Error('Everything 查询超时，请确认 Everything 已启动并完成索引。')
  return new Error(`Everything 查询失败：${error.message}`)
}

export function everythingArguments(request: EverythingSearchRequest): string[] {
  // ES 1.1.0.38: -argv decodes Windows argv quoting; -search consumes ONE
  // argument as query text, even if it begins with an ES option. Never use a shell.
  const args = ['-argv', '-json', '-code-page', '65001', '-date-format', '3', '-columns', 'name;path;filename;size;date-modified;attributes', '-no-folder-append-path-separator', '-timeout', '5000', '-n', String(request.limit + 1), '-offset', String(request.offset)]
  if (request.filter !== 'all') args.push(request.filter === 'folders' ? '/ad' : '/a-d')
  args.push('-sort', request.sort === 'modified' ? 'date-modified' : request.sort, request.descending ? '-sort-descending' : '-sort-ascending', '-search', request.query)
  return args
}

function parseResults(stdout: string): Array<Omit<EverythingItem, 'id'> & { attributes: number | null }> {
  // ES emits no JSON bytes at all for an empty result set.
  const text = stdout.replace(/^\uFEFF/, '').trim()
  const records: unknown = text ? JSON.parse(text) : []
  if (!Array.isArray(records)) throw new Error('Everything 返回了无效的结果数据。')
  return records.map((record: unknown) => {
    if (!record || typeof record !== 'object') throw new Error('Everything 返回了无效的结果数据。')
    const row = record as Record<string, unknown>
    const rawPath = typeof row.path === 'string' ? row.path.replaceAll('/', '\\') : ''
    const rawFilename = typeof row.filename === 'string' ? row.filename.replaceAll('/', '\\') : ''
    const rawName = typeof row.name === 'string' ? row.name : ''
    const path = rawFilename ? (win32.isAbsolute(rawFilename) ? win32.normalize(rawFilename) : '') : win32.isAbsolute(rawPath) && rawName ? win32.join(rawPath, rawName) : ''
    const name = rawName || (path ? path.slice(path.lastIndexOf('\\') + 1) : '')
    if (!win32.isAbsolute(path) || /[\u0000-\u001f]/.test(path) || !name) throw new Error(`Everything 返回了无效的文件路径：${JSON.stringify({ path: rawPath, filename: rawFilename, name: rawName })}`)
    const attributes = row.attributes
    if (attributes !== null && (!Number.isInteger(attributes) || (attributes as number) < 0)) throw new Error('Everything 返回了无效的文件属性。')
    const size = row.size
    if (size !== null && (typeof size !== 'number' || !Number.isFinite(size) || size < 0)) throw new Error('Everything 返回了无效的文件大小。')
    const modifiedAt = row.date_modified
    if (modifiedAt !== null && (typeof modifiedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(modifiedAt) || !Number.isFinite(Date.parse(modifiedAt)))) throw new Error('Everything 返回了无效的修改时间。')
    return { name, path, isDirectory: attributes !== null && ((attributes as number) & 0x10) !== 0, size: size as number | null, modifiedAt: modifiedAt as string | null, attributes: attributes as number | null }
  })
}

export function createEverythingService(ctx: Context, environment?: EverythingEnvironment, ports: EverythingPorts = {
  execute: (executable, args, options, done) => execFile(executable, args, options, (error, stdout) => done(error, stdout)),
  stat,
}): EverythingService {
  const authorized = new Map<string, string>()
  let disposed = false
  let active = 0
  ctx.effect(() => () => { disposed = true; authorized.clear() }, 'Everything authorization')
  function supported() {
    if (disposed) throw new Error('Everything 服务已关闭。')
    if (!environment || (environment.platform ?? process.platform) !== 'win32') throw new Error('Everything 文件搜索仅支持 Windows。')
    return environment
  }
  async function execute(args: string[]): Promise<string> {
    const env = supported()
    if (active >= 4) throw new Error('Everything 搜索繁忙，请稍后重试。')
    let cleanup: (() => unknown) | undefined
    let settled = false
    active++
    try {
      return await new Promise<string>((resolve, reject) => {
        cleanup = ctx.effect(() => {
          const child = ports.execute(env.executable, args, { encoding: 'utf8', windowsHide: true, shell: false, timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
            if (settled) return
            settled = true
            if (error) reject(failure(error))
            else resolve(stdout)
          })
          return () => {
            if (settled) return
            settled = true
            child.kill()
            reject(new Error('Everything 服务已关闭，查询已取消。'))
          }
        }, 'Everything ES subprocess')
      })
    } finally {
      active--
      await cleanup?.()
    }
  }
  return {
    async getStatus() {
      if (!environment || (environment.platform ?? process.platform) !== 'win32') return { status: 'unsupported', message: 'Everything 文件搜索仅支持 Windows。' }
      try {
        const version = (await execute(['-argv', '-get-everything-version'])).trim()
        if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) throw new Error('未能读取 Everything 版本，请启动 Everything 后重试。')
        return { status: 'ready', message: '已连接正在运行的 Everything 索引。', version }
      } catch (error) { return { status: 'unavailable', message: error instanceof Error ? error.message : String(error) } }
    },
    async search(request) {
      const validated = everythingSearchRequest(request)
      const rows = parseResults(await execute(everythingArguments(validated)))
      if (rows.length > validated.limit + 1) throw new Error('Everything 返回了超出请求范围的结果。')
      const items: EverythingItem[] = []
      for (const row of rows.slice(0, validated.limit)) {
        if (row.attributes === null) {
          try { row.isDirectory = (await ports.stat(row.path)).isDirectory() }
          catch (error) {
            if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) continue
            throw new Error(`无法确定 Everything 结果的文件类型：${row.path}`)
          }
        }
        if (disposed) throw new Error('Everything 服务已关闭。')
        const id = randomUUID()
        authorized.set(id, row.path)
        while (authorized.size > 1000) authorized.delete(authorized.keys().next().value!)
        items.push({ id, name: row.name, path: row.path, isDirectory: row.isDirectory, size: row.isDirectory ? null : row.size, modifiedAt: row.modifiedAt })
      }
      return { items, hasMore: rows.length > validated.limit, offset: validated.offset }
    },
    async performAction(id: string, action: EverythingAction) {
      const env = supported()
      everythingResultId(id)
      everythingAction(action)
      const path = authorized.get(id)
      if (!path) throw new Error('该搜索结果已失效，请重新搜索。')
      try { await ports.stat(path) }
      catch (error) {
        authorized.delete(id)
        if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw new Error('文件已不存在，请刷新 Everything 搜索结果。')
        throw new Error(`无法访问文件：${error instanceof Error ? error.message : String(error)}`)
      }
      if (disposed) throw new Error('Everything 服务已关闭。')
      if (action === 'open') {
        const message = await env.openPath(path)
        if (message) throw new Error(`无法打开文件：${message}`)
      } else if (action === 'reveal') env.revealPath(path)
      else env.copyPath(path)
    },
  }
}

export function everythingPlugin(environment?: EverythingEnvironment) {
  return {
    name: 'everything-provider',
    apply(ctx: Context) {
      ctx.provide('everything', createEverythingService(ctx, environment))
    },
  }
}
