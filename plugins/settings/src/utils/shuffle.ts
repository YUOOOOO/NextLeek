/**
 * Fisher-Yates 洗牌算法，返回新数组（不修改原数组）
 */
export function shuffleArray<T>(arr: readonly T[]): T[] {
  const shuffled = [...arr]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}
