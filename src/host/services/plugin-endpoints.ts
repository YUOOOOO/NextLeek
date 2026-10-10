import type { Context } from '@deepseek-ai/cordis'
import { identifier } from '../../shared/validation'
import type { PluginEndpointsService, PluginEndpointHandler } from './contracts'

function pluginArguments(value: unknown): void {
  const ancestors = new Set<object>()
  let nodes = 0
  let characters = 0
  const visit = (item: unknown, depth: number): void => {
    if (++nodes > 10000 || depth > 32) throw new TypeError('Plugin arguments exceed structural limits')
    if (item === null || typeof item === 'boolean') return
    if (typeof item === 'number' && Number.isFinite(item)) return
    if (typeof item === 'string') {
      characters += item.length
    } else if (typeof item === 'object' && item) {
      const prototype = Object.getPrototypeOf(item)
      if (!Array.isArray(item) && prototype !== Object.prototype && prototype !== null) throw new TypeError('Plugin arguments must contain only JSON values')
      if (ancestors.has(item)) throw new TypeError('Plugin arguments must not contain cycles')
      ancestors.add(item)
      if (Array.isArray(item)) {
        if (item.length > 10000) throw new TypeError('Plugin arguments exceed structural limits')
        for (const child of item) visit(child, depth + 1)
      } else {
        for (const key of Object.keys(item)) {
          characters += key.length
          if (characters > 65536) throw new TypeError('Plugin arguments exceed 64 KiB')
          const descriptor = Object.getOwnPropertyDescriptor(item, key)!
          if (!('value' in descriptor)) throw new TypeError('Plugin arguments must not contain accessors')
          visit(descriptor.value, depth + 1)
        }
      }
      ancestors.delete(item)
    } else {
      throw new TypeError('Plugin arguments must contain only JSON values')
    }
    if (characters > 65536) throw new TypeError('Plugin arguments exceed 64 KiB')
  }
  visit(value, 0)
  if (Buffer.byteLength(JSON.stringify(value), 'utf8') > 65536) throw new TypeError('Plugin arguments exceed 64 KiB')
}

export const pluginEndpointsPlugin = {
  name: 'plugin-endpoints',
  apply(ctx: Context) {
    const endpoints = new Map<string, PluginEndpointHandler>()
    ctx.provide('pluginEndpoints', {
      register(owner, pluginId, handler) {
        identifier(pluginId)
        owner.effect(() => {
          if (endpoints.has(pluginId)) throw new Error(`Duplicate plugin endpoint: ${pluginId}`)
          endpoints.set(pluginId, handler)
          return () => { endpoints.delete(pluginId) }
        }, `plugin endpoint ${pluginId}`)
      },
      async invoke(pluginId, method, args) {
        identifier(pluginId)
        if (typeof method !== 'string') throw new TypeError('Invalid plugin method')
        identifier(method.toLowerCase())
        pluginArguments(args)
        const handler = endpoints.get(pluginId)
        if (!handler) throw new Error(`Unknown plugin endpoint: ${pluginId}`)
        return handler(method, args)
      },
    } satisfies PluginEndpointsService)
  },
}
