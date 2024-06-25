import { app, shell, BrowserWindow, ipcMain, dialog, Notification } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import {
  FFMPEG_PROGRESS_INFO,
  GET_LIVE_URLS,
  NAV_BY_DEFAULT_BROWSER,
  RECORD_DUMMY_PROCESS,
  SELECT_DIR,
  SHOW_NOTIFICATION,
  START_STREAM_RECORD,
  STOP_STREAM_RECORD,
  STREAM_RECORD_END
} from '../const'
import { getLiveUrls } from './crawler/index'
import { FFMPEG_ERROR_CODE, SUCCESS_CODE } from '../code'
import {
  recordStream,
  recordStreamFfmpegProgressInfo,
  recordStreamFfmpegProcessMap,
  resetRecordStreamFfmpeg,
  setRecordStreamFfmpegProcessMap
} from './ffmpeg/record'

let timer: NodeJS.Timeout | undefined
const startTimerWhenFirstFfmpegProcessStart = () => {
  if (timer === undefined) {
    timer = setInterval(() => {
      win?.webContents.send(FFMPEG_PROGRESS_INFO, recordStreamFfmpegProgressInfo)
    }, 1000)
  }
}
const isAllFfmpegProcessEnd = () =>
  Object.keys(recordStreamFfmpegProcessMap).every(
    (key) =>
      Object.keys(recordStreamFfmpegProcessMap[key as keyof typeof recordStreamFfmpegProcessMap])
        .length === 0
  ) &&
  Object.keys(recordStreamFfmpegProgressInfo).every(
    (key) =>
      Object.keys(
        recordStreamFfmpegProgressInfo[key as keyof typeof recordStreamFfmpegProgressInfo]
      ).length === 0
  )
export const clearTimerWhenAllFfmpegProcessEnd = () => {
  if (isAllFfmpegProcessEnd()) {
    win?.webContents.send(FFMPEG_PROGRESS_INFO, recordStreamFfmpegProgressInfo)

    clearInterval(timer)
    timer = undefined
  }
}

let win: BrowserWindow | null
function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    titleBarStyle: 'hiddenInset',
    title: 'Fideo',
    autoHideMenuBar: true,
    // ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  win = mainWindow

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function showNotification(title: string, body: string) {
  const notification = new Notification({
    title,
    body
  })
  notification.show()
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle(SELECT_DIR, async () => {
    const dir = await dialog.showOpenDialog({
      properties: ['openDirectory']
    })
    return dir
  })

  ipcMain.handle(
    GET_LIVE_URLS,
    async (_, info: { roomUrl: string; proxy?: string; cookie?: string }) => {
      const { roomUrl, proxy, cookie } = info
      return getLiveUrls({ roomUrl, proxy, cookie })
    }
  )

  ipcMain.handle(NAV_BY_DEFAULT_BROWSER, (_, url: string) => {
    shell.openExternal(url)
  })

  ipcMain.handle(START_STREAM_RECORD, async (_, streamConfigStr: string) => {
    const streamConfig = JSON.parse(streamConfigStr) as IStreamConfig
    const { roomUrl, proxy, cookie, title } = streamConfig

    setRecordStreamFfmpegProcessMap(title, RECORD_DUMMY_PROCESS)

    const { code: liveUrlsCode, liveUrls } = await getLiveUrls({ roomUrl, proxy, cookie })
    if (liveUrlsCode !== SUCCESS_CODE) {
      return {
        code: liveUrlsCode
      }
    }
    streamConfig.liveUrls = liveUrls

    const { code: recordStreamCode } = await recordStream(streamConfig, (code: number) => {
      win?.webContents.send(STREAM_RECORD_END, title, code)
      clearTimerWhenAllFfmpegProcessEnd()
    })

    startTimerWhenFirstFfmpegProcessStart()

    return {
      code: recordStreamCode
    }
  })

  ipcMain.handle(STOP_STREAM_RECORD, async (_, title: string) => {
    const shouldSend = resetRecordStreamFfmpeg(title)
    shouldSend &&
      win?.webContents.send(STREAM_RECORD_END, title, FFMPEG_ERROR_CODE.USER_KILL_PROCESS)
    clearTimerWhenAllFfmpegProcessEnd()

    return {
      code: SUCCESS_CODE
    }
  })

  ipcMain.handle(SHOW_NOTIFICATION, (_, title: string, body: string) => {
    showNotification(title, body)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app"s specific main process
// code. You can also put them in separate files and require them here.
