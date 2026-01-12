console.log('Test 1: Regular require');
try {
  const electron = require('electron');
  console.log(' Type:', typeof electron);
  console.log(' Value:', electron);
} catch (err) {
  console.error(' Error:', err.message);
}

console.log('\nTest 2: Process versions');
console.log(' Node:', process.versions.node);
console.log(' Electron:', process.versions.electron);
console.log(' Chrome:', process.versions.chrome);

console.log('\nTest 3: Process type');
console.log(' Type:', process.type);

console.log('\nTest 4: Module paths');
console.log(' Paths:', require.resolve.paths('electron'));
