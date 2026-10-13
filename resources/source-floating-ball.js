// 原版交互仅通过受限预加载桥访问浮球 IPC 和拖入文件。
const { ipcRenderer, webUtils, path, fs } = window.floatingBall
const ball = document.getElementById('ball')

// ==================== 悬浮球移动（点击 + 拖拽 + 双击） ====================
let isMouseDown = false
let isDragging = false
let startScreenX = 0
let startScreenY = 0
const DRAG_THRESHOLD = 5

// 双击检测
let lastClickTime = 0
const DOUBLE_CLICK_DELAY = 300 // 双击间隔 300ms

ball.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return
  isMouseDown = true
  isDragging = false
  startScreenX = e.screenX
  startScreenY = e.screenY
  ball.classList.add('pressing')
  ball.classList.remove('dragging')
})

document.addEventListener('mousemove', (e) => {
  if (!isMouseDown) return
  const dx = e.screenX - startScreenX
  const dy = e.screenY - startScreenY
  if (!isDragging && Math.sqrt(dx * dx + dy * dy) >= DRAG_THRESHOLD) {
    isDragging = true
    ball.classList.remove('pressing')
    ball.classList.add('dragging')
    ipcRenderer.send('floating-ball-drag-start', {
      mouseScreenX: e.screenX,
      mouseScreenY: e.screenY
    })
  }
  if (isDragging) {
    ipcRenderer.send('floating-ball-dragging', {
      screenX: e.screenX,
      screenY: e.screenY
    })
  }
})

document.addEventListener('mouseup', () => {
  if (!isMouseDown) return
  isMouseDown = false
  ball.classList.remove('pressing')
  ball.classList.remove('dragging')
  if (isDragging) {
    isDragging = false
    ipcRenderer.send('floating-ball-drag-end')
  } else {
    // 检测双击
    const now = Date.now()
    if (now - lastClickTime < DOUBLE_CLICK_DELAY) {
      // 双击
      ipcRenderer.send('floating-ball-double-click')
      lastClickTime = 0 // 重置时间，避免三击被识别为两次双击
    } else {
      // 单击
      ipcRenderer.send('floating-ball-click')
      lastClickTime = now
    }
  }
})

// 右键菜单
ball.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  ipcRenderer.send('floating-ball-contextmenu')
})

// ==================== 接收文字配置 ====================
const letterEl = document.querySelector('.floating-ball-letter')
ipcRenderer.on('floating-ball-set-letter', (_event, letter) => {
  if (letterEl) {
    letterEl.textContent = letter || 'Z'
  }
})

// ==================== 文件拖放（从 Finder / 资源管理器拖入文件） ====================
document.addEventListener('dragover', (e) => {
  e.preventDefault()
  e.stopPropagation()
  if (e.dataTransfer) {
    e.dataTransfer.dropEffect = 'copy'
  }
  ball.classList.add('file-hover')
})

document.addEventListener('dragleave', (e) => {
  e.preventDefault()
  e.stopPropagation()
  ball.classList.remove('file-hover')
})

document.addEventListener('drop', (e) => {
  e.preventDefault()
  e.stopPropagation()
  ball.classList.remove('file-hover')

  const files = e.dataTransfer && e.dataTransfer.files
  if (!files || files.length === 0) return

  // 收集文件信息（Electron 32+ 必须用 webUtils.getPathForFile 获取路径）
  const fileItems = []
  for (let i = 0; i < files.length; i++) {
    const filePath = webUtils.getPathForFile(files[i])
    if (!filePath) continue
    try {
      const stat = fs.statSync(filePath)
      fileItems.push({
        path: filePath,
        name: path.basename(filePath),
        isDirectory: stat.isDirectory()
      })
    } catch (err) {
      console.warn('无法读取文件信息:', filePath, err)
    }
  }

  if (fileItems.length > 0) {
    ipcRenderer.send('floating-ball-file-drop', fileItems)
  }
})
