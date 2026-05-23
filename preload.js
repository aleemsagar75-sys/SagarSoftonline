const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("SagarSoftDesktop", {
  savePdf(payload) {
    return ipcRenderer.invoke("sagarsoft:save-pdf", payload);
  },
  openExternal(url) {
    return ipcRenderer.invoke("sagarsoft:open-external", url);
  },
  openPrintHtml(payload) {
    return ipcRenderer.invoke("sagarsoft:open-print-html", payload);
  }
});
