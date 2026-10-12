export interface NavigationGridRow<T> { type:string; items:T[] }
// 沿用 ZTools 聚合导航按九列分行的算法，竖向结果由 columns=1 接入。
export function appendGridRows<T>(rows: NavigationGridRow<T>[], type: string, items: T[], columns = 9): void {
  for (let index = 0; index < items.length; index += columns) {
    rows.push({ type, items: items.slice(index, index + columns) })
  }
}

