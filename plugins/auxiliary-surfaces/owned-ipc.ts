import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'

/** Every listener is main-frame/sender scoped and revoked with its owning Cordis effect. */
export function createOwnedIPC(ipc: IpcMain, allowed: (channel: string, sender: WebContents) => boolean) {
  const cleanup: Array<() => void> = []
  const accepts = (channel: string, event: IpcMainEvent | IpcMainInvokeEvent) => event.senderFrame === event.sender.mainFrame && allowed(channel, event.sender)
  return {
    on<Args extends unknown[]>(channel: string, listener: (event: IpcMainEvent, ...args: Args) => void) {
      const guarded = (event: IpcMainEvent, ...args: Args) => {
        if (accepts(channel, event)) listener(event, ...args)
      }
      ipc.on(channel, guarded)
      cleanup.push(() => ipc.removeListener(channel, guarded))
    },
    handle<Args extends unknown[]>(channel: string, listener: (event: IpcMainInvokeEvent, ...args: Args) => unknown) {
      ipc.handle(channel, (event, ...args: Args) => {
        if (!accepts(channel, event)) throw new Error('Auxiliary surface IPC sender denied')
        return listener(event, ...args)
      })
      cleanup.push(() => ipc.removeHandler(channel))
    },
    dispose() {
      for (const revoke of cleanup.splice(0).reverse()) revoke()
    },
  }
}
