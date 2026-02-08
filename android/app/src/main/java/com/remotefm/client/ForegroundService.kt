package com.remotefm.client

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.TimeUnit

class ForegroundService : Service() {

    private var serviceJob: Job? = null
    private var webSocket: WebSocket? = null
    private val client = OkHttpClient.Builder()
        .pingInterval(30, TimeUnit.SECONDS)
        .build()

    private var currentDeviceId: String? = null
    private var currentServerUrl: String? = null

    companion object {
        var isRunning = false
        private const val CHANNEL_ID = "RemoteFMService"
        private const val NOTIFICATION_ID = 1001
        private const val TAG = "ForegroundService"

        // File operation constants
        private const val CHUNK_SIZE = 64 * 1024 // 64KB chunks
    }

    override fun onCreate() {
        super.onCreate()
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val serverUrl = intent?.getStringExtra("server_url")
        val deviceId = intent?.getStringExtra("device_id")

        if (serverUrl.isNullOrBlank() || deviceId.isNullOrBlank()) {
            stopSelf()
            return START_NOT_STICKY
        }

        currentServerUrl = serverUrl
        currentDeviceId = deviceId

        // Start foreground service
        val notification = createNotification("Connecting...")
        startForeground(NOTIFICATION_ID, notification)

        isRunning = true

        // Start WebSocket connection
        connectWebSocket()

        return START_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        isRunning = false
        webSocket?.close(1000, "Service stopped")
        serviceJob?.cancel()
        super.onDestroy()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Remote File Manager Service",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Keeps the connection to the server alive"
            }

            val manager = getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(channel)
        }
    }

    private fun createNotification(statusText: String): Notification {
        val intent = Intent(this, MainActivity::class.java)
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle("Remote File Manager")
            .setContentText(statusText)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .build()
    }

    private fun updateNotification(statusText: String) {
        val notification = createNotification(statusText)
        val manager = getSystemService(NotificationManager::class.java)
        manager.notify(NOTIFICATION_ID, notification)
    }

    private fun connectWebSocket() {
        val request = Request.Builder()
            .url(currentServerUrl ?: return)
            .build()

        webSocket = client.newWebSocket(request, RemoteWebSocketListener())
    }

    inner class RemoteWebSocketListener : WebSocketListener() {

        override fun onOpen(ws: WebSocket, response: Response) {
            Log.d(TAG, "WebSocket connected")
            updateNotification("Connected to server")

            // Register device
            val registerMsg = JSONObject().apply {
                put("type", "device_register")
                put("device_id", currentDeviceId)
                put("device_name", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL}")
                put("android_version", android.os.Build.VERSION.RELEASE)
                put("sdk_version", android.os.Build.VERSION.SDK_INT)
                put("api_key", "default_key") // In production, use unique key per build
            }
            ws.send(registerMsg.toString())
        }

        override fun onMessage(ws: WebSocket, text: String) {
            Log.d(TAG, "Received: $text")
            handleMessage(text)
        }

        override fun onClosing(ws: WebSocket, code: Int, reason: String) {
            Log.d(TAG, "Closing: $code $reason")
        }

        override fun onClosed(ws: WebSocket, code: Int, reason: String) {
            Log.d(TAG, "Closed: $code $reason")
            reconnect()
        }

        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
            Log.e(TAG, "Error: ${t.message}", t)
            updateNotification("Connection error")
            reconnect()
        }
    }

    private fun handleMessage(message: String) {
        try {
            val json = JSONObject(message)
            val type = json.optString("type")

            when (type) {
                "registered" -> {
                    Log.d(TAG, "Device registered: ${json.optString("device_id")}")
                    updateNotification("Connected and registered")
                }

                "list_files" -> {
                    val path = json.optString("path", "/")
                    CoroutineScope(Dispatchers.IO).launch {
                        val files = listFiles(path)
                        val response = JSONObject().apply {
                            put("type", "files_list")
                            put("path", path)
                            put("files", files)
                        }
                        webSocket?.send(response.toString())
                    }
                }

                "download_file" -> {
                    val path = json.optString("path")
                    CoroutineScope(Dispatchers.IO).launch {
                        sendFile(path)
                    }
                }

                "upload_file" -> {
                    val path = json.optString("path")
                    val data = json.optString("data")
                    val offset = json.optLong("offset", 0)
                    val isLast = json.optBoolean("is_last", false)

                    CoroutineScope(Dispatchers.IO).launch {
                        receiveFileChunk(path, data, offset, isLast)
                    }
                }

                "delete" -> {
                    val path = json.optString("path")
                    val recursive = json.optBoolean("recursive", false)

                    CoroutineScope(Dispatchers.IO).launch {
                        val success = deleteFile(path, recursive)
                        val response = JSONObject().apply {
                            put("type", "delete_response")
                            put("success", success)
                            put("message", if (success) "Deleted successfully" else "Failed to delete")
                        }
                        webSocket?.send(response.toString())
                    }
                }

                "create_dir" -> {
                    val path = json.optString("path")

                    CoroutineScope(Dispatchers.IO).launch {
                        val success = createDirectory(path)
                        val response = JSONObject().apply {
                            put("type", "create_dir_response")
                            put("success", success)
                            put("message", if (success) "Directory created" else "Failed to create directory")
                        }
                        webSocket?.send(response.toString())
                    }
                }

                "move" -> {
                    val oldPath = json.optString("old_path")
                    val newPath = json.optString("new_path")

                    CoroutineScope(Dispatchers.IO).launch {
                        val success = moveFile(oldPath, newPath)
                        val response = JSONObject().apply {
                            put("type", "move_response")
                            put("success", success)
                            put("message", if (success) "Moved successfully" else "Failed to move")
                        }
                        webSocket?.send(response.toString())
                    }
                }

                "compress" -> {
                    val path = json.optString("path")
                    CoroutineScope(Dispatchers.IO).launch {
                        zipFolder(path)
                    }
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error handling message: ${e.message}", e)
        }
    }

    // File operations

    private fun listFiles(path: String): JSONArray {
        val result = JSONArray()
        try {
            val file = File(path)
            if (file.exists() && file.isDirectory) {
                val files = file.listFiles()
                files?.forEach { f ->
                    result.put(JSONObject().apply {
                        put("name", f.name)
                        put("path", f.absolutePath)
                        put("is_directory", f.isDirectory)
                        put("size", if (f.isFile) f.length() else 0)
                        put("modified_time", f.lastModified())
                    })
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error listing files: ${e.message}", e)
        }
        return result
    }

    private fun sendFile(path: String) {
        try {
            val file = File(path)
            if (!file.exists()) {
                sendError("File not found: $path")
                return
            }

            val totalSize = file.length()
            var offset = 0L
            val buffer = ByteArray(CHUNK_SIZE)

            file.inputStream().use { input ->
                var read: Int
                while (input.read(buffer).also { read = it } != -1) {
                    val chunkData = if (read < buffer.size) {
                        buffer.copyOf(read)
                    } else {
                        buffer
                    }

                    val base64 = android.util.Base64.encodeToString(
                        chunkData,
                        android.util.Base64.NO_WRAP
                    )

                    val isLast = (offset + read >= totalSize)

                    val response = JSONObject().apply {
                        put("type", "file_chunk")
                        put("file_name", path)
                        put("offset", offset)
                        put("data", base64)
                        put("is_last", isLast)
                        put("total_size", totalSize)
                    }

                    webSocket?.send(response.toString())
                    offset += read

                    // Small delay to avoid overwhelming the connection
                    delay(10)
                }
            }

            Log.d(TAG, "File sent: $path")
        } catch (e: Exception) {
            Log.e(TAG, "Error sending file: ${e.message}", e)
            sendError("Failed to send file: ${e.message}")
        }
    }

    private fun receiveFileChunk(path: String, data: String, offset: Long, isLast: Boolean) {
        try {
            val file = File(path)
            file.parentFile?.mkdirs()

            val bytes = android.util.Base64.decode(data, android.util.Base64.NO_WRAP)

            if (offset == 0L && file.exists()) {
                file.delete()
            }

            file.outputStream().use { output ->
                if (offset > 0) {
                    output.channel.position(offset)
                }
                output.write(bytes)
            }

            if (isLast) {
                Log.d(TAG, "File received: $path")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error receiving file chunk: ${e.message}", e)
        }
    }

    private fun deleteFile(path: String, recursive: Boolean): Boolean {
        return try {
            val file = File(path)
            if (recursive && file.isDirectory) {
                file.deleteRecursively()
            } else {
                file.delete()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error deleting file: ${e.message}", e)
            false
        }
    }

    private fun createDirectory(path: String): Boolean {
        return try {
            val file = File(path)
            file.mkdirs()
        } catch (e: Exception) {
            Log.e(TAG, "Error creating directory: ${e.message}", e)
            false
        }
    }

    private fun moveFile(oldPath: String, newPath: String): Boolean {
        return try {
            val oldFile = File(oldPath)
            val newFile = File(newPath)
            newFile.parentFile?.mkdirs()
            oldFile.renameTo(newFile)
        } catch (e: Exception) {
            Log.e(TAG, "Error moving file: ${e.message}", e)
            false
        }
    }

    private fun zipFolder(path: String) {
        try {
            val folder = File(path)
            if (!folder.exists() || !folder.isDirectory) {
                sendError("Not a directory: $path")
                return
            }

            val zipPath = "$path.zip"
            val zipFile = File(zipPath)

            // Create zip file
            android.util.ZipFile(zipFile).use { zip ->
                folder.walkTopDown().forEach { file ->
                    if (file.isFile) {
                        val entryPath = file.relativeTo(folder).path
                        val entry = android.util.ZipEntry(entryPath)
                        zip.addEntry(entry)

                        file.inputStream().use { input ->
                            zip.addEntry(entry, input)
                        }
                    }
                }
            }

            // Send the zip file
            sendFile(zipPath)

            // Clean up
            zipFile.delete()
        } catch (e: Exception) {
            Log.e(TAG, "Error zipping folder: ${e.message}", e)
            sendError("Failed to zip folder: ${e.message}")
        }
    }

    private fun sendError(message: String) {
        try {
            val response = JSONObject().apply {
                put("type", "error")
                put("message", message)
            }
            webSocket?.send(response.toString())
        } catch (e: Exception) {
            Log.e(TAG, "Error sending error message: ${e.message}", e)
        }
    }

    private fun reconnect() {
        serviceJob?.cancel()
        serviceJob = CoroutineScope(Dispatchers.IO).launch {
            delay(5000) // Wait 5 seconds before reconnecting
            if (isRunning) {
                connectWebSocket()
            }
        }
    }
}
