console.log('=== Minimal Electron Test ===');
console.log('process.type:', process.type);
console.log('process.versions.electron:', process.versions.electron);

try {
  const electron = require('electron');
  console.log('electron type:', typeof electron);

  if (typeof electron === 'object') {
    console.log('✓ Electron module loaded correctly');
    const { app } = electron;

    app.whenReady().then(() => {
      console.log('✓ App ready!');
      app.quit();
    });
  } else {
    console.error('✗ Electron module returned:', electron);
    process.exit(1);
  }
} catch (err) {
  console.error('✗ Error:', err.message);
  process.exit(1);
}
