import type { Command } from '../../stores/commandDataStore'

export interface NavigationGridRow { type: string; items: Command[] }
interface BuildAggregateNavigationGridOptions {
  hasSearchContent: boolean
  bestSearchResults: Command[]
  displayApps: Command[]
  pinnedApps: Command[]
  showRecentInSearch: boolean
  recentExpanded: boolean
  pinnedExpanded: boolean
  searchResultsExpanded: boolean
  recentRows: number
  pinnedRows: number
}
// 保留原版九列折叠计算，键盘只选择当前实际可见项。
function getVisibleItems(items: Command[], expanded: boolean, rows: number): Command[] {
  return expanded || items.length <= 9 * rows ? items : items.slice(0, 9 * rows)
}
// 按原版网格列数分割导航行。
function appendGridRows(rows: NavigationGridRow[], type: string, items: Command[]): void {
  for (let index = 0; index < items.length; index += 9) rows.push({ type, items: items.slice(index, index + 9) })
}
// 最近使用、固定与注册指令采用原版分组顺序。
export function buildAggregateNavigationGrid(options: BuildAggregateNavigationGridOptions): NavigationGridRow[] {
  const rows: NavigationGridRow[] = []
  if (options.hasSearchContent) {
    appendGridRows(rows, 'bestSearch', getVisibleItems(options.bestSearchResults, options.searchResultsExpanded, 2))
    return rows
  }
  if (options.showRecentInSearch) appendGridRows(rows, 'apps', getVisibleItems(options.displayApps, options.recentExpanded, options.recentRows))
  appendGridRows(rows, 'pinned', getVisibleItems(options.pinnedApps, options.pinnedExpanded, options.pinnedRows))
  return rows
}
