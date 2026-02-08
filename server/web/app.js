// Remote File Manager - Web Panel
// WebSocket connection to Python server

let ws;
let currentDeviceId = null;
let currentPath = '/';
let files = [];
let selectedFiles = new Set();
let deviceTags = {};

// DOM Elements
const deviceListView = document.getElementById('deviceListView');
const fileManagerView = document.getElementById('fileManagerView');
const deviceRows = document.getElementById('deviceRows');
const connectionStatus = document.getElementById('connectionStatus');
const fileList = document.getElementById('fileList');
const pathInput = document.getElementById('pathInput');
const selectedCount = document.getElementById('selectedCount');
const selectedSize = document.getElementById('selectedSize');
const fileCount = document.getElementById('fileCount');

// Connect to WebSocket server
function connect() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}/ws/admin`;

  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('Connected to server');
    updateConnectionStatus(true);
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleMessage(data);
  };

  ws.onclose = () => {
    console.log('Disconnected from server, reconnecting...');
    updateConnectionStatus(false);
    setTimeout(connect, 2000);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };
}

function updateConnectionStatus(connected) {
  const dot = connectionStatus.querySelector('.status-dot');
  const text = connectionStatus.querySelector('.status-text');

  if (connected) {
    dot.className = 'status-dot online';
    text.textContent = 'Connected';
  } else {
    dot.className = 'status-dot offline';
    text.textContent = 'Connecting...';
  }
}

function handleMessage(data) {
  switch (data.type) {
    case 'connections_update':
      updateDeviceList(data.connections);
      break;
    case 'files_list':
      files = data.files || [];
      renderFileList();
      break;
    case 'file_chunk':
      handleFileChunk(data);
      break;
    case 'delete_response':
    case 'create_dir_response':
    case 'move_response':
      showNotification(data.message || 'Operation completed', data.success ? 'success' : 'error');
      if (data.success) {
        loadFiles(currentPath);
      }
      break;
    case 'error':
      showNotification(data.message, 'error');
      break;
  }
}

// Device List
function updateDeviceList(devices) {
  deviceRows.innerHTML = '';

  for (const device of devices) {
    const tr = document.createElement('tr');

    const deviceTag = deviceTags[device.id] || { name: device.device_name || device.id.slice(0, 8), color: '#6366f1' };

    tr.innerHTML = `
      <td class="cell-id">
        <div class="device-badge" style="background: ${deviceTag.color}">${deviceTag.name}</div>
      </td>
      <td class="cell-name">${device.device_name || 'Unknown'}</td>
      <td class="cell-ip">${device.ip}</td>
      <td class="cell-version">${device.android_version || '-'}</td>
      <td class="cell-date">${device.connected_at}</td>
      <td class="cell-status"><span class="badge ${device.status}">${device.status}</span></td>
      <td class="cell-actions">
        <button class="btn btn-primary btn-sm" onclick="openFileManager('${device.id}')" ${device.status !== 'online' ? 'disabled' : ''}>
          <i class="fas fa-folder-open"></i> Open
        </button>
      </td>
    `;

    deviceRows.appendChild(tr);
  }
}

// File Manager
function openFileManager(deviceId) {
  currentDeviceId = deviceId;
  currentPath = '/';
  selectedFiles.clear();

  deviceListView.style.display = 'none';
  fileManagerView.style.display = 'block';

  const device = Object.values(manager?.device_info || {}).find(d => d.device_id === deviceId) || {};
  document.getElementById('fmDeviceName').textContent = device.device_name || 'Device';

  loadFiles('/');
}

function closeFileManager() {
  currentDeviceId = null;
  fileManagerView.style.display = 'none';
  deviceListView.style.display = 'block';
}

function loadFiles(path) {
  currentPath = path;
  pathInput.value = path;

  ws.send(JSON.stringify({
    type: 'list_files',
    device_id: currentDeviceId,
    path: path
  }));
}

function renderFileList() {
  fileList.innerHTML = '';

  if (files.length === 0) {
    fileList.innerHTML = `
      <div class="fm-empty">
        <i class="fas fa-folder-open"></i>
        <p>Empty folder</p>
      </div>
    `;
    fileCount.textContent = '0 items';
    return;
  }

  // Sort: folders first, then files
  const sorted = [...files].sort((a, b) => {
    if (a.is_directory && !b.is_directory) return -1;
    if (!a.is_directory && b.is_directory) return 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true });
  });

  for (const file of sorted) {
    const div = document.createElement('div');
    div.className = 'fm-file-item';
    div.dataset.path = file.path;
    div.dataset.name = file.name;
    div.dataset.type = file.is_directory ? 'dir' : 'file';

    const iconClass = getFileIconClass(file);
    const sizeStr = file.is_directory ? '' : formatSize(file.size);
    const dateStr = formatDate(file.modified_time);

    div.innerHTML = `
      <input type="checkbox" class="fm-file-checkbox" ${selectedFiles.has(file.path) ? 'checked' : ''}>
      <div class="fm-file-icon ${file.is_directory ? 'folder' : iconClass}">
        <i class="fas ${file.is_directory ? 'fa-folder' : getFontAwesomeIcon(file)}"></i>
      </div>
      <div class="fm-file-info">
        <div class="fm-file-name">${file.name}</div>
        <div class="fm-file-meta">
          <span class="fm-file-size">${sizeStr}</span>
          ${dateStr ? `<span class="fm-file-date">${dateStr}</span>` : ''}
        </div>
      </div>
      <div class="fm-file-actions">
        <button class="btn-icon" onclick="downloadSingleFile('${file.path}')" title="Download">
          <i class="fas fa-download"></i>
        </button>
        <button class="btn-icon" onclick="deleteSingleFile('${file.path}')" title="Delete">
          <i class="fas fa-trash"></i>
        </button>
      </div>
    `;

    // Events
    div.addEventListener('click', (e) => {
      if (e.target.type !== 'checkbox' && !e.target.closest('.btn-icon')) {
        if (file.is_directory) {
          loadFiles(file.path);
        } else {
          toggleSelection(file.path, div);
        }
      }
    });

    div.addEventListener('dblclick', () => {
      if (file.is_directory) {
        loadFiles(file.path);
      } else {
        downloadSingleFile(file.path);
      }
    });

    div.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showContextMenu(e, file);
    });

    const checkbox = div.querySelector('.fm-file-checkbox');
    checkbox.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSelection(file.path, div);
    });

    fileList.appendChild(div);
  }

  fileCount.textContent = `${files.length} items`;
  updateSelectionUI();
}

function getFileIconClass(file) {
  if (file.is_directory) return 'folder';

  const ext = file.name.split('.').pop().toLowerCase();
  const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'];
  const archiveExts = ['zip', 'rar', '7z', 'tar', 'gz'];
  const audioExts = ['mp3', 'wav', 'ogg', 'flac', 'aac', 'm4a'];
  const videoExts = ['mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm'];

  if (imageExts.includes(ext)) return 'image';
  if (archiveExts.includes(ext)) return 'archive';
  if (audioExts.includes(ext)) return 'audio';
  if (videoExts.includes(ext)) return 'video';
  return 'file';
}

function getFontAwesomeIcon(file) {
  if (file.is_directory) return 'fa-folder';

  const ext = file.name.split('.').pop().toLowerCase();
  const icons = {
    // Images
    'jpg': 'fa-file-image', 'jpeg': 'fa-file-image', 'png': 'fa-file-image',
    'gif': 'fa-file-image', 'webp': 'fa-file-image', 'svg': 'fa-file-image',
    // Archives
    'zip': 'fa-file-archive', 'rar': 'fa-file-archive', '7z': 'fa-file-archive',
    'tar': 'fa-file-archive', 'gz': 'fa-file-archive',
    // Audio
    'mp3': 'fa-file-audio', 'wav': 'fa-file-audio', 'ogg': 'fa-file-audio',
    'flac': 'fa-file-audio', 'aac': 'fa-file-audio', 'm4a': 'fa-file-audio',
    // Video
    'mp4': 'fa-file-video', 'avi': 'fa-file-video', 'mkv': 'fa-file-video',
    'mov': 'fa-file-video', 'wmv': 'fa-file-video',
    // Documents
    'pdf': 'fa-file-pdf', 'doc': 'fa-file-word', 'docx': 'fa-file-word',
    'xls': 'fa-file-excel', 'xlsx': 'fa-file-excel', 'ppt': 'fa-file-powerpoint',
    'txt': 'fa-file-alt', 'json': 'fa-file-code', 'xml': 'fa-file-code',
    'html': 'fa-file-code', 'css': 'fa-file-code', 'js': 'fa-file-code',
    'py': 'fa-file-code', 'java': 'fa-file-code', 'cpp': 'fa-file-code',
    // APK
    'apk': 'fa-android'
  };
  return icons[ext] || 'fa-file';
}

function toggleSelection(path, element) {
  if (selectedFiles.has(path)) {
    selectedFiles.delete(path);
    element.classList.remove('selected');
    element.querySelector('.fm-file-checkbox').checked = false;
  } else {
    selectedFiles.add(path);
    element.classList.add('selected');
    element.querySelector('.fm-file-checkbox').checked = true;
  }
  updateSelectionUI();
}

function updateSelectionUI() {
  selectedCount.textContent = `${selectedFiles.size} selected`;

  // Calculate total size
  let totalSize = 0;
  for (const path of selectedFiles) {
    const file = files.find(f => f.path === path);
    if (file && !file.is_directory) {
      totalSize += file.size || 0;
    }
  }
  selectedSize.textContent = totalSize > 0 ? formatSize(totalSize) : '';

  // Enable/disable buttons
  const hasSelection = selectedFiles.size > 0;
  document.getElementById('btnDownload').disabled = !hasSelection;
  document.getElementById('btnDelete').disabled = !hasSelection;
  document.getElementById('btnRename').disabled = selectedFiles.size !== 1;
  document.getElementById('btnZip').disabled = selectedFiles.size === 0;
}

// File Operations
function downloadSingleFile(path) {
  ws.send(JSON.stringify({
    type: 'download_file',
    device_id: currentDeviceId,
    path: path
  }));
}

function deleteSingleFile(path) {
  showConfirmModal('Delete', `Are you sure you want to delete "${path.split('/').pop()}"?`, () => {
    ws.send(JSON.stringify({
      type: 'delete',
      device_id: currentDeviceId,
      path: path,
      recursive: false
    }));
  });
}

function createNewFolder() {
  const name = document.getElementById('newFolderName').value.trim();
  if (!name) return;

  const newPath = currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;

  ws.send(JSON.stringify({
    type: 'create_dir',
    device_id: currentDeviceId,
    path: newPath
  }));

  closeModal('newFolderModal');
  document.getElementById('newFolderName').value = '';
}

function deleteSelected() {
  const paths = Array.from(selectedFiles);
  showConfirmModal('Delete', `Delete ${paths.length} item(s)?`, () => {
    for (const path of paths) {
      ws.send(JSON.stringify({
        type: 'delete',
        device_id: currentDeviceId,
        path: path,
        recursive: true
      }));
    }
    selectedFiles.clear();
  });
}

// Chunked file download
let activeDownloads = {};

function handleFileChunk(data) {
  const { file_name, offset, data: chunkData, is_last, total_size } = data;

  if (!activeDownloads[file_name]) {
    activeDownloads[file_name] = {
      chunks: [],
      received: 0,
      total: total_size,
      fileName: file_name.split('/').pop()
    };
    showDownloadModal();
  }

  const download = activeDownloads[file_name];

  if (chunkData) {
    const binaryString = atob(chunkData);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    download.chunks.push({ offset, bytes });
    download.received += bytes.length;
  }

  updateDownloadProgress();

  if (is_last) {
    // Combine chunks and save
    const totalLength = download.chunks.reduce((sum, chunk) => sum + chunk.bytes.length, 0);
    const combined = new Uint8Array(totalLength);
    let position = 0;

    for (const chunk of download.chunks) {
      combined.set(chunk.bytes, position);
      position += chunk.bytes.length;
    }

    const blob = new Blob([combined], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = download.fileName;
    a.click();
    URL.revokeObjectURL(url);

    delete activeDownloads[file_name];
    updateDownloadProgress();
  }
}

function showDownloadModal() {
  const modal = document.getElementById('downloadModal');
  modal.classList.add('show');
}

function updateDownloadProgress() {
  const list = document.getElementById('downloadList');
  list.innerHTML = '';

  for (const [path, download] of Object.entries(activeDownloads)) {
    const progress = download.total > 0 ? (download.received / download.total * 100) : 0;

    list.innerHTML += `
      <div class="progress-item">
        <div class="progress-item-icon">
          <i class="fas fa-download"></i>
        </div>
        <div class="progress-item-info">
          <div class="progress-item-name">${download.fileName}</div>
          <div class="progress-item-status">${formatSize(download.received)} / ${formatSize(download.total)}</div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${progress}%"></div>
          </div>
        </div>
      </div>
    `;
  }

  if (Object.keys(activeDownloads).length === 0) {
    closeModal('downloadModal');
  }
}

// Upload (simplified - for demo)
function uploadFiles() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.onchange = (e) => {
    const files = e.target.files;
    for (const file of files) {
      uploadFile(file);
    }
  };
  input.click();
}

async function uploadFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    const data = e.target.result;
    const chunkSize = 64 * 1024; // 64KB chunks
    const totalChunks = Math.ceil(data.length / chunkSize);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, data.length);
      const chunk = data.slice(start, end);
      const base64 = btoa(String.fromCharCode.apply(null, new Uint8Array(chunk)));

      ws.send(JSON.stringify({
        type: 'upload_file',
        device_id: currentDeviceId,
        path: currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`,
        data: base64,
        offset: start,
        is_last: i === totalChunks - 1
      }));
    }
  };
  reader.readAsArrayBuffer(file);
}

// Context Menu
let contextMenuFile = null;
const contextMenu = document.getElementById('contextMenu');

function showContextMenu(e, file) {
  contextMenuFile = file;
  contextMenu.style.display = 'block';
  contextMenu.style.left = e.pageX + 'px';
  contextMenu.style.top = e.pageY + 'px';
}

document.addEventListener('click', (e) => {
  if (!e.target.closest('#contextMenu')) {
    contextMenu.style.display = 'none';
  }
});

contextMenu.addEventListener('click', (e) => {
  const action = e.target.closest('.context-menu-item')?.dataset.action;
  if (!action || !contextMenuFile) return;

  contextMenu.style.display = 'none';

  switch (action) {
    case 'open':
      if (contextMenuFile.is_directory) {
        loadFiles(contextMenuFile.path);
      }
      break;
    case 'download':
      downloadSingleFile(contextMenuFile.path);
      break;
    case 'rename':
      showRenameModal(contextMenuFile);
      break;
    case 'delete':
      deleteSingleFile(contextMenuFile.path);
      break;
    case 'zip':
      // TODO: Implement zip
      showNotification('Zip compression coming soon', 'info');
      break;
    case 'info':
      showFileInfo(contextMenuFile);
      break;
  }
});

// Modals
function showRenameModal(file) {
  const modal = document.getElementById('renameModal');
  const input = document.getElementById('renameInput');
  input.value = file.name;
  modal.classList.add('show');
  input.focus();
  input.select();
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('show');
}

function showConfirmModal(title, message, onConfirm) {
  const modal = document.getElementById('confirmModal');
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmMessage').textContent = message;

  const confirmBtn = document.getElementById('confirmAction');
  confirmBtn.onclick = () => {
    onConfirm();
    closeModal('confirmModal');
  };

  modal.classList.add('show');
}

function showFileInfo(file) {
  const info = `
Name: ${file.name}
Type: ${file.is_directory ? 'Folder' : 'File'}
Size: ${file.is_directory ? '-' : formatSize(file.size)}
Path: ${file.path}
Modified: ${formatDate(file.modified_time) || '-'}
  `;
  alert(info);
}

function showNotification(message, type = 'info') {
  // Simple notification - could be enhanced
  console.log(`[${type}] ${message}`);
}

// Utility functions
function formatSize(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function getParentPath(path) {
  if (path === '/' || !path) return '/';
  const parts = path.split('/').filter(p => p);
  parts.pop();
  return '/' + parts.join('/');
}

// Event Listeners
document.getElementById('btnBack').addEventListener('click', closeFileManager);

document.getElementById('btnHome').addEventListener('click', () => loadFiles('/'));

document.getElementById('btnUp').addEventListener('click', () => {
  loadFiles(getParentPath(currentPath));
});

document.getElementById('btnRefresh').addEventListener('click', () => loadFiles(currentPath));

document.getElementById('btnNewFolder').addEventListener('click', () => {
  document.getElementById('newFolderModal').classList.add('show');
  document.getElementById('newFolderName').focus();
});

document.getElementById('btnUpload').addEventListener('click', uploadFiles);

document.getElementById('btnDownload').addEventListener('click', () => {
  for (const path of selectedFiles) {
    downloadSingleFile(path);
  }
});

document.getElementById('btnDelete').addEventListener('click', deleteSelected);

document.getElementById('btnZip').addEventListener('click', () => {
  showNotification('Zip compression coming soon', 'info');
});

pathInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    loadFiles(pathInput.value);
  }
});

// Modal close buttons
document.getElementById('closeDownloadModal').addEventListener('click', () => closeModal('downloadModal'));
document.getElementById('closeNewFolderModal').addEventListener('click', () => closeModal('newFolderModal'));
document.getElementById('closeRenameModal').addEventListener('click', () => closeModal('renameModal'));
document.getElementById('closeConfirmModal').addEventListener('click', () => closeModal('confirmModal'));

document.getElementById('cancelNewFolder').addEventListener('click', () => closeModal('newFolderModal'));
document.getElementById('confirmNewFolder').addEventListener('click', createNewFolder);

document.getElementById('cancelRename').addEventListener('click', () => closeModal('renameModal'));
document.getElementById('confirmRename').addEventListener('click', () => {
  const oldPath = contextMenuFile.path;
  const newName = document.getElementById('renameInput').value.trim();
  if (!newName) return;

  const parentPath = getParentPath(oldPath);
  const newPath = parentPath === '/' ? `/${newName}` : `${parentPath}/${newName}`;

  ws.send(JSON.stringify({
    type: 'move',
    device_id: currentDeviceId,
    old_path: oldPath,
    new_path: newPath
  }));

  closeModal('renameModal');
});

document.getElementById('cancelConfirm').addEventListener('click', () => closeModal('confirmModal'));

// Close modals on backdrop click
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('show');
    }
  });
});

// Enter key in new folder modal
document.getElementById('newFolderName').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    createNewFolder();
  }
});

// Enter key in rename modal
document.getElementById('renameInput').addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    document.getElementById('confirmRename').click();
  }
});

// Initialize
connect();
