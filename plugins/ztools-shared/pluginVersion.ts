interface ParsedPluginVersion {
  core: number[]
  prerelease: string[]
}

/**
 * 解析插件版本号，支持可选的 v 前缀、缺省补零和 SemVer 预发布标识。
 * @param value 待解析的版本字符串
 * @returns 解析后的版本结构；格式无效时返回 null
 */
function parsePluginVersion(value: string): ParsedPluginVersion | null {
  const normalized = value.trim().replace(/^[vV]/, '').split('+', 1)[0]
  const match = normalized.match(/^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?$/)
  if (!match) return null

  return {
    core: match[1].split('.').map(Number),
    prerelease: match[2] ? match[2].split('.') : []
  }
}

/**
 * 比较两个 SemVer 预发布标识列表。
 * @param left 左侧预发布标识
 * @param right 右侧预发布标识
 * @returns 左侧较小时返回 -1，较大时返回 1，相等时返回 0
 */
function comparePrereleaseIdentifiers(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) return 0
  if (left.length === 0) return 1
  if (right.length === 0) return -1

  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index++) {
    const leftPart = left[index]
    const rightPart = right[index]
    if (leftPart === undefined) return -1
    if (rightPart === undefined) return 1
    if (leftPart === rightPart) continue

    const leftNumeric = /^\d+$/.test(leftPart)
    const rightNumeric = /^\d+$/.test(rightPart)
    if (leftNumeric && rightNumeric) {
      return Number(leftPart) < Number(rightPart) ? -1 : 1
    }
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return leftPart < rightPart ? -1 : 1
  }
  return 0
}

/**
 * 比较两个插件版本号。
 * @param left 左侧版本号
 * @param right 右侧版本号
 * @returns 左侧较小时返回 -1，较大时返回 1，相等时返回 0；任一版本无效时返回 null
 */
export function comparePluginVersions(left: string, right: string): number | null {
  const leftVersion = parsePluginVersion(left)
  const rightVersion = parsePluginVersion(right)
  if (!leftVersion || !rightVersion) return null

  // 核心版本按位比较，较短版本按零补齐。
  const coreLength = Math.max(leftVersion.core.length, rightVersion.core.length)
  for (let index = 0; index < coreLength; index++) {
    const leftPart = leftVersion.core[index] ?? 0
    const rightPart = rightVersion.core[index] ?? 0
    if (leftPart < rightPart) return -1
    if (leftPart > rightPart) return 1
  }

  return comparePrereleaseIdentifiers(leftVersion.prerelease, rightVersion.prerelease)
}
