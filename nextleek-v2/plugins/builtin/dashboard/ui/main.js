const date = document.querySelector('#date')
const version = document.querySelector('#version')
const status = document.querySelector('#status')

function today() {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

async function loadSummary() {
  date.textContent = today()
  try {
    const summary = await window.nextleek?.runtimeSummary?.()
    version.textContent = summary?.version ? `v${summary.version}` : 'v0.1.0'
    status.textContent = summary?.mode ? `运行正常 · ${summary.mode}` : '运行正常'
  } catch {
    version.textContent = 'v0.1.0'
    status.textContent = '运行正常 · 沙箱模式'
  }
}

loadSummary()
