import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('=== [1/3] Building web assets and syncing Capacitor ===');
execSync('npm run cap:build', { cwd: rootDir, stdio: 'inherit' });

console.log('\n=== [2/3] Compiling Android Release APK with Gradle ===');
const isWindows = process.platform === 'win32';
const gradlewCmd = isWindows ? 'gradlew.bat' : './gradlew';
execSync(`${gradlewCmd} assembleRelease`, { cwd: path.join(rootDir, 'android'), stdio: 'inherit' });

const apkSrc = path.join(rootDir, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
const appDir = path.join(rootDir, 'app');
const distAppDir = path.join(rootDir, 'dist', 'app');

if (!fs.existsSync(apkSrc)) {
  throw new Error(`Build output APK not found at ${apkSrc}`);
}

if (!fs.existsSync(appDir)) {
  fs.mkdirSync(appDir, { recursive: true });
}
if (!fs.existsSync(distAppDir)) {
  fs.mkdirSync(distAppDir, { recursive: true });
}

const targetAppApk = path.join(appDir, 'calgen.apk');
const targetDistApk = path.join(distAppDir, 'calgen.apk');

fs.copyFileSync(apkSrc, targetAppApk);
fs.copyFileSync(apkSrc, targetDistApk);

const stats = fs.statSync(targetAppApk);
console.log(`\n=== [3/3] APK Distribution Update Complete ===`);
console.log(`- Updated: app/calgen.apk`);
console.log(`- Updated: dist/app/calgen.apk`);
console.log(`- File Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB (${stats.size} bytes)\n`);
