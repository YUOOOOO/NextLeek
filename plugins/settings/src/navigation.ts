// MIT Copyright (c) 2025 lzx8589561
// 基础版仅展示已接入的设置功能，扩展服务源码保留但不开放入口。
export const settingMenu = [
  { name: 'GeneralSetting', meta: { menu: { label: '通用设置', icon: 'i-z-settings' } } },
  { name: 'Shortcuts', meta: { menu: { label: '快捷键', icon: 'i-z-keyboard' } } },
  { name: 'Plugins', meta: { menu: { label: '已安装插件', icon: 'i-z-plugin' } } },
  { name: 'Market', meta: { menu: { label: '插件市场', icon: 'i-z-store' } } },
  { name: 'AllCommands', meta: { menu: { label: '所有指令', icon: 'i-z-list' } } },
  { name: 'About', meta: { menu: { label: '关于', icon: 'i-z-info' } } },
] as const
