#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('Running preinstall script for homebridge-smartthings-ac-omryoz-fork...');

// Create the dist directory if it doesn't exist
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  console.log('Creating dist directory...');
  try {
    fs.mkdirSync(distDir, { recursive: true });
    console.log('Dist directory created successfully.');
  } catch (error) {
    console.error('Failed to create dist directory:', error.message);
  }
}

// Create a basic index.js file if there's an issue with TypeScript compilation
const indexFile = path.join(distDir, 'index.js');
if (!fs.existsSync(indexFile)) {
  console.log('Creating basic index.js file...');
  const content = `"use strict";
const settings_1 = require("./settings");
const platform_1 = require("./platform");
module.exports = (api) => {
    api.registerPlatform(settings_1.PLATFORM_NAME, platform_1.SmartThingsPlatform);
};`;
  
  try {
    fs.writeFileSync(indexFile, content);
    console.log('Basic index.js file created successfully.');
  } catch (error) {
    console.error('Failed to create index.js file:', error.message);
  }
}

console.log('Preinstall script completed successfully.');