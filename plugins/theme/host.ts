import type { Context } from '@deepseek-ai/cordis'

// 外观入口随主题插件撤销，原生外观由设置服务统一提交。
export const themePlugin = {
  name: 'theme', inject: ['commands', 'settings'],
  apply(ctx: Context) {
    ctx.commands.register(ctx, { id: 'theme.open', pluginId: 'theme', title: '主题与外观', description: '系统、亮色、暗色与六种主题色', icon: 'palette', keywords: ['theme', '主题', 'zhuti', '外观'] }, () => ({ navigate: 'settings' }))
  },
}
