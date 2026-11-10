#!/usr/bin/env bash
# Сборка APK без Gradle: только build-tools и android.jar из Android SDK.
#   BUILD_TOOLS=/путь/к/build-tools/34.0.0 ANDROID_JAR=/путь/к/platforms/android-34/android.jar tools/build-apk.sh
# Подпись: отладочный ключ android/debug.keystore (пароль android); свой ключ задаётся через KEYSTORE.
# Нужны build-tools 35 или новее (d8 из более старых не понимает классы, собранные JDK 21).
set -euo pipefail
cd "$(dirname "$0")/.."
: "${BUILD_TOOLS:?укажите каталог build-tools}"
: "${ANDROID_JAR:?укажите путь к android.jar}"
VERSION_NAME="${VERSION_NAME:-1.0}"
VERSION_CODE="${VERSION_CODE:-1}"
OUT="${OUT:-build/apk}"
KEYSTORE="${KEYSTORE:-android/debug.keystore}"
rm -rf "$OUT/work" && mkdir -p "$OUT/work/assets/www" "$OUT/work/gen" "$OUT/work/classes" "$OUT/work/dex" dist
cp -r index.html manifest.webmanifest css src vendor "$OUT/work/assets/www/"
"$BUILD_TOOLS/aapt2" compile --dir android/res -o "$OUT/work/res.zip"
"$BUILD_TOOLS/aapt2" link -o "$OUT/work/base.apk" -I "$ANDROID_JAR" --manifest android/AndroidManifest.xml \
  -A "$OUT/work/assets" --java "$OUT/work/gen" --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" "$OUT/work/res.zip"
javac -nowarn -source 8 -target 8 -classpath "$ANDROID_JAR" -d "$OUT/work/classes" \
  $(find android/src "$OUT/work/gen" -name '*.java') 2>&1 | grep -v 'bootstrap class path\|^Picked up\|warning' || true
"$BUILD_TOOLS/d8" --lib "$ANDROID_JAR" --min-api 24 --output "$OUT/work/dex" $(find "$OUT/work/classes" -name '*.class')
(cd "$OUT/work/dex" && zip -q -j ../base.apk classes.dex)
"$BUILD_TOOLS/zipalign" -f 4 "$OUT/work/base.apk" "$OUT/work/aligned.apk"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -keystore "$KEYSTORE" -storepass android -keypass android -alias androiddebugkey \
    -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Android Debug,O=Android,C=US" >/dev/null 2>&1
fi
"$BUILD_TOOLS/apksigner" sign --ks "$KEYSTORE" --ks-pass pass:android --key-pass pass:android \
  --ks-key-alias androiddebugkey --out dist/Evosphere.apk "$OUT/work/aligned.apk"
rm -f dist/Evosphere.apk.idsig
"$BUILD_TOOLS/apksigner" verify --print-certs dist/Evosphere.apk | head -2
ls -la dist/Evosphere.apk
