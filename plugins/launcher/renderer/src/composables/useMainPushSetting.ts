import {
  ENABLED_MAIN_PUSH_PLUGINS_KEY,
  isMainPushPluginEnabled,
  normalizeConfigList,
  pluginSupportsMainPush
} from '@shared/pluginSettings'

/** 「搜索栏推送」菜单项所需状态。 */
export interface MainPushMenuState {
  /** 插件是否声明了 mainPush 功能，false 时不应展示该菜单项。 */
  supported: boolean
  /** 当前是否已启用搜索栏推送。 */
  enabled: boolean
}

/**
 * 读取插件的搜索栏推送菜单状态。
 * features 可能包含动态注册项，因此每次打开菜单都重新查询插件列表。
 * @param pluginName 插件的实际 name（含 __dev 后缀）
 * @returns 菜单项是否展示及其勾选态
 */
export async function resolveMainPushMenuState(
  pluginName?: string | null
): Promise<MainPushMenuState> {
  if (!pluginName) {
    return { supported: false, enabled: false }
  }

  try {
    const [plugins, enabledData] = await Promise.all([
      window.ztools.getAllPlugins(),
      window.ztools.dbGet(ENABLED_MAIN_PUSH_PLUGINS_KEY)
    ])
    const plugin = Array.isArray(plugins)
      ? plugins.find((item: any) => item?.name === pluginName)
      : undefined
    if (!pluginSupportsMainPush(plugin)) {
      return { supported: false, enabled: false }
    }

    return {
      supported: true,
      enabled: isMainPushPluginEnabled(pluginName, normalizeConfigList(enabledData))
    }
  } catch (error) {
    console.error('读取搜索栏推送状态失败:', error)
    return { supported: false, enabled: false }
  }
}

/**
 * 切换插件的搜索栏推送开关。
 * 必须经主进程写入，写入后由主进程广播 plugins-changed 以重建 mainPush 功能列表。
 * @param pluginName 插件的实际 name
 * @returns 无返回值
 */
export async function toggleMainPushSetting(pluginName?: string | null): Promise<void> {
  if (!pluginName) return

  const enabledData = await window.ztools.dbGet(ENABLED_MAIN_PUSH_PLUGINS_KEY)
  const nextEnabled = !isMainPushPluginEnabled(pluginName, normalizeConfigList(enabledData))
  const result = await window.ztools.setPluginMainPushEnabled(pluginName, nextEnabled)
  if (!result?.success) {
    throw new Error(result?.error || '未知错误')
  }
  console.log('已更新搜索栏推送配置:', { pluginName, enabled: nextEnabled })
}
