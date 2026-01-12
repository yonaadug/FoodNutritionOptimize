/**
 * Preload script for IPC-based communication
 * Exposes API functions to the renderer process
 */

const { contextBridge, ipcRenderer } = require('electron');

// Expose IPC-based API to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Search foods
  searchFoods: async (query, page, limit) => {
    return await ipcRenderer.invoke('api:search', { query, page, limit });
  },

  // Get top foods by nutrient
  getTopFoods: async (nutrient, limit) => {
    return await ipcRenderer.invoke('api:foods-top', { nutrient, limit });
  },

  // Optimize diet
  optimizeDiet: async (params) => {
    return await ipcRenderer.invoke('api:optimize', params);
  },

  // Get food by ID
  getFood: async (ids) => {
    return await ipcRenderer.invoke('api:food', { ids });
  },

  // Platform info
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
});

console.log('NutriCompare IPC preload script loaded');
