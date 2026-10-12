import type { Context } from '@deepseek-ai/cordis'
export const everythingSearchPlugin = {
  name: 'everything', inject: ['search', 'everything'],
  apply(ctx: Context) {
    ctx.search.register(ctx, {
      id: 'everything', title: 'Everything 文件搜索',
      async search(request) {
        const status = await ctx.everything.getStatus()
        if (status.status !== 'ready') return { status: status.status, message: status.message, items: [], total: 0 }
        const result = await ctx.everything.search(request)
        return {
          status: 'ready', total: result.total,
          items: result.items.map(item => ({ ...item, actions: [
            { id: 'open', label: '打开' },
            { id: 'reveal', label: '打开所在文件夹' },
            { id: 'copy-path', label: '复制路径' },
          ] })),
        }
      },
      async performAction(itemId, action) {
        if (action !== 'open' && action !== 'reveal' && action !== 'copy-path') throw new TypeError('Unsupported search action')
        await ctx.everything.performAction(itemId, action)
      },
    })
  },
}
