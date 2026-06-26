const { ipcRenderer } = window.require('electron');

export function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args);
}

export function on(channel, listener) {
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

export function openExternal(url) {
  const { shell } = window.require('electron');
  shell.openExternal(url);
}
