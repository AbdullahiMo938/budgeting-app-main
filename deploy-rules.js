// Script to deploy Firebase rules
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('Deploying Firebase rules...');

try {
  // Check if firebase-tools is installed
  try {
    execSync('firebase --version', { stdio: 'inherit' });
  } catch (error) {
    console.log('Installing firebase-tools...');
    execSync('npm install -g firebase-tools', { stdio: 'inherit' });
  }

  // Login to Firebase (if needed)
  try {
    execSync('firebase projects:list', { stdio: 'inherit' });
  } catch (error) {
    console.log('Please login to Firebase:');
    execSync('firebase login', { stdio: 'inherit' });
  }

  // Deploy Firestore rules
  console.log('Deploying Firestore rules...');
  execSync('firebase deploy --only firestore:rules', { stdio: 'inherit' });

  console.log('Firebase rules deployed successfully!');
} catch (error) {
  console.error('Error deploying Firebase rules:', error.message);
  process.exit(1);
} 