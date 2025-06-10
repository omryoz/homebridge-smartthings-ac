#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Create the dist directory if it doesn't exist
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  console.log('Creating dist directory...');
  fs.mkdirSync(distDir);
}

// Create a basic index.js file if there's an issue with TypeScript compilation
const indexFile = path.join(distDir, 'index.js');
if (!fs.existsSync(indexFile)) {
  console.log('Creating basic index.js file...');
  const content = `
// This is a fallback file created during installation
// The TypeScript compilation may have failed
// Please check the installation logs for errors

const { API } = require('homebridge');

module.exports = (api) => {
  api.registerPlatform('SmartThingsAirConditioner', 'Smartthings AC');
};
`;
  fs.writeFileSync(indexFile, content);
}

console.log('Preinstall script completed successfully.');