import { accents, themes, type Settings, type EverythingSearchRequest, type EverythingAction } from './contracts'

export const defaultSettings: Readonly<Settings> = Object.freeze({
  hotkey: 'Alt+Z', autostart: false, theme: 'system', accent: 'blue', compact: false, escHide: false,
})
export function identifier(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9.-]{0,79}$/.test(value)) throw new TypeError('Invalid identifier')
  return value
}
export function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new TypeError('Expected boolean')
  return value
}
export function settingsPatch(value: unknown): Partial<Settings> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected settings object')
  const result: Partial<Settings> = {}
  for (const [key, item] of Object.entries(value)) {
    switch (key) {
      case 'hotkey':
        if (typeof item !== 'string' || item.length > 80 || !/^(?:(?:Alt|Option|Control|Ctrl|Command|Cmd|CommandOrControl|CmdOrCtrl|Shift|Super)\+)+(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Enter|Up|Down|Left|Right)$/i.test(item)) throw new TypeError('Hotkey must include a modifier and supported key')
        result.hotkey = item
        break
      case 'theme':
        if (!themes.includes(item as Settings['theme'])) throw new TypeError('Invalid theme')
        result.theme = item as Settings['theme']
        break
      case 'accent':
        if (!accents.includes(item as Settings['accent'])) throw new TypeError('Invalid accent')
        result.accent = item as Settings['accent']
        break
      case 'autostart': case 'compact': case 'escHide': result[key] = boolean(item); break
      default: throw new TypeError(`Unknown setting: ${key}`)
    }
  }
  return result
}
export function argumentsCount(args: unknown[], count: number): void {
  if (args.length !== count) throw new TypeError(`Expected ${count} arguments`)
}

export function everythingSearchRequest(value: unknown): EverythingSearchRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid Everything search request')
  const request = value as Record<string, unknown>
  const keys = ['query', 'filter', 'sort', 'descending', 'offset', 'limit']
  if (Object.keys(request).some(key => !keys.includes(key))) throw new TypeError('Unknown Everything search option')
  if (typeof request.query !== 'string' || request.query.length > 2048 || /[\u0000-\u001f]/.test(request.query)) throw new TypeError('Invalid Everything query')
  if (!['all', 'files', 'folders'].includes(request.filter as string)) throw new TypeError('Invalid Everything filter')
  if (!['name', 'path', 'size', 'modified'].includes(request.sort as string)) throw new TypeError('Invalid Everything sort')
  if (!Number.isInteger(request.offset) || (request.offset as number) < 0 || (request.offset as number) > 1000000) throw new TypeError('Invalid Everything offset')
  if (!Number.isInteger(request.limit) || (request.limit as number) < 1 || (request.limit as number) > 100) throw new TypeError('Invalid Everything limit')
  return { query: request.query, filter: request.filter as EverythingSearchRequest['filter'], sort: request.sort as EverythingSearchRequest['sort'], descending: boolean(request.descending), offset: request.offset as number, limit: request.limit as number }
}
export function everythingAction(value: unknown): EverythingAction {
  if (value !== 'open' && value !== 'reveal' && value !== 'copy-path') throw new TypeError('Invalid Everything action')
  return value
}
export function everythingResultId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value)) throw new TypeError('Invalid Everything result ID')
  return value
}
