const { app, BrowserWindow, ipcMain, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

function sanitizeFileName(value) {
  return String(value || "SagarSoft-DMC.pdf")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "SagarSoft-DMC.pdf";
}

async function getAvailablePdfPath(fileName) {
  const downloadsDir = app.getPath("downloads");
  const safeName = sanitizeFileName(fileName).replace(/\.pdf$/i, "");
  let candidate = path.join(downloadsDir, `${safeName}.pdf`);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(downloadsDir, `${safeName}-${counter}.pdf`);
    counter += 1;
  }
  return candidate;
}

function createWindow() {
  let sessionClearedForClose = false;
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#eef3f7",
    icon: path.join(__dirname, "assets", "app-icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "login.html"), {
    query: { freshStart: "1" }
  });
  mainWindow.once("ready-to-show", function () {
    mainWindow.show();
  });

  mainWindow.on("close", function (event) {
    if (sessionClearedForClose) {
      return;
    }

    event.preventDefault();
    mainWindow.webContents
      .executeJavaScript("sessionStorage.removeItem('sagarsoft_session'); localStorage.removeItem('sagarsoft_session');", true)
      .catch(function () {
        return null;
      })
      .finally(function () {
        sessionClearedForClose = true;
        mainWindow.close();
      });
  });
}

ipcMain.handle("sagarsoft:save-pdf", async function (_event, payload) {
  const html = payload && payload.html ? String(payload.html) : "";
  if (!html) {
    return { success: false, message: "PDF content is empty." };
  }

  const pdfWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true
    }
  });
  const tempHtmlPath = path.join(app.getPath("temp"), `sagarsoft-dmc-${Date.now()}.html`);

  try {
    await fs.promises.writeFile(tempHtmlPath, html, "utf8");
    await pdfWindow.loadFile(tempHtmlPath);
    await pdfWindow.webContents.executeJavaScript("document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();");
    const pdfBuffer = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: "A4",
      margins: {
        marginType: "default"
      }
    });
    const filePath = await getAvailablePdfPath(payload && payload.fileName ? payload.fileName : "SagarSoft-DMC.pdf");
    await fs.promises.writeFile(filePath, pdfBuffer);
    return { success: true, filePath };
  } catch (error) {
    return {
      success: false,
      message: error && error.message ? error.message : "Unable to save PDF."
    };
  } finally {
    fs.promises.unlink(tempHtmlPath).catch(function () {
      return null;
    });
    if (!pdfWindow.isDestroyed()) {
      pdfWindow.destroy();
    }
  }
});

ipcMain.handle("sagarsoft:open-external", async function (_event, url) {
  const targetUrl = String(url || "").trim();
  if (!targetUrl) {
    return { success: false, message: "URL is empty." };
  }
  try {
    await shell.openExternal(targetUrl);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      message: error && error.message ? error.message : "Unable to open link."
    };
  }
});

ipcMain.handle("sagarsoft:open-print-html", async function (_event, payload) {
  const html = payload && payload.html ? String(payload.html) : "";
  if (!html) {
    return { success: false, message: "Print content is empty." };
  }
  const tempHtmlPath = path.join(app.getPath("temp"), `sagarsoft-print-${Date.now()}.html`);
  try {
    await fs.promises.writeFile(tempHtmlPath, html, "utf8");
    await shell.openExternal(pathToFileURL(tempHtmlPath).toString());
    setTimeout(function () {
      fs.promises.unlink(tempHtmlPath).catch(function () {
        return null;
      });
    }, 300000);
    return { success: true, filePath: tempHtmlPath };
  } catch (error) {
    fs.promises.unlink(tempHtmlPath).catch(function () {
      return null;
    });
    return {
      success: false,
      message: error && error.message ? error.message : "Unable to open print window."
    };
  }
});

app.whenReady().then(function () {
  createWindow();
  app.on("activate", function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
