// Derived from ZTools (MIT), Copyright (c) ZTools contributors.
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
interface HttpServerConfig {
  enabled: boolean
  port: number
  apiKey: string
}

interface ApiResponse {
  code: number
  message: string
  data?: unknown
}

const DB_KEY = 'settings-http-server'
const DEFAULT_PORT = 36578

export class HttpServer {
  constructor(private readonly ports: { get(key: string): unknown; put(key: string,value: unknown): void; show(text?: string): Promise<void>; hide(): void; toggle(): Promise<void>; launch(body: Record<string, unknown>): Promise<unknown> }) {}
  private server: Server | null = null
  private config: HttpServerConfig = {
    enabled: false,
    port: DEFAULT_PORT,
    apiKey: ''
  }


  public async init(): Promise<void> {
    await this.loadConfig()
    if (this.config.enabled) {
      await this.start()
    }
  }

  public async loadConfig(): Promise<HttpServerConfig> {
    try {
      const saved = this.ports.get(DB_KEY) as Partial<HttpServerConfig> | null
      if (saved) {
        this.config = {
          enabled: saved.enabled ?? false,
          port: saved.port ?? DEFAULT_PORT,
          apiKey: saved.apiKey || this.generateApiKey()
        }
      }
    } catch (error) {
      console.error('[HttpServer] 加载配置失败:', error)
    }
    return this.config
  }

  public async saveConfig(config: Partial<HttpServerConfig>): Promise<HttpServerConfig> {
    this.config = { ...this.config, ...config }
    this.ports.put(DB_KEY, {
      enabled: this.config.enabled,
      port: this.config.port,
      apiKey: this.config.apiKey
    })
    return this.config
  }

  public getConfig(): HttpServerConfig {
    if (!this.config.apiKey) {
      this.config.apiKey = this.generateApiKey()
      this.saveConfig({ apiKey: this.config.apiKey })
    }
    return { ...this.config }
  }

  public generateApiKey(): string {
    return randomBytes(16).toString('hex')
  }

  public async start(): Promise<void> {
    await this.stop()
    const server = createServer((req, res) => { void this.handleRequest(req, res) })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error) => { if (this.server === server) this.server = null; reject(error) }
      server.once('error', failed)
      server.listen(this.config.port, '127.0.0.1', () => {
        server.removeListener('error', failed)
        server.on('error', error => console.error('[HttpServer] 服务错误:', error))
        resolve()
      })
    })
  }

  public async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (server?.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  }

  public isRunning(): boolean {
    return this.server !== null && this.server.listening
  }

  private sendJson(res: ServerResponse, statusCode: number, body: ApiResponse): void {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    })
    res.end(JSON.stringify(body))
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization'
      })
      res.end()
      return
    }

    const url = req.url || '/'

    // GET / 无需认证，返回欢迎信息
    if (req.method === 'GET' && url === '/') {
      this.sendJson(res, 200, { code: 0, message: 'Hello ZTools' })
      return
    }

    if (req.method !== 'POST') {
      this.sendJson(res, 405, { code: 405, message: '仅支持 POST 请求' })
      return
    }

    const authHeader = req.headers['authorization']
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
    if (!token || Buffer.byteLength(token) !== Buffer.byteLength(this.config.apiKey) || !timingSafeEqual(Buffer.from(token), Buffer.from(this.config.apiKey))) {
      this.sendJson(res, 401, { code: 401, message: 'API 密钥无效' })
      return
    }

    try {
      const body = await this.readBody(req)
      const result = await this.routeRequest(url, body)
      this.sendJson(res, 200, result)
    } catch (error) {
      console.error('[HttpServer] 请求处理失败:', error)
      this.sendJson(res, 500, {
        code: 500,
        message: error instanceof Error ? error.message : '内部服务器错误'
      })
    }
  }

  private readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      const MAX_BODY_SIZE = 1024 * 1024 // 1MB

      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_SIZE) {
          reject(new Error('请求体过大'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })

      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8')
        if (!raw) {
          resolve({})
          return
        }
        try {
          resolve(JSON.parse(raw))
        } catch {
          reject(new Error('无效的 JSON 格式'))
        }
      })

      req.on('error', reject)
    })
  }

  /**
   * 根据请求路径分发到具体 HTTP API 处理器。
   * @param url 请求路径。
   * @param body 已解析的 JSON 请求体。
   * @returns 统一 API 响应。
   */
  private async routeRequest(url: string, body: Record<string, unknown>): Promise<ApiResponse> {
    switch (url) {
      case '/api/window/show':
        await this.ports.show(typeof body.text === 'string' ? body.text : undefined); return { code: 0, message: '操作成功' }
      case '/api/window/hide':
        this.ports.hide(); return { code: 0, message: '操作成功' }
      case '/api/window/toggle':
        await this.ports.toggle(); return { code: 0, message: '操作成功' }
      case '/api/plugin/launch':
        return { code: 0, message: '操作成功', data: await this.ports.launch(body) }
      default:
        return { code: 404, message: `未知接口: ${url}` }
    }
  }

}

