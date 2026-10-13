// Adapted from ZTools; Copyright (c) 2025 lzx8589561, MIT licensed (see LICENSE).
import type { SystemSetting } from './windowsSettings'

/**
 * 完整的 ms-settings URI 列表（名称对齐 Windows 11 设置 UI）
 * 来源：
 * - https://learn.microsoft.com/en-us/windows/apps/develop/launch/launch-settings
 * - https://ss64.com/nt/syntax-settings.html
 */
export const MS_SETTINGS_URIS: Omit<SystemSetting, 'icon'>[] = [
  // === 系统 ===
  {
    name: '屏幕',
    uri: 'ms-settings:display',
    category: '系统'
  },
  {
    name: '高级显示设置',
    uri: 'ms-settings:display-advanced',
    category: '系统'
  },
  {
    name: '显示卡',
    uri: 'ms-settings:display-advancedgraphics',
    category: '系统'
  },
  {
    name: '夜间模式',
    uri: 'ms-settings:nightlight',
    category: '系统'
  },
  {
    name: '声音',
    uri: 'ms-settings:sound',
    category: '系统'
  },
  {
    name: '所有声音设备',
    uri: 'ms-settings:sound-devices',
    category: '系统'
  },
  {
    name: '麦克风属性',
    uri: 'ms-settings:sound-defaultinputproperties',
    category: '系统'
  },
  {
    name: '扬声器属性',
    uri: 'ms-settings:sound-defaultoutputproperties',
    category: '系统'
  },
  {
    name: '音量合成器',
    uri: 'ms-settings:apps-volume',
    category: '系统'
  },
  {
    name: '通知',
    uri: 'ms-settings:notifications',
    category: '系统'
  },
  {
    name: '专注',
    uri: 'ms-settings:quiethours',
    category: '系统'
  },
  {
    name: '电源和电池',
    uri: 'ms-settings:powersleep',
    category: '系统'
  },
  {
    name: '电源',
    uri: 'ms-settings:batterysaver',
    category: '系统'
  },
  {
    name: '节能建议',
    uri: 'ms-settings:energyrecommendations',
    category: '系统'
  },
  {
    name: '存储',
    uri: 'ms-settings:storagesense',
    category: '系统'
  },
  {
    name: '存储感知',
    uri: 'ms-settings:storagepolicies',
    category: '系统'
  },
  {
    name: '清理建议',
    uri: 'ms-settings:storagerecommendations',
    category: '系统'
  },
  {
    name: '磁盘和卷',
    uri: 'ms-settings:disksandvolumes',
    category: '系统'
  },
  {
    name: '保存新内容的地方',
    uri: 'ms-settings:savelocations',
    category: '系统'
  },
  {
    name: '多任务处理',
    uri: 'ms-settings:multitasking',
    category: '系统'
  },
  {
    name: '投影到此电脑',
    uri: 'ms-settings:project',
    category: '系统'
  },
  {
    name: '就近共享',
    uri: 'ms-settings:crossdevice',
    category: '系统'
  },
  {
    name: '任务栏',
    uri: 'ms-settings:taskbar',
    category: '个性化'
  },
  {
    name: '剪贴板',
    uri: 'ms-settings:clipboard',
    category: '系统'
  },
  {
    name: '远程桌面',
    uri: 'ms-settings:remotedesktop',
    category: '系统'
  },
  {
    name: '设备加密',
    uri: 'ms-settings:deviceencryption',
    category: '系统'
  },
  {
    name: '关于',
    uri: 'ms-settings:about',
    category: '系统'
  },

  // === 蓝牙和其他设备 ===
  {
    name: '蓝牙',
    uri: 'ms-settings:bluetooth',
    category: '设备'
  },
  {
    name: '设备',
    uri: 'ms-settings:connecteddevices',
    category: '设备'
  },
  {
    name: '投放',
    uri: 'ms-settings-connectabledevices:devicediscovery',
    category: '设备'
  },
  {
    name: '打印机和扫描仪',
    uri: 'ms-settings:printers',
    category: '设备'
  },
  {
    name: '鼠标',
    uri: 'ms-settings:mousetouchpad',
    category: '设备'
  },
  {
    name: 'USB',
    uri: 'ms-settings:usb',
    category: '设备'
  },
  {
    name: '摄像头',
    uri: 'ms-settings:camera',
    category: '设备'
  },

  // === 网络和 Internet ===
  {
    name: '网络和 Internet',
    uri: 'ms-settings:network-status',
    category: '网络'
  },
  {
    name: 'WLAN',
    uri: 'ms-settings:network-wifi',
    category: '网络'
  },
  {
    name: '管理已知网络',
    uri: 'ms-settings:network-wifisettings',
    category: '网络'
  },
  {
    name: '以太网',
    uri: 'ms-settings:network-ethernet',
    category: '网络'
  },
  {
    name: 'VPN',
    uri: 'ms-settings:network-vpn',
    category: '网络'
  },
  {
    name: '代理',
    uri: 'ms-settings:network-proxy',
    category: '网络'
  },
  {
    name: '飞行模式',
    uri: 'ms-settings:network-airplanemode',
    category: '网络'
  },
  {
    name: '移动热点',
    uri: 'ms-settings:network-mobilehotspot',
    category: '网络'
  },
  {
    name: '数据使用量',
    uri: 'ms-settings:datausage',
    category: '网络'
  },

  // === 个性化 ===
  {
    name: '个性化',
    uri: 'ms-settings:personalization',
    category: '个性化'
  },
  {
    name: '背景',
    uri: 'ms-settings:personalization-background',
    category: '个性化'
  },
  {
    name: '颜色',
    uri: 'ms-settings:personalization-colors',
    category: '个性化'
  },
  {
    name: '锁屏界面',
    uri: 'ms-settings:lockscreen',
    category: '个性化'
  },
  {
    name: '主题',
    uri: 'ms-settings:themes',
    category: '个性化'
  },
  {
    name: '字体',
    uri: 'ms-settings:fonts',
    category: '个性化'
  },
  {
    name: '开始',
    uri: 'ms-settings:personalization-start',
    category: '个性化'
  },

  // === 应用 ===
  {
    name: '已安装的应用',
    uri: 'ms-settings:appsfeatures',
    category: '应用'
  },
  {
    name: '默认应用',
    uri: 'ms-settings:defaultapps',
    category: '应用'
  },
  {
    name: '启动',
    uri: 'ms-settings:startupapps',
    category: '应用'
  },
  {
    name: '可选功能',
    uri: 'ms-settings:optionalfeatures',
    category: '应用'
  },

  // === 账户 ===
  {
    name: '你的信息',
    uri: 'ms-settings:yourinfo',
    category: '账户'
  },
  {
    name: '电子邮件和账户',
    uri: 'ms-settings:emailandaccounts',
    category: '账户'
  },
  {
    name: '登录选项',
    uri: 'ms-settings:signinoptions',
    category: '账户'
  },
  {
    name: '其他用户',
    uri: 'ms-settings:otherusers',
    category: '账户'
  },
  {
    name: 'Windows 备份',
    uri: 'ms-settings:sync',
    category: '账户'
  },

  // === 时间和语言 ===
  {
    name: '日期和时间',
    uri: 'ms-settings:dateandtime',
    category: '时间'
  },
  {
    name: '语言和区域',
    uri: 'ms-settings:regionlanguage',
    category: '语言'
  },
  {
    name: '区域格式',
    uri: 'ms-settings:regionformatting',
    category: '语言'
  },
  {
    name: '键盘',
    uri: 'ms-settings:keyboard',
    category: '语言'
  },
  {
    name: '高级键盘设置',
    uri: 'ms-settings:keyboard-advanced',
    category: '语言'
  },
  {
    name: '输入',
    uri: 'ms-settings:typing',
    category: '语言'
  },
  {
    name: '语音',
    uri: 'ms-settings:speech',
    category: '语言'
  },

  // === 隐私和安全性 ===
  {
    name: '隐私和安全性',
    uri: 'ms-settings:privacy',
    category: '隐私'
  },
  {
    name: '常规',
    uri: 'ms-settings:privacy-general',
    category: '隐私'
  },
  {
    name: '位置',
    uri: 'ms-settings:privacy-location',
    category: '隐私'
  },
  {
    name: '相机',
    uri: 'ms-settings:privacy-webcam',
    category: '隐私'
  },
  {
    name: '麦克风',
    uri: 'ms-settings:privacy-microphone',
    category: '隐私'
  },

  // === Windows 更新 ===
  {
    name: 'Windows 更新',
    uri: 'ms-settings:windowsupdate',
    category: '更新'
  },
  {
    name: '检查更新',
    uri: 'ms-settings:windowsupdate-action',
    category: '更新'
  },
  {
    name: '更新历史记录',
    uri: 'ms-settings:windowsupdate-history',
    category: '更新'
  },
  {
    name: '可选更新',
    uri: 'ms-settings:windowsupdate-optionalupdates',
    category: '更新'
  },
  {
    name: '高级选项',
    uri: 'ms-settings:windowsupdate-options',
    category: '更新'
  },
  {
    name: '重启选项',
    uri: 'ms-settings:windowsupdate-restartoptions',
    category: '更新'
  },
  {
    name: '获取最新更新',
    uri: 'ms-settings:windowsupdate-seekerondemand',
    category: '更新'
  },
  {
    name: '传递优化',
    uri: 'ms-settings:delivery-optimization',
    category: '更新'
  },
  {
    name: 'Windows 安全中心',
    uri: 'ms-settings:windowsdefender',
    category: '安全'
  },
  {
    name: '疑难解答',
    uri: 'ms-settings:troubleshoot',
    category: '系统'
  },
  {
    name: '恢复',
    uri: 'ms-settings:recovery',
    category: '系统'
  },
  {
    name: '激活',
    uri: 'ms-settings:activation',
    category: '系统'
  },
  {
    name: '查找我的设备',
    uri: 'ms-settings:findmydevice',
    category: '安全'
  },
  {
    name: '开发者选项',
    uri: 'ms-settings:developers',
    category: '系统'
  },

  // === 搜索 ===
  {
    name: '搜索 Windows',
    uri: 'ms-settings:search',
    category: '搜索'
  },
  {
    name: '搜索权限',
    uri: 'ms-settings:search-permissions',
    category: '搜索'
  }
]
