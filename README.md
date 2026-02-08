# Remote File Manager

Удаленный файловый менеджер для Android устройств с веб-панелью управления.

## Архитектура

```
┌─────────────────┐           WebSocket           ┌─────────────────┐
│   Веб-панель    │◄─────────────────────────────►│  Python Server  │
│  (browser)      │                                │  (FastAPI)      │
└─────────────────┘                                │                 │
                                                   │  ┌───────────┐  │
┌─────────────────┐                                │  │ Device 1  │  │
│  Android APK    │◄───────────────────────────────►│  └───────────┘  │
│  (Client)       │           WebSocket             │  ┌───────────┐  │
└─────────────────┘                                │  │ Device 2  │  │
                                                   │  └───────────┘  │
                                                   │      ...        │
                                                   └─────────────────┘
```

## Возможности

- **Управление файлами**: листать, скачивать, загружать, удалять, переименовывать
- **ZIP архивация**: сжатие целых папок с чанковой передачей
- **Потоковая передача**: большие файлы передаются по чанкам (64KB)
- **Мультиустройство**: управление до 5+ устройств одновременно
- **Веб-интерфейс**: современный дизайн в стиле Windows файлового менеджера

## Требования

### Сервер
- Python 3.9+
- pip

### Android
- Android 10+ (API 29+)
- Разрешения на доступ к хранилищу

## Установка и запуск

### 1. Запуск Python сервера

```bash
cd server
pip install -r requirements.txt
python server.py
```

Сервер запустится на `http://localhost:8000`

### 2. Сборка Android APK

```bash
cd android
./gradlew assembleDebug
```

APK будет в `android/app/build/outputs/apk/debug/app-debug.apk`

### 3. Установка на устройство

```bash
adb install android/app/build/outputs/apk/debug/app-debug.apk
```

Или скопируйте APK файл на устройство и установите.

### 4. Подключение

1. Запустите приложение на Android устройстве
2. Введите адрес сервера: `ws://ВАШ_IP:8000/ws/device`
3. Нажмите "Connect"
4. Откройте в браузере: `http://ВАШ_IP:8000`
5. Вы увидите ваше устройство в списке
6. Нажмите "Open" для открытия файлового менеджера

## Структура проекта

```
APK/
├── server/                 # Python сервер
│   ├── server.py          # FastAPI + WebSocket сервер
│   ├── requirements.txt   # Python зависимости
│   └── web/               # Веб-панель
│       ├── index.html     # Главная страница
│       ├── styles.css     # Стили
│       └── app.js         # JavaScript логика
│
└── android/               # Android приложение
    └── app/
        ├── build.gradle   # Gradle конфигурация
        └── src/main/
            ├── AndroidManifest.xml
            └── java/com/remotefm/client/
                ├── MainActivity.kt      # Главный экран
                └── ForegroundService.kt # WebSocket сервис
```

## Протокол коммуникации

### Регистрация устройства

```json
{
  "type": "device_register",
  "device_id": "unique-device-id",
  "device_name": "Samsung Galaxy S21",
  "android_version": "13",
  "sdk_version": "33",
  "api_key": "default_key"
}
```

### Запрос списка файлов

```json
{
  "type": "list_files",
  "device_id": "device-id",
  "path": "/sdcard"
}
```

### Ответ со списком файлов

```json
{
  "type": "files_list",
  "files": [
    {
      "name": "Documents",
      "path": "/sdcard/Documents",
      "is_directory": true,
      "size": 0,
      "modified_time": 1234567890000
    }
  ]
}
```

### Скачивание файла (передача чанками)

```json
{
  "type": "file_chunk",
  "file_name": "/sdcard/photo.jpg",
  "offset": 0,
  "data": "base64_encoded_chunk",
  "is_last": false,
  "total_size": 1048576
}
```

## Безопасность

Для продакшена рекомендуется:

1. Использовать WSS (WebSocket Secure) вместо WS
2. Сгенерировать уникальный API ключ для каждого устройства
3. Добавить аутентификацию на веб-панель
4. Использовать VPN или частную сеть

## Troubleshooting

### Устройство не подключается

- Проверьте, что сервер запущен
- Проверьте IP адрес в настройках приложения
- Убедитесь, что файрволл не блокирует порт 8000
- Используйте `adb logcat` для просмотра логов приложения

### Не работают операции с файлами

- Проверьте разрешения приложения (Settings → Apps → RemoteFM → Permissions)
- Для Android 11+ требуется разрешение "Manage all files"
- Для SD карты может потребоваться специальный доступ

## Лицензия

MIT License
