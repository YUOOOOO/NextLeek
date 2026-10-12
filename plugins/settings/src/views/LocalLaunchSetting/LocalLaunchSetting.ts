import { router } from '@/router'

export interface LocalLaunchSettingJumpFunction {
  pendingFiles: string[]
}

/**
 * 跳转到插件安装页面
 * @param config 路由状态参数
 */
export function jumpLocalLaunchSettingJumpFunction(config: LocalLaunchSettingJumpFunction): void {
  void router.replace({
    name: 'LocalLaunch',
    query: { _t: Date.now() },
    state: { ...config }
  })
}
