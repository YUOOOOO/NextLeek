import type { Context } from '@deepseek-ai/cordis'
import type { Page } from '../../shared/contracts'

function navigation(ctx: Context, id: string, title: string, description: string, icon: string, page: Page, keywords: string[]) {
  ctx.commands.register(ctx, { id, title, description, icon, keywords }, () => ({ navigate: page }))
}
export const settingsPlugin = {
  name: 'settings', inject: ['commands'],
  apply(ctx: Context) {
    navigation(ctx, 'settings.open', '设置', '快捷键、外观与启动偏好', 'settings', 'settings', ['settings', '设置', 'shezhi'])
    navigation(ctx, 'plugins.open', '插件管理', '查看真实插件状态和管理本地插件', 'blocks', 'plugins', ['plugins', '插件', 'chajian'])
  },
}
export const themePlugin = {
  name: 'theme', inject: ['commands'],
  apply(ctx: Context) {
    navigation(ctx, 'theme.open', '主题与外观', '系统、亮色、暗色与六种主题色', 'palette', 'theme', ['theme', '主题', 'zhuti', '外观'])
  },
}
export const quickLaunchPlugin = {
  name: 'quick-launch', inject: ['commands', 'desktop'],
  apply(ctx: Context) {
    navigation(ctx, 'launcher.open', '快速启动', '搜索命令与固定常用操作', 'search', 'launcher', ['launcher', '搜索', '启动'])
    ctx.commands.register(ctx, { id: 'data.open', title: '打开数据目录', description: '查看本机 LMDB 存储位置', icon: 'folder', keywords: ['data', '数据', 'shuju'] }, async () => {
      await ctx.desktop.openDataDirectory()
      return {}
    })
    ctx.commands.register(ctx, { id: 'window.hide', title: '隐藏窗口', description: '保持 NextLeek 在托盘运行', icon: 'minus', keywords: ['hide', '隐藏'] }, () => { ctx.desktop.hide(); return {} })
  },
}
