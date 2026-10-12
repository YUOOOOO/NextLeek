/**
 * 加权搜索：根据多个字段的权重对列表进行过滤和排序。
 * 匹配权重高的字段的项排在前面，无匹配的项被过滤掉。
 *
 * @param items 待搜索的列表
 * @param query 搜索关键词（原始输入，内部会 trim + toLowerCase）
 * @param fields 字段定义数组，每项包含取值函数和权重
 * @returns 过滤并按权重降序排列的结果
 */
export function weightedSearch<T>(
  items: T[],
  query: string,
  fields: Array<{ value: (item: T) => string; weight: number }>
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return items

  return items
    .map((item) => {
      let score = 0
      for (const field of fields) {
        if (field.value(item).toLowerCase().includes(q)) {
          score += field.weight
        }
      }
      return { item, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.item)
}
