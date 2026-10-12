// 将浏览器按键转为插件快捷键使用的规范组合键。
export function keyboardAccelerator(event: KeyboardEvent): string | null {
  if (event.isComposing || event.repeat || ['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null
  if (!(event.ctrlKey || event.altKey || event.metaKey) && !/^F(?:[1-9]|1[0-9]|2[0-4])$/.test(event.key)) return null
  const key = event.code === 'Space' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key.replace(/^Arrow/, '')
  return [...(event.ctrlKey ? ['Control'] : []), ...(event.altKey ? ['Alt'] : []), ...(event.shiftKey ? ['Shift'] : []), ...(event.metaKey ? ['Meta'] : []), key].join('+')
}
