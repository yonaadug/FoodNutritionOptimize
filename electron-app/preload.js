/**
 * Preload script for Electron
 * Runs before the web page is loaded
 * Has access to both DOM APIs and Node.js APIs
 */

const { contextBridge } = require('electron');

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
});

console.log('NutriCompare Electron preload script loaded');
