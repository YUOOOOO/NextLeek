import { win32 } from 'node:path'

export interface ApplicationIconImage {
  isEmpty(): boolean
  toDataURL(): string
}

export interface ApplicationIconEnvironment {
  platform?: NodeJS.Platform
  variables?: NodeJS.ProcessEnv
  readShortcutLink(path: string): { target: string; icon?: string; iconIndex?: number }
  getFileIcon(path: string): Promise<ApplicationIconImage>
  nativeImage: { createFromPath(path: string): ApplicationIconImage }
}

function shortcutPath(value: string | undefined, shortcut: string, variables: NodeJS.ProcessEnv): string | undefined {
  if (!value) return undefined
  let path = value.trim()
  if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1)
  path = path.replace(/%([^%]+)%/g, (match, name: string) => {
    for (const key in variables) {
      if (key.toLowerCase() === name.toLowerCase()) return variables[key] ?? match
    }
    return match
  })
  if (!path || /[%\0"<>|*]/.test(path) || /^[a-z][a-z\d+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) return undefined
  const absolute = /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i
  if (!absolute.test(path) && !absolute.test(shortcut)) return undefined
  return win32.resolve(win32.dirname(shortcut), path)
}

function imageUrl(image: ApplicationIconImage): string {
  if (image.isEmpty()) throw new Error('Application icon is empty')
  const url = image.toDataURL()
  if (!url) throw new Error('Application icon has no image data')
  return url
}

export async function getApplicationIcon(path: string, environment: ApplicationIconEnvironment): Promise<string> {
  if ((environment.platform ?? process.platform) !== 'win32' || win32.extname(path).toLowerCase() !== '.lnk') {
    return imageUrl(await environment.getFileIcon(path))
  }

  const shortcut = environment.readShortcutLink(path)
  const variables = environment.variables ?? process.env
  const icon = shortcutPath(shortcut.icon, path, variables)
  if (icon) {
    const extension = win32.extname(icon).toLowerCase()
    try {
      if (['.ico', '.png', '.jpg', '.jpeg'].includes(extension)) {
        return imageUrl(environment.nativeImage.createFromPath(icon))
      }
      if (extension === '.exe' && (shortcut.iconIndex === undefined || shortcut.iconIndex === 0)) {
        return imageUrl(await environment.getFileIcon(icon))
      }
    } catch {
      // Missing or invalid custom images still fall back to the application's native icon.
    }
  }

  // Electron cannot select DLL/EXE resource indices; use the target, never a generic .lnk icon.
  const target = shortcutPath(shortcut.target, path, variables)
  if (!target || win32.extname(target).toLowerCase() === '.lnk') throw new Error('Application shortcut has no usable icon target')
  return imageUrl(await environment.getFileIcon(target))
}
