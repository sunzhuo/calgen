import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Patch @capgo/capacitor-calendar build.gradle for local build compatibility
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

// 2. Patch CreateEventWithPromptInput.kt
const createPromptPath = path.resolve(__dirname, '../node_modules/@capgo/capacitor-calendar/android/src/main/kotlin/app/capgo/calendar/models/inputs/CreateEventWithPromptInput.kt');
if (fs.existsSync(createPromptPath)) {
  let content = fs.readFileSync(createPromptPath, 'utf8');

  // A. Support eventLocation, location, event_location, and address when reading call inputs
  const locInputPattern = /val\s+location:\s*String\?\s*=\s*(?:call\.getString\("location"\)|call\.getString\("eventLocation"\)[\s\S]*?call\.getString\("address"\))/;
  const locInputReplacement = 'val location: String? = call.getString("eventLocation") ?: call.getString("location") ?: call.getString("event_location") ?: call.getString("address")';
  if (locInputPattern.test(content)) {
    content = content.replace(locInputPattern, locInputReplacement);
    console.log('Patched CreateEventWithPromptInput.kt location input reader');
  }

  // B. Support beginTime/endTime as fallbacks for startDate/endDate
  const startPattern = /val\s+startDate:\s*Long\?\s*=\s*(?:call\.getLong\("startDate"\)|\(call\.getLong\("startDate"\)[\s\S]*?call\.getLong\("beginTime"\)\))\?\.let/;
  content = content.replace(startPattern, 'val startDate: Long? = (call.getLong("startDate") ?: call.getLong("beginTime"))?.let');
  
  const endPattern = /val\s+endDate:\s*Long\?\s*=\s*(?:call\.getLong\("endDate"\)|\(call\.getLong\("endDate"\)[\s\S]*?call\.getLong\("endTime"\)\))\?\.let/;
  content = content.replace(endPattern, 'val endDate: Long? = (call.getLong("endDate") ?: call.getLong("endTime"))?.let');

  // C. Inject multi-key location extras into ACTION_INSERT Intent
  const extraReplacement = `location?.let {
            if (it.isNotBlank()) {
                val loc = it.trim()
                intent.putExtra(CalendarContract.Events.EVENT_LOCATION, loc)
                intent.putExtra("eventLocation", loc)
                intent.putExtra("location", loc)
                intent.putExtra("event_location", loc)
                intent.putExtra("EXTRA_EVENT_LOCATION", loc)
                intent.putExtra("address", loc)
            }
        }`;

  // Match the entire location block including all nested and closing braces
  const existingExtraPattern = /location\?\.let\s*\{[\s\S]*?intent\.putExtra\(CalendarContract\.Events\.EVENT_LOCATION[\s\S]*?(?=\s*startDate\?\.let)/;
  if (existingExtraPattern.test(content)) {
    content = content.replace(existingExtraPattern, `${extraReplacement}\n        `);
    fs.writeFileSync(createPromptPath, content, 'utf8');
    console.log('Successfully patched CreateEventWithPromptInput.kt with full location extra keys');
  } else {
    fs.writeFileSync(createPromptPath, content, 'utf8');
  }
}

// 3. Patch ModifyEventWithPromptInput.kt
const modifyPromptPath = path.resolve(__dirname, '../node_modules/@capgo/capacitor-calendar/android/src/main/kotlin/app/capgo/calendar/models/inputs/ModifyEventWithPromptInput.kt');
if (fs.existsSync(modifyPromptPath)) {
  let content = fs.readFileSync(modifyPromptPath, 'utf8');
  const modifyExtraReplacement = `input.location?.let {
            if (it.isNotBlank()) {
                val loc = it.trim()
                intent.putExtra(CalendarContract.Events.EVENT_LOCATION, loc)
                intent.putExtra("eventLocation", loc)
                intent.putExtra("location", loc)
                intent.putExtra("event_location", loc)
                intent.putExtra("EXTRA_EVENT_LOCATION", loc)
                intent.putExtra("address", loc)
            }
        }`;

  const existingModifyPattern = /input\.location\?\.let\s*\{[\s\S]*?intent\.putExtra\(CalendarContract\.Events\.EVENT_LOCATION[\s\S]*?(?=\s*input\.startDate\?\.let)/;
  if (existingModifyPattern.test(content)) {
    content = content.replace(existingModifyPattern, `${modifyExtraReplacement}\n        `);
    fs.writeFileSync(modifyPromptPath, content, 'utf8');
    console.log('Successfully patched ModifyEventWithPromptInput.kt with full location extra keys');
  }
}
