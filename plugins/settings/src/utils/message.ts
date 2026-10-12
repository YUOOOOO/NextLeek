import { ElMessage } from 'element-plus'

/**
 * 将未知错误归一化为可直接展示的文案。
 */
export function toDisplayMessage(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }

  return fallback
}

function resolveErrorMessage(first: unknown, fallback?: string): string {
  if (typeof fallback === 'string') {
    return toDisplayMessage(first, fallback)
  }

  if (typeof first === 'string' && first.trim()) {
    return first.trim()
  }

  if (first instanceof Error && first.message.trim()) {
    return first.message.trim()
  }

  return '操作失败'
}

/**
 * 统一展示错误提示。
 */
export function showErrorMessage(
  error: unknown,
  fallback?: string | number,
  duration = 3000
): void {
  const nextDuration = typeof fallback === 'number' ? fallback : duration
  ElMessage.error({
    message: resolveErrorMessage(error, typeof fallback === 'string' ? fallback : undefined),
    duration: nextDuration
  })
}

/**
 * 统一展示成功提示。
 */
export function showSuccessMessage(message: string, duration = 3000): void {
  ElMessage.success({
    message,
    duration
  })
}

/**
 * 统一展示警告提示。
 */
export function showWarningMessage(message: string, duration = 3000): void {
  ElMessage.warning({
    message,
    duration
  })
}

/**
 * 统一展示信息提示。
 */
export function showInfoMessage(message: string, duration = 3000): void {
  ElMessage.info({
    message,
    duration
  })
}
