import type { Context } from '@deepseek-ai/cordis'
import type { LauncherSearchGroup } from '../../shared/contracts'
import { identifier, launcherSearchRequest, searchItemId } from '../../shared/validation'
import type { SearchProvider, SearchService } from './contracts'

export const searchPlugin = {
  name: 'search',
  apply(ctx: Context) {
    const providers = new Map<string, SearchProvider>()
    ctx.provide('search', {
      register(owner, provider) {
        identifier(provider.id)
        owner.effect(() => {
          if (providers.has(provider.id)) throw new Error(`Duplicate search provider: ${provider.id}`)
          providers.set(provider.id, provider)
          return () => { providers.delete(provider.id) }
        }, `search provider ${provider.id}`)
      },
      async search(request) {
        const validated = launcherSearchRequest(request)
        if (!validated.query.trim()) return []
        const groups = await Promise.all([...providers.values()].map(async provider => {
          let result: Awaited<ReturnType<SearchProvider['search']>>
          try { result = await provider.search(validated) }
          catch (error) { result = { status: 'error', message: error instanceof Error ? error.message : String(error), items: [], total: 0 } }
          if (providers.get(provider.id) !== provider) return undefined
          return { ...result, providerId: provider.id, title: provider.title, offset: validated.offset, hasMore: validated.offset + result.items.length < result.total } satisfies LauncherSearchGroup
        }))
        return groups.filter((group): group is LauncherSearchGroup => group !== undefined)
      },
      async performAction(providerId, itemId, action) {
        identifier(providerId); searchItemId(itemId); identifier(action)
        const provider = providers.get(providerId)
        if (!provider) throw new Error(`Search provider unavailable: ${providerId}`)
        await provider.performAction(itemId, action)
      },
    } satisfies SearchService)
  },
}
