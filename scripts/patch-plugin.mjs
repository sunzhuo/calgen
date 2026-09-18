import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pluginGradlePath = path.resolve(__dirname, '../node_modules/@capgo/capacitor-calendar/android/build.gradle');

if (fs.existsSync(pluginGradlePath)) {
  let content = fs.readFileSync(pluginGradlePath, 'utf8');

  // Replace AGP version to match root project
  content = content.replace(/'com.android.tools.build:gradle:8\.13\.0'/g, "'com.android.tools.build:gradle:8.9.1'");

  // Replace Java 21 with Java 17 for local JDK 17 compatibility
  content = content.replace(/JavaVersion\.VERSION_21/g, 'JavaVersion.VERSION_17');
  content = content.replace(/jvmToolchain\(21\)/g, 'jvmToolchain(17)');

  // Ensure Aliyun repositories are added for fast download in China
  const aliyunRepos = `maven { url 'https://maven.aliyun.com/repository/google' }\n        maven { url 'https://maven.aliyun.com/repository/public' }\n        maven { url 'https://maven.aliyun.com/repository/gradle-plugin' }`;
  if (!content.includes('maven.aliyun.com')) {
    content = content.replace(/repositories\s*\{/g, `repositories {\n        ${aliyunRepos}`);
  }

  fs.writeFileSync(pluginGradlePath, content, 'utf8');
  console.log('Successfully patched @capgo/capacitor-calendar build.gradle for JDK 17 & AGP 8.9.1');
} else {
  console.log('Plugin build.gradle not found at', pluginGradlePath);
}

