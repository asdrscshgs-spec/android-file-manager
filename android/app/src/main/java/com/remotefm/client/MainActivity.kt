package com.remotefm.client

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import java.util.UUID

class MainActivity : AppCompatActivity() {

    private lateinit var etServerUrl: EditText
    private lateinit var btnConnect: Button
    private lateinit var tvStatus: TextView
    private lateinit var tvDeviceInfo: TextView

    private val SERVER_URL_PREF = "server_url"
    private val DEVICE_ID_PREF = "device_id"

    private var deviceId: String? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        initViews()
        loadSettings()
        checkPermissions()

        btnConnect.setOnClickListener {
            toggleConnection()
        }
    }

    private fun initViews() {
        etServerUrl = findViewById(R.id.etServerUrl)
        btnConnect = findViewById(R.id.btnConnect)
        tvStatus = findViewById(R.id.tvStatus)
        tvDeviceInfo = findViewById(R.id.tvDeviceInfo)

        // Display device info
        tvDeviceInfo.text = """
            Device: ${android.os.Build.MODEL}
            Android: ${android.os.Build.VERSION.RELEASE}
            SDK: ${android.os.Build.VERSION.SDK_INT}
        """.trimIndent()
    }

    private fun loadSettings() {
        val prefs = getSharedPreferences("RemoteFMPrefs", MODE_PRIVATE)
        val serverUrl = prefs.getString(SERVER_URL_PREF, "ws://YOUR_SERVER_IP:8000/ws/device")
        etServerUrl.setText(serverUrl)

        deviceId = prefs.getString(DEVICE_ID_PREF, null)
        if (deviceId == null) {
            deviceId = UUID.randomUUID().toString()
            prefs.edit().putString(DEVICE_ID_PREF, deviceId).apply()
        }
    }

    private fun saveSettings() {
        val prefs = getSharedPreferences("RemoteFMPrefs", MODE_PRIVATE)
        prefs.edit()
            .putString(SERVER_URL_PREF, etServerUrl.text.toString())
            .apply()
    }

    private fun toggleConnection() {
        if (ForegroundService.isRunning) {
            // Disconnect
            stopService(Intent(this, ForegroundService::class.java))
            updateConnectionStatus(false)
        } else {
            // Connect
            val serverUrl = etServerUrl.text.toString()
            if (serverUrl.isBlank()) {
                Toast.makeText(this, "Please enter server URL", Toast.LENGTH_SHORT).show()
                return
            }

            saveSettings()

            val intent = Intent(this, ForegroundService::class.java).apply {
                putExtra("server_url", serverUrl)
                putExtra("device_id", deviceId)
            }
            startForegroundService(intent)

            // Check if service started successfully
            CoroutineScope(Dispatchers.Main).launch {
                kotlinx.coroutines.delay(500)
                updateConnectionStatus(ForegroundService.isRunning)
            }
        }
    }

    private fun updateConnectionStatus(connected: Boolean) {
        if (connected) {
            btnConnect.text = "Disconnect"
            tvStatus.text = "Status: Connected"
            tvStatus.setTextColor(getColor(android.R.color.holo_green_dark))
        } else {
            btnConnect.text = "Connect"
            tvStatus.text = "Status: Disconnected"
            tvStatus.setTextColor(getColor(android.R.color.holo_red_dark))
        }
    }

    private fun checkPermissions() {
        val permissions = mutableListOf<String>()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            permissions.add(Manifest.permission.POST_NOTIFICATIONS)
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            permissions.add(Manifest.permission.MANAGE_EXTERNAL_STORAGE)
        } else {
            permissions.add(Manifest.permission.WRITE_EXTERNAL_STORAGE)
            permissions.add(Manifest.permission.READ_EXTERNAL_STORAGE)
        }

        val needed = permissions.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }

        if (needed.isNotEmpty()) {
            ActivityCompat.requestPermissions(this, needed.toTypedArray(), 100)
        }
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == 100) {
            val allGranted = grantResults.all { it == PackageManager.PERMISSION_GRANTED }
            if (!allGranted) {
                Toast.makeText(this, "Permissions are required for file access", Toast.LENGTH_LONG).show()
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        // Keep service running when activity is destroyed
    }
}
