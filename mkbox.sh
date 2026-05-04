#!/bin/bash

# Настройки
APP_NAME=$1
TARGET_DIR="./data/container-$APP_NAME"

# 1. Проверка аргументов
if [ -z "$APP_NAME" ]; then
    echo "Usage: $0 <app_name>"
    exit 1
fi

# 2. Проверка необходимых утилит на хосте
deps=(bwrap pacstrap)
for dep in "${deps[@]}"; do
    if ! command -v "$dep" &> /dev/null; then
        echo "Error: '$dep' is not installed on your host. Run: sudo pacman -S arch-install-scripts bubblewrap"
        exit 1
    fi
done

# 3. Создание структуры
if [ -d "$TARGET_DIR" ]; then
    echo "Container '$TARGET_DIR' already exists. Skip creation."
else
    echo "--- Building container in $TARGET_DIR ---"
    mkdir -p "$TARGET_DIR"
    
    # Установка базы (bash + coreutils + pacman для управления внутри)
    # Используем -c для использования кэша хоста (экономим трафик и место)
    # Используем -K для сохранения ключей
    sudo pacstrap -K -c "$TARGET_DIR" base bash coreutils pacman --nodeps
    
    # Отключаем CheckSpace внутри контейнера, чтобы избежать ошибок с mount point
    sudo sed -i 's/^CheckSpace/#CheckSpace/' "$TARGET_DIR/etc/pacman.conf"
    
    echo "--- Build complete! ---"
fi

# 4. Генератор лаунчера
cat <<EOF > "run-$APP_NAME.sh"
#!/bin/bash
mkdir -p "$TARGET_DIR/home"
exec bwrap \\
  --ro-bind "$TARGET_DIR" / \\
  --dev /dev \\
  --proc /proc \\
  --tmpfs /tmp \\
  --bind "$TARGET_DIR/home" /root \\
  --ro-bind /etc/resolv.conf /etc/resolv.conf \\
  --unshare-all \\
  --share-net \\
  --hostname "$APP_NAME-box" \\
  /bin/bash
EOF

chmod +x "run-$APP_NAME.sh"
echo "--- Launcher created: ./run-$APP_NAME.sh ---"