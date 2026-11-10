package app.evosphere;

import android.webkit.JavascriptInterface;

/** Мост между игрой и Android: сохранение файла мира через системный диалог. */
public class Bridge {
    private final MainActivity activity;

    Bridge(MainActivity activity) {
        this.activity = activity;
    }

    @JavascriptInterface
    public void saveFile(String name, String content) {
        activity.requestSave(name, content);
    }
}
