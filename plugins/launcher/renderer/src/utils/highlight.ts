import { pinyin } from 'pinyin-pro'

interface MatchInfo {
  indices: Array<[number, number]>
  value: string
  key: string
}

/**
 * 根据匹配信息高亮文本
 * @param text 原始文本
 * @param matches Fuse.js 返回的匹配信息
 * @param matchType 匹配类型（用于特殊高亮算法）
 * @param query 搜索查询（用于 acronym 匹配）
 * @returns 包含高亮标签的HTML字符串
 */
export function highlightMatch(
  text: string,
  matches?: MatchInfo[],
  matchType?: 'acronym' | 'name' | 'pinyin' | 'pinyinAbbr',
  query?: string
): string {
  if (!matches || matches.length === 0) {
    return escapeHtml(text)
  }

  // 特殊处理：acronym 匹配类型
  if (matchType === 'acronym' && query) {
    return highlightAcronym(text, query)
  }

  // 优先尝试连续子串匹配：如果 query 能在 text 中连续找到，直接高亮连续部分
  // 这避免了 Fuse.js 模糊匹配返回分散索引导致的高亮不连续问题
  if (query) {
    const lowerText = text.toLowerCase()
    const lowerQuery = query.toLowerCase()
    const substringIndex = lowerText.indexOf(lowerQuery)
    if (substringIndex !== -1) {
      // 找到了连续匹配，直接构建高亮结果
      const before = escapeHtml(text.substring(0, substringIndex))
      const matched = escapeHtml(text.substring(substringIndex, substringIndex + query.length))
      const after = escapeHtml(text.substring(substringIndex + query.length))
      return before + '<mark class="highlight">' + matched + '</mark>' + after
    }
  }

  // 收集所有需要高亮的字符索引
  const highlightIndices = new Set<number>()

  matches.forEach((match) => {
    if (match.key === 'name') {
      // 直接使用 name 的索引
      match.indices.forEach(([start, end]) => {
        for (let i = start; i <= end; i++) {
          highlightIndices.add(i)
        }
      })
    } else if (match.key === 'pinyin') {
      // 拼音匹配: 需要映射拼音索引到中文字符索引
      const charIndices = mapPinyinToCharIndices(text, match.indices, false)
      charIndices.forEach((i) => highlightIndices.add(i))
    } else if (match.key === 'pinyinAbbr') {
      // 拼音首字母匹配: 需要映射首字母索引到中文字符索引
      const charIndices = mapPinyinToCharIndices(text, match.indices, true)
      charIndices.forEach((i) => highlightIndices.add(i))
    }
  })

  if (highlightIndices.size === 0) {
    return escapeHtml(text)
  }

  // 将索引集合转换为连续的区间
  const sortedIndices = Array.from(highlightIndices).sort((a, b) => a - b)
  const ranges: Array<[number, number]> = []

  let rangeStart = sortedIndices[0]
  let rangeEnd = sortedIndices[0]

  for (let i = 1; i < sortedIndices.length; i++) {
    if (sortedIndices[i] === rangeEnd + 1) {
      // 连续,扩展当前区间
      rangeEnd = sortedIndices[i]
    } else {
      // 不连续,保存当前区间,开始新区间
      ranges.push([rangeStart, rangeEnd])
      rangeStart = sortedIndices[i]
      rangeEnd = sortedIndices[i]
    }
  }
  // 保存最后一个区间
  ranges.push([rangeStart, rangeEnd])

  // 根据区间插入高亮标签
  let result = ''
  let lastIndex = 0

  ranges.forEach(([start, end]) => {
    // 添加未匹配的部分
    result += escapeHtml(text.substring(lastIndex, start))
    // 添加高亮的部分
    result += '<mark class="highlight">' + escapeHtml(text.substring(start, end + 1)) + '</mark>'
    lastIndex = end + 1
  })

  // 添加剩余部分
  result += escapeHtml(text.substring(lastIndex))

  return result
}

/**
 * 高亮首字母缩写匹配
 * @param text 原始文本（如 "Visual Studio Code"）
 * @param query 搜索查询（如 "vs"）
 * @returns 包含高亮标签的HTML字符串
 */
function highlightAcronym(text: string, query: string): string {
  const highlightIndices = new Set<number>()

  // 方式1：空格分隔的单词首字母
  const words = text.split(/\s+/).filter((w) => w.length > 0)
  if (words.length > 1) {
    let currentIndex = 0
    let highlightCount = 0

    for (const word of words) {
      // 找到单词在原文中的位置
      const wordIndex = text.indexOf(word, currentIndex)
      if (wordIndex !== -1 && highlightCount < query.length) {
        // 高亮该单词的首字母
        highlightIndices.add(wordIndex)
        highlightCount++
        currentIndex = wordIndex + word.length
      }
    }

    if (highlightIndices.size > 0) {
      return buildHighlightedText(text, highlightIndices)
    }
  }

  // 方式2：驼峰命名首字母
  const chars = Array.from(text)
  let highlightCount = 0

  for (let i = 0; i < chars.length && highlightCount < query.length; i++) {
    if (/[A-Z]/.test(chars[i])) {
      highlightIndices.add(i)
      highlightCount++
    }
  }

  return buildHighlightedText(text, highlightIndices)
}

/**
 * 根据索引集合构建高亮文本
 */
function buildHighlightedText(text: string, highlightIndices: Set<number>): string {
  if (highlightIndices.size === 0) {
    return escapeHtml(text)
  }

  let result = ''
  const chars = Array.from(text)

  for (let i = 0; i < chars.length; i++) {
    if (highlightIndices.has(i)) {
      result += '<mark class="highlight">' + escapeHtml(chars[i]) + '</mark>'
    } else {
      result += escapeHtml(chars[i])
    }
  }

  return result
}

/**
 * 将拼音索引映射到中文字符索引
 * @param text 原始中文文本
 * @param pinyinIndices 拼音匹配的索引范围
 * @param isAbbr 是否为拼音首字母
 * @returns 对应的中文字符索引集合
 */
function mapPinyinToCharIndices(
  text: string,
  pinyinIndices: Array<[number, number]>,
  isAbbr: boolean
): Set<number> {
  const charIndices = new Set<number>()

  // 为每个字符生成拼音
  const chars = Array.from(text)
  const charPinyins = chars.map((char) => {
    if (isAbbr) {
      return pinyin(char, { pattern: 'first', toneType: 'none', type: 'string' })
        .replace(/\s+/g, '')
        .toLowerCase()
    } else {
      return pinyin(char, { toneType: 'none', type: 'string' }).replace(/\s+/g, '').toLowerCase()
    }
  })

  // 构建累积拼音长度数组,用于快速定位
  const cumulativeLengths: number[] = [0]
  for (let i = 0; i < charPinyins.length; i++) {
    cumulativeLengths.push(cumulativeLengths[i] + charPinyins[i].length)
  }

  // 对于每个拼音匹配区间,找出对应的字符索引
  pinyinIndices.forEach(([start, end]) => {
    const matchLength = end - start + 1

    for (let charIdx = 0; charIdx < chars.length; charIdx++) {
      const charPinyinStart = cumulativeLengths[charIdx]
      const charPinyinEnd = cumulativeLengths[charIdx + 1] - 1
      const charPinyinLength = charPinyins[charIdx].length

      // 检查匹配区间是否完全包含在字符的拼音区间内
      // 或者匹配区间完全覆盖了字符的拼音区间
      const isFullyInside = start >= charPinyinStart && end <= charPinyinEnd
      const isFullyCovering = start <= charPinyinStart && end >= charPinyinEnd

      if (isFullyInside || isFullyCovering) {
        // 额外检查: 如果匹配长度太短(比如只有1个字符),且不是拼音首字母模式,则忽略
        if (!isAbbr && matchLength === 1 && charPinyinLength > 1) {
          continue
        }

        charIndices.add(charIdx)
      }
    }
  })

  return charIndices
}

/**
 * 简单子串高亮：在文本中高亮搜索查询的子串匹配
 * 适用于没有 Fuse.js 匹配信息的场景（如 mainPush 插件结果）
 * @param text 原始文本
 * @param query 搜索查询
 * @returns 包含高亮标签的HTML字符串
 */
export function highlightSubstring(text: string, query?: string): string {
  if (!query || !query.trim()) {
    return escapeHtml(text)
  }

  const lowerText = text.toLowerCase()
  const lowerQuery = query.toLowerCase().trim()
  const idx = lowerText.indexOf(lowerQuery)

  if (idx === -1) {
    return escapeHtml(text)
  }

  const before = escapeHtml(text.substring(0, idx))
  const matched = escapeHtml(text.substring(idx, idx + lowerQuery.length))
  const after = escapeHtml(text.substring(idx + lowerQuery.length))
  return before + '<mark class="highlight">' + matched + '</mark>' + after
}

/**
 * 转义HTML特殊字符,防止XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}
