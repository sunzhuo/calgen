package dev.pages.calgen;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Log;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "CalGenMainActivity";
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    // Known text/calendar extensions to prioritize inside archives
    private static final Set<String> TEXT_EXTENSIONS = new HashSet<>(Arrays.asList(
        "txt", "md", "csv", "json", "ics", "ical", "vcf", "log", "html", "htm", "xml", "text"
    ));

    // Binary extensions to explicitly skip
    private static final Set<String> BINARY_EXTENSIONS = new HashSet<>(Arrays.asList(
        "png", "jpg", "jpeg", "gif", "webp", "bmp", "mp3", "mp4", "wav", "aac", "avi", "mov",
        "pdf", "exe", "apk", "so", "dex", "class", "jar", "zip", "rar", "7z", "tar", "gz"
    ));

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativeCalendarPlugin.class);
        super.onCreate(savedInstanceState);
        handleIncomingIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIncomingIntent(intent);
    }

    private void handleIncomingIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (action == null) return;

        if (Intent.ACTION_SEND.equals(action) || Intent.ACTION_VIEW.equals(action) || Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            executor.execute(() -> processIntentInBackground(intent));
        }
    }

    private void processIntentInBackground(Intent intent) {
        try {
            String action = intent.getAction();

            // 1. Direct text sharing (e.g. highlighted text in another app)
            String extraText = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (extraText != null && !extraText.trim().isEmpty() && !Intent.ACTION_VIEW.equals(action)) {
                // If it's a plain text share without any stream, dispatch directly
                Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (stream == null) {
                    dispatchSharedPayload(extraText.trim(), "text", null, 1);
                    return;
                }
            }

            // 2. Stream / File URI handling
            List<Uri> uris = new ArrayList<>();
            if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
                ArrayList<Uri> extraUris = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
                if (extraUris != null) {
                    uris.addAll(extraUris);
                }
            } else if (Intent.ACTION_SEND.equals(action)) {
                Uri streamUri = intent.getParcelableExtra(Intent.EXTRA_STREAM);
                if (streamUri != null) {
                    uris.add(streamUri);
                }
            } else if (Intent.ACTION_VIEW.equals(action)) {
                Uri dataUri = intent.getData();
                if (dataUri != null) {
                    uris.add(dataUri);
                }
            }

            if (uris.isEmpty() && extraText != null && !extraText.trim().isEmpty()) {
                dispatchSharedPayload(extraText.trim(), "text", null, 1);
                return;
            }

            for (Uri uri : uris) {
                processSingleUri(uri, extraText);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error processing incoming share intent", e);
        }
    }

    private void processSingleUri(Uri uri, String fallbackText) {
        String fileName = getFileName(uri);
        String mimeType = getContentResolver().getType(uri);

        Log.d(TAG, "Processing URI: " + uri + ", fileName: " + fileName + ", mime: " + mimeType);

        boolean isZip = isZipFile(uri, fileName, mimeType);
        if (isZip) {
            Log.d(TAG, "Detected ZIP archive, attempting decompression...");
            ZipExtractionResult result = extractTextFromZip(uri);
            if (result != null && result.text != null && !result.text.trim().isEmpty()) {
                dispatchSharedPayload(result.text.trim(), "zip", fileName, result.fileCount);
                return;
            } else {
                Log.w(TAG, "No readable text found inside ZIP archive: " + fileName);
            }
        } else {
            // Read direct file as text
            String content = readDirectText(uri);
            if (content != null && !content.trim().isEmpty()) {
                dispatchSharedPayload(content.trim(), "file", fileName, 1);
                return;
            }
        }

        // Fallback to text if file couldn't be parsed
        if (fallbackText != null && !fallbackText.trim().isEmpty()) {
            dispatchSharedPayload(fallbackText.trim(), "text", fileName, 1);
        }
    }

    private boolean isZipFile(Uri uri, String fileName, String mimeType) {
        if (fileName != null && fileName.toLowerCase().endsWith(".zip")) {
            return true;
        }
        if (mimeType != null && (mimeType.contains("zip") || mimeType.contains("compressed"))) {
            return true;
        }

        // Check magic bytes PK\x03\x04
        try (InputStream is = getContentResolver().openInputStream(uri)) {
            if (is != null) {
                byte[] magic = new byte[4];
                int read = is.read(magic);
                if (read == 4 && magic[0] == 0x50 && magic[1] == 0x4B && magic[2] == 0x03 && magic[3] == 0x04) {
                    return true;
                }
            }
        } catch (Exception ignored) {}

        return false;
    }

    private static class ZipExtractionResult {
        String text;
        int fileCount;
        ZipExtractionResult(String text, int fileCount) {
            this.text = text;
            this.fileCount = fileCount;
        }
    }

    private ZipExtractionResult extractTextFromZip(Uri uri) {
        // First attempt with UTF-8, then fallback to GBK if illegal characters occur
        ZipExtractionResult res = doExtractZipWithCharset(uri, StandardCharsets.UTF_8);
        if (res == null || res.text == null || res.text.trim().isEmpty()) {
            try {
                Charset gbk = Charset.forName("GBK");
                res = doExtractZipWithCharset(uri, gbk);
            } catch (Exception ignored) {}
        }
        return res;
    }

    private ZipExtractionResult doExtractZipWithCharset(Uri uri, Charset charset) {
        StringBuilder combinedText = new StringBuilder();
        int textFilesFound = 0;
        final int MAX_TOTAL_BYTES = 1024 * 1024 * 2; // 2MB max
        final int MAX_ENTRY_BYTES = 1024 * 512;      // 512KB per file
        int totalBytesRead = 0;

        try (InputStream is = getContentResolver().openInputStream(uri)) {
            if (is == null) return null;
            try (ZipInputStream zis = new ZipInputStream(new BufferedInputStream(is), charset)) {
                ZipEntry entry;
                while ((entry = zis.getNextEntry()) != null) {
                    if (entry.isDirectory()) continue;
                    String entryName = entry.getName();
                    if (entryName == null) continue;

                    // Skip macOS metadata and hidden files
                    if (entryName.contains("__MACOSX") || entryName.startsWith(".") || entryName.endsWith(".DS_Store")) {
                        continue;
                    }

                    String ext = "";
                    int dotIndex = entryName.lastIndexOf('.');
                    if (dotIndex != -1) {
                        ext = entryName.substring(dotIndex + 1).toLowerCase();
                    }

                    if (BINARY_EXTENSIONS.contains(ext)) {
                        continue;
                    }

                    // Read bytes of entry
                    ByteArrayOutputStream buffer = new ByteArrayOutputStream();
                    byte[] temp = new byte[4096];
                    int len;
                    int entryBytes = 0;
                    while ((len = zis.read(temp)) != -1) {
                        buffer.write(temp, 0, len);
                        entryBytes += len;
                        if (entryBytes > MAX_ENTRY_BYTES || (totalBytesRead + entryBytes) > MAX_TOTAL_BYTES) {
                            break;
                        }
                    }

                    byte[] data = buffer.toByteArray();
                    if (data.length == 0) continue;

                    // Check if bytes are text
                    if (isLikelyText(data)) {
                        String entryContent = decodeString(data, charset);
                        if (entryContent != null && !entryContent.trim().isEmpty()) {
                            textFilesFound++;
                            totalBytesRead += data.length;
                            if (combinedText.length() > 0) {
                                combinedText.append("\n\n=== 提取文件: ").append(entryName).append(" ===\n");
                            }
                            combinedText.append(entryContent.trim());
                        }
                    }

                    if (totalBytesRead >= MAX_TOTAL_BYTES) {
                        break;
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Zip extraction with charset " + charset.name() + " encountered issue: " + e.getMessage());
        }

        if (textFilesFound == 0) return null;
        return new ZipExtractionResult(combinedText.toString(), textFilesFound);
    }

    private String readDirectText(Uri uri) {
        try (InputStream is = getContentResolver().openInputStream(uri)) {
            if (is == null) return null;
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] temp = new byte[4096];
            int len;
            int total = 0;
            while ((len = is.read(temp)) != -1) {
                buffer.write(temp, 0, len);
                total += len;
                if (total > 1024 * 1024) break; // 1MB max
            }
            byte[] data = buffer.toByteArray();
            if (isLikelyText(data)) {
                return decodeString(data, StandardCharsets.UTF_8);
            }
        } catch (Exception e) {
            Log.w(TAG, "Failed reading direct text from URI: " + e.getMessage());
        }
        return null;
    }

    private boolean isLikelyText(byte[] data) {
        int checkLen = Math.min(data.length, 1024);
        int nullCount = 0;
        for (int i = 0; i < checkLen; i++) {
            if (data[i] == 0) nullCount++;
        }
        return nullCount == 0;
    }

    private String decodeString(byte[] data, Charset defaultCharset) {
        try {
            return new String(data, defaultCharset);
        } catch (Exception ignored) {
            try {
                return new String(data, Charset.forName("GBK"));
            } catch (Exception e) {
                return new String(data, StandardCharsets.ISO_8859_1);
            }
        }
    }

    private String getFileName(Uri uri) {
        String result = null;
        if (ContentResolver.SCHEME_CONTENT.equals(uri.getScheme())) {
            try (Cursor cursor = getContentResolver().query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (nameIndex != -1) {
                        result = cursor.getString(nameIndex);
                    }
                }
            } catch (Exception ignored) {}
        }
        if (result == null) {
            result = uri.getLastPathSegment();
        }
        return result != null ? result : "unknown_file";
    }

    private void dispatchSharedPayload(String text, String source, String fileName, int entryCount) {
        try {
            JSONObject obj = new JSONObject();
            obj.put("text", text);
            obj.put("source", source);
            obj.put("fileName", fileName != null ? fileName : "");
            obj.put("entryCount", entryCount);

            String payloadJson = obj.toString();
            String js = "window.__CALGEN_SHARED_PAYLOAD__ = " + payloadJson + "; " +
                        "window.__CALGEN_SHARED_TEXT__ = " + JSONObject.quote(text) + "; " +
                        "window.dispatchEvent(new CustomEvent('calgen:sharedText', { detail: " + payloadJson + " }));";

            dispatchJsToWebView(js);
        } catch (Exception e) {
            Log.e(TAG, "Error formatting shared payload JSON", e);
        }
    }

    private void dispatchJsToWebView(String js) {
        runOnUiThread(() -> {
            if (getBridge() != null && getBridge().getWebView() != null) {
                WebView webView = getBridge().getWebView();
                webView.evaluateJavascript(js, null);
            } else {
                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                    if (getBridge() != null && getBridge().getWebView() != null) {
                        WebView webView = getBridge().getWebView();
                        webView.evaluateJavascript(js, null);
                    }
                }, 600);
            }
        });
    }
}
