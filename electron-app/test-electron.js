console.log('Testing electron require...');
try {
  const electron = require('electron');
  console.log('Electron type:', typeof electron);
  console.log('Electron value:', electron);
  console.log('Is string?', typeof electron === 'string');
} catch (err) {
  console.error('Failed to load electron:', err);
}
