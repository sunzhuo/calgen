package dev.pages.calgen;

import android.Manifest;
import android.app.AlertDialog;
import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.CalendarContract;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

@CapacitorPlugin(
    name = "NativeCalendar",
    permissions = {
        @Permission(
            alias = "calendar",
            strings = {
                Manifest.permission.READ_CALENDAR,
                Manifest.permission.WRITE_CALENDAR
            }
        )
    }
)
public class NativeCalendarPlugin extends Plugin {

    private static final String TAG = "NativeCalendarPlugin";

    @PluginMethod
    public void checkCalendarPermission(PluginCall call) {
        boolean granted = getPermissionState("calendar") == PermissionState.GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void requestCalendarPermission(PluginCall call) {
        if (getPermissionState("calendar") == PermissionState.GRANTED) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        requestPermissionForAlias("calendar", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        boolean granted = getPermissionState("calendar") == PermissionState.GRANTED;
        JSObject ret = new JSObject();
        ret.put("granted", granted);
        call.resolve(ret);
    }

    @PluginMethod
    public void createAndOpenEvent(PluginCall call) {
        if (getPermissionState("calendar") != PermissionState.GRANTED) {
            requestPermissionForAlias("calendar", call, "createEventPermissionCallback");
            return;
        }
        prepareAndConfirmEvent(call);
    }

    @PermissionCallback
    private void createEventPermissionCallback(PluginCall call) {
        if (getPermissionState("calendar") == PermissionState.GRANTED) {
            prepareAndConfirmEvent(call);
        } else {
            call.reject("Calendar permission denied by user");
        }
    }

    private void prepareAndConfirmEvent(PluginCall call) {
        try {
            String title = call.getString("title", "日程安排");
            Long startTime = call.getLong("startTime");
            if (startTime == null) {
                startTime = call.getLong("startDate");
                if (startTime == null) {
                    startTime = call.getLong("beginTime");
                }
            }
            if (startTime == null) {
                call.reject("Missing required startTime parameter");
                return;
            }

            Long endTime = call.getLong("endTime");
            if (endTime == null) {
                endTime = call.getLong("endDate");
            }
            boolean allDay = Boolean.TRUE.equals(call.getBoolean("allDay", false));
            if (endTime == null || endTime <= startTime) {
                endTime = startTime + (allDay ? 86400000L : 3600000L);
            }

            String location = call.getString("location");
            if (location == null || location.trim().isEmpty()) {
                location = call.getString("eventLocation");
            }
            if (location == null || location.trim().isEmpty()) {
                location = call.getString("event_location");
            }
            if (location != null) {
                location = location.trim();
            }

            String description = call.getString("description", "");
            Integer alarmMinutes = call.getInt("alarmMinutes", 15);
            String openMode = call.getString("openMode", "view"); // "view" or "edit"
            boolean skipConfirm = Boolean.TRUE.equals(call.getBoolean("skipConfirm", false));

            if (skipConfirm) {
                executeInsertAndOpen(call, title, startTime, endTime, allDay, location, description, alarmMinutes, openMode);
                return;
            }

            // Build confirmation dialog for user approval before writing to CalendarProvider
            final String finalTitle = title;
            final Long finalStartTime = startTime;
            final Long finalEndTime = endTime;
            final boolean finalAllDay = allDay;
            final String finalLocation = location;
            final String finalDescription = description;
            final Integer finalAlarmMinutes = alarmMinutes;
            final String finalOpenMode = openMode;

            getActivity().runOnUiThread(() -> {
                try {
                    AlertDialog.Builder builder = new AlertDialog.Builder(getActivity());
                    builder.setTitle("确认加入系统日历？");

                    StringBuilder msg = new StringBuilder();
                    msg.append("📌 日程：").append(finalTitle).append("\n\n");

                    SimpleDateFormat dateFormat = new SimpleDateFormat("yyyy年M月d日 HH:mm", Locale.getDefault());
                    SimpleDateFormat timeFormat = new SimpleDateFormat("HH:mm", Locale.getDefault());
                    SimpleDateFormat dayFormat = new SimpleDateFormat("yyyy年M月d日", Locale.getDefault());

                    msg.append("⏰ 时间：");
                    if (finalAllDay) {
                        msg.append(dayFormat.format(new Date(finalStartTime))).append(" (全天)");
                    } else {
                        msg.append(dateFormat.format(new Date(finalStartTime)));
                        msg.append(" - ").append(timeFormat.format(new Date(finalEndTime)));
                    }
                    msg.append("\n\n");

                    if (finalLocation != null && !finalLocation.isEmpty()) {
                        msg.append("📍 地点：").append(finalLocation).append("\n\n");
                    }

                    if (finalDescription != null && !finalDescription.isEmpty()) {
                        String cleanDesc = finalDescription;
                        if (finalLocation != null && cleanDesc.startsWith("地点：" + finalLocation)) {
                            cleanDesc = cleanDesc.substring(("地点：" + finalLocation).length()).trim();
                        }
                        if (!cleanDesc.isEmpty()) {
                            if (cleanDesc.length() > 80) {
                                cleanDesc = cleanDesc.substring(0, 77) + "...";
                            }
                            msg.append("📝 备注：").append(cleanDesc);
                        }
                    }

                    builder.setMessage(msg.toString().trim());

                    builder.setPositiveButton("确认添加", (dialog, which) -> {
                        executeInsertAndOpen(call, finalTitle, finalStartTime, finalEndTime, finalAllDay, finalLocation, finalDescription, finalAlarmMinutes, finalOpenMode);
                    });

                    builder.setNeutralButton("修改信息", (dialog, which) -> {
                        JSObject ret = new JSObject();
                        ret.put("success", false);
                        ret.put("editRequested", true);
                        call.resolve(ret);
                    });

                    builder.setNegativeButton("取消", (dialog, which) -> {
                        JSObject ret = new JSObject();
                        ret.put("success", false);
                        ret.put("cancelled", true);
                        call.resolve(ret);
                    });

                    builder.setOnCancelListener(dialog -> {
                        JSObject ret = new JSObject();
                        ret.put("success", false);
                        ret.put("cancelled", true);
                        call.resolve(ret);
                    });

                    AlertDialog dialog = builder.create();
                    dialog.setCanceledOnTouchOutside(true);
                    dialog.show();
                } catch (Exception e) {
                    Log.e(TAG, "Error showing confirmation dialog", e);
                    executeInsertAndOpen(call, finalTitle, finalStartTime, finalEndTime, finalAllDay, finalLocation, finalDescription, finalAlarmMinutes, finalOpenMode);
                }
            });

        } catch (Exception e) {
            Log.e(TAG, "Error in prepareAndConfirmEvent", e);
            call.reject("Failed to prepare event: " + e.getMessage(), e);
        }
    }

    private void executeInsertAndOpen(
        PluginCall call,
        String title,
        Long startTime,
        Long endTime,
        boolean allDay,
        String location,
        String description,
        Integer alarmMinutes,
        String openMode
    ) {
        try {
            Context context = getContext();
            long calendarId = getWritableCalendarId(context);

            ContentValues values = new ContentValues();
            values.put(CalendarContract.Events.CALENDAR_ID, calendarId);
            values.put(CalendarContract.Events.TITLE, title);
            if (location != null && !location.isEmpty()) {
                values.put(CalendarContract.Events.EVENT_LOCATION, location);
            }
            if (description != null && !description.isEmpty()) {
                values.put(CalendarContract.Events.DESCRIPTION, description);
            }
            values.put(CalendarContract.Events.DTSTART, startTime);
            values.put(CalendarContract.Events.DTEND, endTime);
            values.put(CalendarContract.Events.ALL_DAY, allDay ? 1 : 0);
            values.put(CalendarContract.Events.EVENT_TIMEZONE, TimeZone.getDefault().getID());
            values.put(CalendarContract.Events.STATUS, CalendarContract.Events.STATUS_CONFIRMED);
            values.put(CalendarContract.Events.HAS_ALARM, (alarmMinutes != null && alarmMinutes >= 0) ? 1 : 0);

            ContentResolver cr = context.getContentResolver();
            Uri eventUri = cr.insert(CalendarContract.Events.CONTENT_URI, values);
            if (eventUri == null) {
                call.reject("Failed to insert event into CalendarProvider");
                return;
            }

            long eventId = ContentUris.parseId(eventUri);
            Log.d(TAG, "Successfully inserted event directly into CalendarProvider after user confirmation. eventId: " + eventId + ", location: " + location);

            // Insert reminder alert if requested
            if (alarmMinutes != null && alarmMinutes >= 0) {
                try {
                    ContentValues reminderValues = new ContentValues();
                    reminderValues.put(CalendarContract.Reminders.EVENT_ID, eventId);
                    reminderValues.put(CalendarContract.Reminders.MINUTES, alarmMinutes);
                    reminderValues.put(CalendarContract.Reminders.METHOD, CalendarContract.Reminders.METHOD_ALERT);
                    cr.insert(CalendarContract.Reminders.CONTENT_URI, reminderValues);
                } catch (Exception remErr) {
                    Log.w(TAG, "Failed to insert reminder into CalendarProvider", remErr);
                }
            }

            // Open the freshly created event in the system calendar
            try {
                Uri viewUri = ContentUris.withAppendedId(CalendarContract.Events.CONTENT_URI, eventId);
                String action = "edit".equalsIgnoreCase(openMode) ? Intent.ACTION_EDIT : Intent.ACTION_VIEW;
                Intent intent = new Intent(action)
                    .setData(viewUri)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(intent);
            } catch (Exception openErr) {
                Log.w(TAG, "Failed to open event directly with " + openMode + ", falling back to time view", openErr);
                try {
                    Intent fallbackIntent = new Intent(Intent.ACTION_VIEW)
                        .setData(Uri.parse("content://com.android.calendar/time/" + startTime))
                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(fallbackIntent);
                } catch (Exception ignored) {}
            }

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("eventId", eventId);
            result.put("calendarId", calendarId);
            result.put("method", "native_direct");
            call.resolve(result);

        } catch (Exception e) {
            Log.e(TAG, "Error in executeInsertAndOpen", e);
            call.reject("Failed to create and open event: " + e.getMessage(), e);
        }
    }

    private long getWritableCalendarId(Context context) {
        ContentResolver cr = context.getContentResolver();
        Uri uri = CalendarContract.Calendars.CONTENT_URI;
        String[] projection = {
            CalendarContract.Calendars._ID,
            CalendarContract.Calendars.CALENDAR_DISPLAY_NAME,
            CalendarContract.Calendars.IS_PRIMARY,
            CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL,
            CalendarContract.Calendars.VISIBLE
        };

        long candidateId = -1;
        try (Cursor cursor = cr.query(uri, projection, null, null, null)) {
            if (cursor != null) {
                while (cursor.moveToNext()) {
                    long id = cursor.getLong(cursor.getColumnIndexOrThrow(CalendarContract.Calendars._ID));
                    int accessLevel = cursor.getInt(cursor.getColumnIndexOrThrow(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL));
                    int isPrimary = cursor.getInt(cursor.getColumnIndexOrThrow(CalendarContract.Calendars.IS_PRIMARY));

                    // CAL_ACCESS_CONTRIBUTOR is 500, CAL_ACCESS_OWNER is 700
                    if (accessLevel >= CalendarContract.Calendars.CAL_ACCESS_CONTRIBUTOR) {
                        if (isPrimary == 1) {
                            return id; // Best choice: primary writable calendar
                        }
                        if (candidateId == -1) {
                            candidateId = id;
                        }
                    }
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Querying system calendars failed", e);
        }

        if (candidateId != -1) {
            return candidateId;
        }

        // Fallback: If no writable calendar found, create a local one using sync adapter
        try {
            Uri calUri = CalendarContract.Calendars.CONTENT_URI.buildUpon()
                .appendQueryParameter(CalendarContract.CALLER_IS_SYNCADAPTER, "true")
                .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_NAME, "CalGen")
                .appendQueryParameter(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL)
                .build();
            ContentValues calValues = new ContentValues();
            calValues.put(CalendarContract.Calendars.ACCOUNT_NAME, "CalGen");
            calValues.put(CalendarContract.Calendars.ACCOUNT_TYPE, CalendarContract.ACCOUNT_TYPE_LOCAL);
            calValues.put(CalendarContract.Calendars.NAME, "CalGen 日程");
            calValues.put(CalendarContract.Calendars.CALENDAR_DISPLAY_NAME, "CalGen 日程");
            calValues.put(CalendarContract.Calendars.CALENDAR_COLOR, 0xFF4F46E5);
            calValues.put(CalendarContract.Calendars.CALENDAR_ACCESS_LEVEL, CalendarContract.Calendars.CAL_ACCESS_OWNER);
            calValues.put(CalendarContract.Calendars.OWNER_ACCOUNT, "CalGen");
            calValues.put(CalendarContract.Calendars.VISIBLE, 1);
            calValues.put(CalendarContract.Calendars.SYNC_EVENTS, 1);
            Uri newCalUri = cr.insert(calUri, calValues);
            if (newCalUri != null) {
                return ContentUris.parseId(newCalUri);
            }
        } catch (Exception e) {
            Log.w(TAG, "Creating local CalGen calendar failed", e);
        }

        return 1L;
    }
}
